// Visualises how the wall evolves as commutes accumulate, by seeding a throwaway scratch DB,
// running the real wall against it, and screenshotting each step.
//
//   pnpm viz:matrix                       →   replicate the 9 trips in data/exhibit.db ×20/30/50/100
//   VIZ_SOURCE=random pnpm viz:matrix     →   generate 20/30/50/100 real random mixed-mode journeys
//
//   output: scripts/out/viz-matrix/{wall-*.png, index.html, summary.md}
//
// Two seed sources:
//   • replicate (default) — repeats the existing trips ×factor, each copy jittered, so the same
//     corridors intensify. Shows "same journeys, more people".
//   • random — plans genuinely varied journeys across the city via the app's own OpenTripPlanner
//     (the same router visitors hit), each a random origin/destination station pair with a random
//     mode (cab/auto/bus/metro/walk). Shows a realistic spread filling the map. Needs network.
//
// The heat field and the "years of life lost" headline are computed in the browser from
// /api/emissions (rebuilt live from the lines table), so a faithful picture needs the actual page
// rendered — we drive headless Chromium rather than re-deriving the field here.
//
// The real DB is opened read-only; every write lands in scripts/out/viz-matrix/data via
// EXHIBIT_DATA_DIR, so the live exhibit data is never touched. Chromium is installed once via
// `npx playwright install chromium`.
//
// Knobs (env): VIZ_SOURCE=replicate|random · VIZ_FACTORS=1,20,... · VIZ_COUNTS=20,30,... · VIZ_PORT.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

import Database from 'better-sqlite3';
import { chromium, type Browser, type Page } from 'playwright';

import { planAllModes, firstWithMode, type OtpItinerary } from '../src/lib/utils/otp';
import { itineraryToSegments, type CandidateKind } from '../src/lib/exhibit/routeCandidates';
import { routeEmissions, type Leg } from '../src/lib/emissions';
import { stations } from '../src/lib/config/stations';

// ── Knobs ──
const parseList = (s: string | undefined, d: number[]) =>
	s ? s.split(',').map(Number).filter((n) => n > 0) : d;
const SOURCE = process.env.VIZ_SOURCE === 'random' ? 'random' : 'replicate';
const FACTORS = parseList(process.env.VIZ_FACTORS, [1, 20, 30, 50, 100]); // replicate: ×factor
const RANDOM_COUNTS = parseList(process.env.VIZ_COUNTS, [20, 30, 50, 100]); // random: # journeys

const JITTER_DEG = 0.003; // replicate: ≈330m per-copy whole-route shift; < the 1.2km decay smear
const OD_JITTER_KM = 2.5; // random: scatter O/D this far off the station so trips aren't rail-bound
const PORT = Number(process.env.VIZ_PORT ?? 4319);
const VIEWPORT = { width: 1920, height: 1080 };
const SETTLE_CAP_MS = 25_000; // longest we wait for the years readout to stabilise per frame

// random mode mix (restricted to OTP-served kinds; renormalised over what each trip supports)
const MODE_WEIGHTS: Partial<Record<CandidateKind, number>> = {
	cab: 0.3,
	auto: 0.2,
	bus: 0.2,
	metro: 0.22,
	walk: 0.08
};
// random trip frequency → trips/year (same buckets the receipt uses), weighted toward commuters
const FREQS = [
	{ trips: 480, w: 0.5 }, // daily
	{ trips: 288, w: 0.25 }, // few times a week
	{ trips: 100, w: 0.15 }, // weekly
	{ trips: 24, w: 0.1 } // occasional
];
// Real commute demand funnels toward employment hubs rather than scattering uniformly — so a share
// of trips put a hub at one end. That makes feeder corridors and hub approaches ACCUMULATE as the
// population grows (uniform-random O/D never concentrates enough to register). Weights ≈ relative
// pull; ORR tech belt (Bellandur/Marathahalli) and Whitefield dominate, as they do in the city.
const HUBS: { name: string; at: [number, number]; w: number }[] = [
	{ name: 'MG Road / CBD', at: [77.609, 12.975], w: 1.0 },
	{ name: 'Whitefield / ITPL', at: [77.7406, 12.9856], w: 1.3 },
	{ name: 'Electronic City', at: [77.664, 12.845], w: 1.2 },
	{ name: 'Bellandur (ORR)', at: [77.676, 12.926], w: 1.5 },
	{ name: 'Marathahalli (ORR)', at: [77.701, 12.956], w: 1.2 },
	{ name: 'Manyata Tech Park', at: [77.62, 13.045], w: 1.0 },
	{ name: 'Koramangala', at: [77.626, 12.935], w: 0.9 }
];
const HUB_BIAS = 0.7; // share of trips with a hub at one end (the rest are random station→station)
const HUB_SCATTER_KM = 0.6; // a hub is a district, not a point

