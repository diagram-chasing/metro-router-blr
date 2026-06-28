// Visualises how the wall evolves as the same commutes are taken by more and more people:
// it repeats the 9 trips currently in data/exhibit.db ×20/30/50/100 (plus ×1 as a baseline)
// into a throwaway scratch DB, runs the real wall against it, and screenshots each step.
//
//   pnpm viz:matrix   →   scripts/out/viz-matrix/{wall-x*.png, index.html, summary.md}
//
// The heat field and the "years of life lost" headline are computed in the browser from
// /api/emissions (rebuilt live from the lines table), so a faithful picture needs the actual
// page rendered — we drive headless Chromium rather than re-deriving the field here.
//
// The real DB is opened read-only; every write lands in scripts/out/viz-matrix/data via
// EXHIBIT_DATA_DIR, so the live exhibit data is never touched. Run with Chromium installed
// once via `npx playwright install chromium`.

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

import Database from 'better-sqlite3';
import { chromium, type Browser, type Page } from 'playwright';

// ── Knobs ──
const FACTORS = [1, 20, 30, 50, 100]; // ×1 = the current 9 trips, as a reference frame
const JITTER_DEG = 0.003; // ≈330m per-copy whole-route shift; < the 1.2km decay smear, so corridors broaden but stay legible
const PORT = Number(process.env.VIZ_PORT ?? 4319);
const VIEWPORT = { width: 1920, height: 1080 };
const SETTLE_CAP_MS = 25_000; // longest we wait for the years readout to stabilise per frame

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
type Result = { factor: number; lines: number; count: number; years: number; png: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rid = () => Math.random().toString(36).slice(2, 8);
const jitter = () => (Math.random() * 2 - 1) * JITTER_DEG;

// Read the 9 base trips (+ their submissions, for the O→D label join) from the live DB, read-only.
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
	const subs = new Map(subRows.map((s) => [s.id, s]));
	return { lines, subs };
}

// Replace the scratch DB contents with the base set repeated `factor` times, each copy jittered
// and stamped with a recent createdAt (so /api/emissions' 7-day decay stays ≈1). Returns row count.
function seedFactor(
	db: Database.Database,
	base: BaseLine[],
	subs: Map<string, Sub>,
	factor: number
): number {
	const insLine = db.prepare(
		`INSERT INTO lines (submission_id, created_at, chosen_mode, distance_km, co2_per_trip_kg,
			co2_per_km_g, grey_bucket, trips_per_year, segments)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
	);
	const insSub = db.prepare(
		`INSERT OR IGNORE INTO submissions (id, created_at, answers, computed, geo) VALUES (?, ?, ?, ?, ?)`
	);
	const tx = db.transaction(() => {
		db.prepare('DELETE FROM lines').run();
		db.prepare('DELETE FROM submissions').run();
		const now = Date.now();
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
				const createdAt = now - Math.floor(Math.random() * 6 * 3600 * 1000); // 0..6h ago
				if (sub) insSub.run(subId, sub.created_at, sub.answers, sub.computed, sub.geo);
				insLine.run(
					subId,
					createdAt,
					line.chosen_mode,
					line.distance_km,
					line.co2_per_trip_kg,
					line.co2_per_km_g,
					line.grey_bucket,
					line.trips_per_year,
					JSON.stringify(moved)
				);
				n++;
			}
		}
		return n;
	});
	return tx();
}

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

// Load the wall fresh (a fresh load is required — the wall freezes its field snapshot after boot),
// wait for the years readout to settle, then screenshot. Returns the displayed years value.
async function captureFactor(page: Page, factor: number): Promise<{ years: number; png: string }> {
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

	const png = join(OUT_DIR, `wall-x${factor}.png`);
	await page.screenshot({ path: png });
	return { years, png };
}

function writeReport(results: Result[]): void {
	const cap = (r: Result) => `×${r.factor} — ${r.lines} lines — ${r.years.toFixed(1)} years`;

	const md = [
		'# Viz matrix — how the wall evolves as commutes accumulate',
		'',
		`Each frame repeats the current ${results[0]?.lines ?? 9} trips ×factor, with every copy`,
		`jittered by ±${JITTER_DEG}° (≈330m) so corridors broaden like distinct commuters, and a`,
		'recent `createdAt` so the field\'s 7-day decay is neutralised. Screenshots are of the live',
		'wall at `/`, captured headless. The real `data/exhibit.db` was opened read-only.',
		'',
		'| factor | total lines | count (api) | years (DOM) | screenshot |',
		'|-------:|------------:|------------:|------------:|------------|',
		...results.map(
			(r) => `| ×${r.factor} | ${r.lines} | ${r.count} | ${r.years.toFixed(1)} | wall-x${r.factor}.png |`
		),
		''
	].join('\n');
	writeFileSync(join(OUT_DIR, 'summary.md'), md);

	const cards = results
		.map(
			(r) => `      <figure>
        <img src="wall-x${r.factor}.png" alt="${cap(r)}" />
        <figcaption>${cap(r)}</figcaption>
      </figure>`
		)
		.join('\n');
	const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Viz matrix — wall evolution</title>
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
    <h1>Same ${results[0]?.lines ?? 9} commutes, taken by more people — heat & years of life lost</h1>
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
	// Start each run from a clean scratch DB (drop any stale WAL too).
	for (const f of ['', '-wal', '-shm']) rmSync(SCRATCH_DB + f, { force: true });

	const { lines: base, subs } = readBase();
	if (base.length === 0) throw new Error('no trips in data/exhibit.db to replicate');
	console.log(`Base: ${base.length} trips (${subs.size} submissions). Factors: ${FACTORS.join(', ')}`);

	const scratch = new Database(SCRATCH_DB);
	scratch.pragma('journal_mode = WAL');
	scratch.exec(DDL);

	const viteBin = resolve(ROOT, 'node_modules/vite/bin/vite.js');
	const server = spawn(
		process.execPath,
		[viteBin, 'dev', '--port', String(PORT), '--strictPort'],
		{
			cwd: ROOT,
			env: { ...process.env, EXHIBIT_DATA_DIR: SCRATCH_DIR, BROWSER: 'none' },
			stdio: ['ignore', 'ignore', 'pipe'],
			detached: true
		}
	);
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

		for (const factor of FACTORS) {
			const lines = seedFactor(scratch, base, subs, factor);
			const { years, png } = await captureFactor(page, factor);
			const stats = (await fetch(`${BASE_URL}/api/stats`).then((r) => r.json())) as { count: number };
			results.push({ factor, lines, count: stats.count, years, png });
			console.log(`  ×${factor}\tlines=${lines}\tcount=${stats.count}\tyears=${years.toFixed(1)}`);
		}

		writeReport(results);
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