const ROOT = process.cwd();
const REAL_DB = resolve(ROOT, 'data/exhibit.db');
const OUT_DIR = resolve(ROOT, 'scripts/out/viz-matrix');
const SCRATCH_DIR = join(OUT_DIR, 'data');
const SCRATCH_DB = join(SCRATCH_DIR, 'exhibit.db');
const BASE_URL = `http://localhost:${PORT}`;

// Same DDL as src/lib/server/db.ts, so the harness owns the scratch schema and there's no race
// with the server's lazy CREATE TABLE on first request.
const DDL = `
	CREATE TABLE IF NOT EXISTS submissions (
		id          TEXT PRIMARY KEY,
		created_at  INTEGER NOT NULL,
		answers     TEXT NOT NULL,
		computed    TEXT NOT NULL,
		geo         TEXT
	);
	CREATE TABLE IF NOT EXISTS lines (
		id              INTEGER PRIMARY KEY AUTOINCREMENT,
		submission_id   TEXT NOT NULL,
		created_at      INTEGER NOT NULL,
		chosen_mode     TEXT,
		distance_km     REAL,
		co2_per_trip_kg REAL,
		co2_per_km_g    REAL,
		grey_bucket     INTEGER,
		trips_per_year  INTEGER,
		segments        TEXT NOT NULL
	);
	CREATE INDEX IF NOT EXISTS idx_lines_id ON lines (id);
`;

type BaseLine = {
	submission_id: string;
	created_at: number;
	chosen_mode: string;
	distance_km: number;
	co2_per_trip_kg: number;
	co2_per_km_g: number;
	grey_bucket: number;
	trips_per_year: number | null;
	segments: string;
};
type Sub = { id: string; created_at: number; answers: string; computed: string; geo: string | null };
type Seg = { legKind: string; coords: [number, number][] };
type Journey = {
	mode: CandidateKind;
	segments: Seg[];
	km: number;
	co2PerTripKg: number;
	co2PerKmG: number;
	bucket: number;
	tripsPerYear: number;
	origin: string;
	destination: string;
};
type Result = { label: string; lines: number; count: number; years: number; png: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 8);
const jitter = () => (Math.random() * 2 - 1) * JITTER_DEG;
const recentTs = () => Date.now() - Math.floor(Math.random() * 6 * 3600 * 1000); // 0..6h ago

// ── Insert one prepared statement set into the scratch DB ──
function prep(db: Database.Database) {
	return {
		line: db.prepare(
			`INSERT INTO lines (submission_id, created_at, chosen_mode, distance_km, co2_per_trip_kg,
				co2_per_km_g, grey_bucket, trips_per_year, segments)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
		),
		sub: db.prepare(
			`INSERT OR IGNORE INTO submissions (id, created_at, answers, computed, geo) VALUES (?, ?, ?, ?, ?)`
		),
		clear: db.transaction(() => {
			db.prepare('DELETE FROM lines').run();
			db.prepare('DELETE FROM submissions').run();
		})
	};
}

// ── Replicate source: the existing trips, read read-only from the live DB ──

function readBase(): { lines: BaseLine[]; subs: Map<string, Sub> } {
	const db = new Database(REAL_DB, { readonly: true, fileMustExist: true });
	const lines = db
		.prepare(
			`SELECT submission_id, created_at, chosen_mode, distance_km, co2_per_trip_kg,
				co2_per_km_g, grey_bucket, trips_per_year, segments FROM lines ORDER BY id`
		)
		.all() as BaseLine[];
	const subRows = db
		.prepare('SELECT id, created_at, answers, computed, geo FROM submissions')
		.all() as Sub[];
	db.close();
	return { lines, subs: new Map(subRows.map((s) => [s.id, s])) };
}

// Replace scratch contents with the base set repeated `factor`×, each copy jittered and stamped
// with a recent createdAt (so /api/emissions' 7-day decay stays ≈1). Returns row count.
function seedReplicate(
	db: Database.Database,
	base: BaseLine[],
	subs: Map<string, Sub>,
	factor: number
): number {
	const q = prep(db);
	return db.transaction(() => {
		q.clear();
		let n = 0;
		for (const line of base) {
			const sub = subs.get(line.submission_id);
			const segs = JSON.parse(line.segments) as Seg[];
			for (let c = 0; c < factor; c++) {
				const dx = jitter();
				const dy = jitter();
				const moved: Seg[] = segs.map((s) => ({
					legKind: s.legKind,
					coords: s.coords.map(([lng, lat]) => [lng + dx, lat + dy] as [number, number])
				}));
				const subId = `${line.submission_id}-x${factor}-${c}-${rid()}`;
				const at = recentTs();
				if (sub) q.sub.run(subId, sub.created_at, sub.answers, sub.computed, sub.geo);
				q.line.run(
					subId, at, line.chosen_mode, line.distance_km, line.co2_per_trip_kg,
					line.co2_per_km_g, line.grey_bucket, line.trips_per_year, JSON.stringify(moved)
				);
				n++;
			}
		}
		return n;
	})();
}

// ── Random source: real OTP-planned journeys with random O/D + mode ──

const KM_PER_DEG_LAT = 111.32;
// Scatter a point up to `km` off a station in a random direction (a realistic "near transit" O/D).
function jitterPoint([lng, lat]: [number, number], km: number): [number, number] {
	const r = km * Math.sqrt(Math.random());
	const a = Math.random() * Math.PI * 2;
	const dLat = (r * Math.sin(a)) / KM_PER_DEG_LAT;
	const dLng = (r * Math.cos(a)) / (KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
	return [lng + dLng, lat + dLat];
}
function pickWeighted(weights: Partial<Record<CandidateKind, number>>, allowed: CandidateKind[]): CandidateKind {
	const entries = allowed.map((k) => [k, weights[k] ?? 0] as const).filter(([, w]) => w > 0);
	const total = entries.reduce((s, [, w]) => s + w, 0);
	let r = Math.random() * total;
	for (const [k, w] of entries) {
		r -= w;
		if (r <= 0) return k;
	}
	return entries[entries.length - 1][0];
}
function pickFreq(): number {
	const total = FREQS.reduce((s, f) => s + f.w, 0);
	let r = Math.random() * total;
	for (const f of FREQS) {
		r -= f.w;
		if (r <= 0) return f.trips;
	}
	return FREQS[0].trips;
}
function pickHub(): (typeof HUBS)[number] {
	const total = HUBS.reduce((s, h) => s + h.w, 0);
	let r = Math.random() * total;
	for (const h of HUBS) {
		r -= h.w;
		if (r <= 0) return h;
	}
	return HUBS[0];
}
// One trip's endpoints: a residential end (a scattered station, where people live) and — for most
// trips — an employment hub at the other end, direction randomised (morning in / evening out).
function pickEndpoints(): { from: [number, number]; to: [number, number]; origin: string; destination: string } | null {
	const res = stations[Math.floor(Math.random() * stations.length)];
	const resPt = jitterPoint(res.coordinates, OD_JITTER_KM);
	if (Math.random() < HUB_BIAS) {
		const hub = pickHub();
		const hubPt = jitterPoint(hub.at, HUB_SCATTER_KM);
		return Math.random() < 0.5
			? { from: resPt, to: hubPt, origin: res.name, destination: hub.name }
			: { from: hubPt, to: resPt, origin: hub.name, destination: res.name };
	}
	const other = stations[Math.floor(Math.random() * stations.length)];
	if (other === res) return null;
	return {
		from: resPt,
		to: jitterPoint(other.coordinates, OD_JITTER_KM),
		origin: res.name,
		destination: other.name
	};
}

// Plan `n` genuinely varied journeys via OTP — random station pairs (scattered), a random mode
// among those the trip actually supports, with real road/transit-following geometry & emissions.
async function buildRandomPool(n: number): Promise<Journey[]> {
	const pool: Journey[] = [];
	const maxAttempts = n * 6 + 20;
	let attempts = 0;
	while (pool.length < n && attempts < maxAttempts) {
		attempts++;
		const od = pickEndpoints();
		if (!od) continue;

		let bundle;
		try {
			bundle = await planAllModes(od.from, od.to);
		} catch {
			continue;
		}
		const metroIt = firstWithMode(bundle.metro, 'SUBWAY');
		const busIt = firstWithMode(bundle.bus, 'BUS');
		const carIt = bundle.car[0] ?? null;
		const walkIt = bundle.walk[0] ?? null;

		const avail: Partial<Record<CandidateKind, OtpItinerary>> = {};
		if (carIt && carIt.distanceKm > 0) {
			avail.cab = carIt;
			if (carIt.distanceKm <= 12) avail.auto = carIt; // auto only offered on shorter trips
		}
		if (busIt) avail.bus = busIt;
		if (metroIt) avail.metro = metroIt;
		if (walkIt && walkIt.distanceKm > 0 && walkIt.distanceKm <= 2.5) avail.walk = walkIt;

		const kinds = Object.keys(avail) as CandidateKind[];
		if (kinds.length === 0) continue;
		const mode = pickWeighted(MODE_WEIGHTS, kinds);
		const segs: Seg[] = itineraryToSegments(avail[mode]!, mode)
			.filter((s) => s.coords.length >= 2)
			.map((s) => ({ legKind: s.kind, coords: s.coords }));
		if (segs.length === 0) continue;
		const emis = routeEmissions(segs as Leg[]);
		if (!(emis.km > 0)) continue;

		pool.push({
			mode,
			segments: segs,
			km: emis.km,
			co2PerTripKg: emis.kgPerTrip,
			co2PerKmG: emis.gPerKm,
			bucket: emis.bucket,
			tripsPerYear: pickFreq(),
			origin: od.origin,
			destination: od.destination
		});
		if (pool.length % 10 === 0) console.log(`  pool ${pool.length}/${n} (${attempts} attempts)`);
	}
	if (pool.length < n) console.warn(`  only built ${pool.length}/${n} journeys (${attempts} attempts)`);
	return pool;
}

// Seed the first `count` journeys of the pool (nested prefixes → genuine accumulation). Returns rows.
function seedRandom(db: Database.Database, pool: Journey[], count: number): number {
	const q = prep(db);
	const take = pool.slice(0, count);
	return db.transaction(() => {
		q.clear();
		take.forEach((j, i) => {
			const subId = `rand-${i}-${rid()}`;
			const at = recentTs();
			// answers carries the O→D station names the LINE_SELECT join surfaces as the route label.
			const answers = JSON.stringify({
				originStation: j.origin,
				destinationStation: j.destination,
				mode: j.mode
			});
			q.sub.run(subId, at, answers, '{}', null);
			q.line.run(
				subId, at, j.mode, j.km, j.co2PerTripKg, j.co2PerKmG, j.bucket, j.tripsPerYear,
				JSON.stringify(j.segments)
			);
		});
		return take.length;
	})();
}

// ── Server + capture ──

async function waitForServer(timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`${BASE_URL}/api/stats`);
			if (r.ok) return;
		} catch {
			/* not up yet */
		}
		await sleep(500);
	}
	throw new Error(`dev server never became ready on ${BASE_URL}`);
}

// Load the wall fresh (required — the wall freezes its field snapshot after boot), wait for the
// years readout to settle, then screenshot. Returns the displayed years value.
async function captureFrame(page: Page, tag: string): Promise<{ years: number; png: string }> {
	await page.goto(`${BASE_URL}/`, { waitUntil: 'load', timeout: 60_000 });
	await page.waitForSelector('canvas', { timeout: 45_000 });
	await page.waitForSelector('.hero .total', { timeout: 45_000 });

	let prev = NaN;
	let years = NaN;
	const deadline = Date.now() + SETTLE_CAP_MS;
	while (Date.now() < deadline) {
		const txt = (await page.locator('.hero .total').first().textContent())?.trim() ?? '';
		years = parseFloat(txt);
		if (!Number.isNaN(years) && years === prev) break; // two equal reads → stable
		prev = years;
		await sleep(2500);
	}
	await sleep(1500); // let the heat texture finish its grow lerp before the grab

	const png = `wall-${tag}.png`;
	await page.screenshot({ path: join(OUT_DIR, png) });
	return { years, png };
}

function writeReport(results: Result[], random: boolean): void {
	const head = random ? 'journeys' : 'factor';
	const intro = random
		? `Each frame plans real journeys via the app's OpenTripPlanner with a random mode (cab/auto/` +
			`bus/metro/walk) and real road/transit geometry. Demand is hub-biased: ${Math.round(HUB_BIAS * 100)}% of ` +
			`trips run between a residential station and an employment hub (ORR belt, Whitefield, ` +
			`Electronic City, CBD…), the rest station→station — so feeder corridors accumulate as the ` +
			`population grows. Frames are nested prefixes of one pool (a growing population of distinct commutes).`
		: `Each frame repeats the current trips ×factor, every copy jittered ±${JITTER_DEG}° (≈330m) so ` +
			`corridors broaden like distinct commuters.`;

	const md = [
		`# Viz matrix — how the wall evolves (${SOURCE})`,
		'',
		intro,
		'Screenshots are of the live wall at `/`, captured headless; createdAt is recent so the',
		"field's 7-day decay is neutralised. The real `data/exhibit.db` was opened read-only.",
		'',
		`| ${head} | total lines | count (api) | years (DOM) | screenshot |`,
		'|------:|------------:|------------:|------------:|------------|',
		...results.map((r) => `| ${r.label} | ${r.lines} | ${r.count} | ${r.years.toFixed(1)} | ${r.png} |`),
		''
	].join('\n');
	writeFileSync(join(OUT_DIR, 'summary.md'), md);

	const cards = results
		.map((r) => {
			const cap = `${r.label} — ${r.lines} lines — ${r.years.toFixed(1)} years`;
			return `      <figure>
        <img src="${r.png}" alt="${cap}" />
        <figcaption>${cap}</figcaption>
      </figure>`;
		})
		.join('\n');
	const title = random
		? 'Real random mixed-mode commutes accumulating — heat & years of life lost'
		: 'Same commutes, taken by more people — heat & years of life lost';
	const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Viz matrix — ${SOURCE}</title>
    <style>
      body { margin: 0; background: #04060c; color: #eee; font: 14px ui-monospace, monospace; padding: 24px; }
      h1 { font-size: 18px; font-weight: 700; letter-spacing: 0.04em; }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(440px, 1fr)); gap: 20px; }
      figure { margin: 0; }
      img { width: 100%; height: auto; display: block; border: 1px solid #222; }
      figcaption { padding-top: 8px; text-transform: uppercase; letter-spacing: 0.06em; }
    </style>
  </head>
  <body>
    <h1>${title}</h1>
    <div class="grid">
${cards}
    </div>
  </body>
</html>
`;
	writeFileSync(join(OUT_DIR, 'index.html'), html);
}

(async () => {
	mkdirSync(SCRATCH_DIR, { recursive: true });
	for (const f of ['', '-wal', '-shm']) rmSync(SCRATCH_DB + f, { force: true });

	const random = SOURCE === 'random';
	const counts = random ? RANDOM_COUNTS : FACTORS;

	// Build the seed source up front (the OTP pool needs no dev server, so plan it before booting).
	let base: BaseLine[] = [];
	let subs = new Map<string, Sub>();
	let pool: Journey[] = [];
	if (random) {
		const need = Math.max(...counts);
		console.log(`Source: random. Planning ${need} OTP journeys (counts: ${counts.join(', ')})...`);
		pool = await buildRandomPool(need);
		if (pool.length === 0) throw new Error('OTP returned no usable journeys');
	} else {
		({ lines: base, subs } = readBase());
		if (base.length === 0) throw new Error('no trips in data/exhibit.db to replicate');
		console.log(`Source: replicate. ${base.length} base trips. Factors: ${counts.join(', ')}`);
	}

	const scratch = new Database(SCRATCH_DB);
	scratch.pragma('journal_mode = WAL');
	scratch.exec(DDL);

	const viteBin = resolve(ROOT, 'node_modules/vite/bin/vite.js');
	const server = spawn(process.execPath, [viteBin, 'dev', '--port', String(PORT), '--strictPort'], {
		cwd: ROOT,
		env: { ...process.env, EXHIBIT_DATA_DIR: SCRATCH_DIR, BROWSER: 'none' },
		stdio: ['ignore', 'ignore', 'pipe'],
		detached: true
	});
	let serverErr = '';
	server.stderr?.on('data', (d) => (serverErr += String(d)));

	let browser: Browser | undefined;
	const results: Result[] = [];
	try {
		await waitForServer(60_000);
		console.log(`Dev server ready on ${BASE_URL} (scratch DB)`);

		browser = await chromium.launch({
			args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
		});
		const ctx = await browser.newContext({ viewport: VIEWPORT, reducedMotion: 'reduce' });
		const page = await ctx.newPage();
		page.setDefaultTimeout(45_000);

		for (const c of counts) {
			const lines = random ? seedRandom(scratch, pool, c) : seedReplicate(scratch, base, subs, c);
			const tag = random ? `n${c}` : `x${c}`;
			const { years, png } = await captureFrame(page, tag);
			const stats = (await fetch(`${BASE_URL}/api/stats`).then((r) => r.json())) as { count: number };
			const label = random ? `${lines} journeys` : `×${c}`;
			results.push({ label, lines, count: stats.count, years, png });
			console.log(`  ${label}\tlines=${lines}\tcount=${stats.count}\tyears=${years.toFixed(1)}`);
		}

		writeReport(results, random);
		console.log(`\nDone → ${join(OUT_DIR, 'index.html')}`);
	} catch (err) {
		console.error('viz:matrix failed:', err);
		if (serverErr) console.error('--- dev server stderr ---\n' + serverErr.slice(-2000));
		process.exitCode = 1;
	} finally {
		await browser?.close();
		scratch.close();
		try {
			if (server.pid) process.kill(-server.pid, 'SIGTERM');
		} catch {
			/* already gone */
		}
	}
})();
