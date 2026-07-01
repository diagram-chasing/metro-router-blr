// Lightweight local SQLite store for the exhibit.
//
// Backs two things that need to accumulate over a day and survive restarts:
//   • submissions — every visitor's answers + computed receipt (for the receipt
//     page and the live distribution).
//   • lines       — the drawable grey route each visitor chose, for the home-page
//     accumulation map.
//
// Single local server (vite dev / preview / node) means one process owns the file,
// so a plain synchronous better-sqlite3 handle is all we need. Not for Netlify's
// serverless runtime (ephemeral FS) — the exhibit runs locally.

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import Database from 'better-sqlite3';

import {
	routePM25,
	pm25GramsOverYears,
	firstLastMileKm,
	pm25Bucket,
	MODE_PM25_G_PER_PKM,
	type Leg
} from '$lib/emissions';
import type { Answers } from '$lib/exhibit/types';
import type { ComputedReceipt } from '$lib/receipt/receipt';
import type { GeoSnapshot } from './receiptStore';

let db: Database.Database | null = null;

function getDb(): Database.Database {
	if (db) return db;
	const dir = path.resolve(process.env.EXHIBIT_DATA_DIR ?? 'data');
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const handle = new Database(path.join(dir, 'exhibit.db'));
	handle.pragma('journal_mode = WAL');
	handle.exec(`
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
	`);
	// Older databases predate trips_per_year — add it idempotently.
	try {
		handle.exec('ALTER TABLE lines ADD COLUMN trips_per_year INTEGER');
	} catch {
		// column already exists
	}
	// corridor_people_per_day: the route's real corridor traffic volume (junction counts), stored so
	// the wall's represented-traffic field need not recompute it per request. Added idempotently.
	try {
		handle.exec('ALTER TABLE lines ADD COLUMN corridor_people_per_day INTEGER');
	} catch {
		// column already exists
	}
	db = handle;
	return handle;
}

// ── Submissions ──────────────────────────────────────────────────────────────

export type SubmissionRow = {
	id: string;
	createdAt: number;
	answers: Answers;
	computed: ComputedReceipt;
	geo?: GeoSnapshot;
};

export function insertSubmission(row: SubmissionRow): void {
	getDb()
		.prepare(
			`INSERT OR REPLACE INTO submissions (id, created_at, answers, computed, geo)
			 VALUES (@id, @createdAt, @answers, @computed, @geo)`
		)
		.run({
			id: row.id,
			createdAt: row.createdAt,
			answers: JSON.stringify(row.answers),
			computed: JSON.stringify(row.computed),
			geo: row.geo ? JSON.stringify(row.geo) : null
		});
}

type RawSubmission = {
	id: string;
	created_at: number;
	answers: string;
	computed: string;
	geo: string | null;
};

function parseSubmission(r: RawSubmission): SubmissionRow {
	return {
		id: r.id,
		createdAt: r.created_at,
		answers: JSON.parse(r.answers) as Answers,
		computed: JSON.parse(r.computed) as ComputedReceipt,
		geo: r.geo ? (JSON.parse(r.geo) as GeoSnapshot) : undefined
	};
}

export function getSubmission(id: string): SubmissionRow | undefined {
	const r = getDb().prepare('SELECT * FROM submissions WHERE id = ?').get(id) as
		| RawSubmission
		| undefined;
	return r ? parseSubmission(r) : undefined;
}

export function listSubmissions(): SubmissionRow[] {
	const rows = getDb()
		.prepare('SELECT * FROM submissions ORDER BY created_at DESC')
		.all() as RawSubmission[];
	return rows.map(parseSubmission);
}

// ── Lines (accumulation map) ──────────────────────────────────────────────────

export type LineSegment = { coords: [number, number][]; legKind: string };

export type LineInput = {
	submissionId: string;
	createdAt: number;
	chosenMode: string;
	distanceKm: number;
	co2PerTripKg: number;
	co2PerKmG: number;
	greyBucket: number;
	tripsPerYear: number;
	corridorPeoplePerDay: number | null;
	segments: LineSegment[];
};

export type LineRow = {
	id: number;
	createdAt: number;
	chosenMode: string;
	distanceKm: number;
	co2PerTripKg: number;
	co2PerKmG: number;
	greyBucket: number;
	tripsPerYear: number | null;
	corridorPeoplePerDay: number | null;
	segments: LineSegment[];
	// Best-effort O→D station labels (joined from the submission) for the wall's
	// "your route" callout. Optional — undefined when the route didn't snap to stations.
	originLabel?: string;
	destinationLabel?: string;
};

export function insertLine(line: LineInput): number {
	const info = getDb()
		.prepare(
			`INSERT INTO lines (submission_id, created_at, chosen_mode, distance_km,
				co2_per_trip_kg, co2_per_km_g, grey_bucket, trips_per_year, corridor_people_per_day, segments)
			 VALUES (@submissionId, @createdAt, @chosenMode, @distanceKm,
				@co2PerTripKg, @co2PerKmG, @greyBucket, @tripsPerYear, @corridorPeoplePerDay, @segments)`
		)
		.run({
			submissionId: line.submissionId,
			createdAt: line.createdAt,
			chosenMode: line.chosenMode,
			distanceKm: line.distanceKm,
			co2PerTripKg: line.co2PerTripKg,
			co2PerKmG: line.co2PerKmG,
			greyBucket: line.greyBucket,
			tripsPerYear: line.tripsPerYear,
			corridorPeoplePerDay: line.corridorPeoplePerDay ?? null,
			segments: JSON.stringify(line.segments)
		});
	return Number(info.lastInsertRowid);
}

// Guards the "add myself to the map" trigger against double-taps / reloads: the
// route is now inserted on an explicit visitor action (see POST /api/lines), not
// automatically at receipt time, so the same submission could arrive twice.
export function hasLineForSubmission(submissionId: string): boolean {
	const row = getDb()
		.prepare('SELECT 1 FROM lines WHERE submission_id = ? LIMIT 1')
		.get(submissionId);
	return row !== undefined;
}

type RawLine = {
	id: number;
	created_at: number;
	chosen_mode: string;
	distance_km: number;
	co2_per_trip_kg: number;
	co2_per_km_g: number;
	grey_bucket: number;
	trips_per_year: number | null;
	corridor_people_per_day: number | null;
	segments: string;
	origin_label?: string | null;
	dest_label?: string | null;
};

function parseLine(r: RawLine): LineRow {
	return {
		id: r.id,
		createdAt: r.created_at,
		chosenMode: r.chosen_mode,
		distanceKm: r.distance_km,
		co2PerTripKg: r.co2_per_trip_kg,
		co2PerKmG: r.co2_per_km_g,
		greyBucket: r.grey_bucket,
		tripsPerYear: r.trips_per_year,
		corridorPeoplePerDay: r.corridor_people_per_day ?? null,
		segments: JSON.parse(r.segments) as LineSegment[],
		originLabel: r.origin_label ?? undefined,
		destinationLabel: r.dest_label ?? undefined
	};
}

// SELECT that carries best-effort O→D labels, preferring the reverse-geocoded receipt
// `geo` labels and falling back to the answers' station names. `l.*` keeps every line
// column under its bare name so parseLine is unchanged.
const LINE_SELECT = `
	SELECT l.*,
		COALESCE(json_extract(s.geo, '$.originLabel'),      json_extract(s.answers, '$.originStation'))      AS origin_label,
		COALESCE(json_extract(s.geo, '$.destinationLabel'), json_extract(s.answers, '$.destinationStation')) AS dest_label
	FROM lines l LEFT JOIN submissions s ON s.id = l.submission_id`;

/** Lines in ascending id order, optionally only those after `sinceId`. */
export function listLines(opts: { sinceId?: number; limit?: number } = {}): LineRow[] {
	const { sinceId = 0, limit = 5000 } = opts;
	const rows = getDb()
		.prepare(`${LINE_SELECT} WHERE l.id > ? ORDER BY l.id ASC LIMIT ?`)
		.all(sinceId, limit) as RawLine[];
	return rows.map(parseLine);
}

export function latestLine(): LineRow | undefined {
	const r = getDb().prepare(`${LINE_SELECT} ORDER BY l.id DESC LIMIT 1`).get() as
		| RawLine
		| undefined;
	return r ? parseLine(r) : undefined;
}

// ── Aggregate stats (map HUD + receipt distribution) ──────────────────────────

export type Stats = {
	count: number;
	avgCo2PerTripKg: number;
	avgCo2PerKmG: number;
	modeSplit: Record<string, number>;
	pm25ActualG10yr: number; // Σ grams of PM2.5 the logged commutes deposit over a decade
	pm25AvoidableG10yr: number; // …of which this much had a cleaner option (metro + short auto access)
	pm25BandsAll: number[]; // counts per PM25_BUCKET_MAX soot-per-km band (bounded, length 5) — the wall's distribution
};

// The decade window the wall's "choice crowd" banner and per-route card both report over.
// Mirrors WALL.years (a client config the server can't import) — keep the two in sync.
const SOOT_YEARS = 10;
const DEFAULT_TRIPS_PER_YEAR = 288; // matches the wall's fallback when frequency is unknown

export function stats(): Stats {
	const d = getDb();
	const agg = d
		.prepare(
			`SELECT COUNT(*) AS n, AVG(co2_per_trip_kg) AS avgTrip, AVG(co2_per_km_g) AS avgKm
			 FROM lines`
		)
		.get() as { n: number; avgTrip: number | null; avgKm: number | null };
	const modeRows = d
		.prepare('SELECT chosen_mode AS mode, COUNT(*) AS n FROM lines GROUP BY chosen_mode')
		.all() as { mode: string; n: number }[];
	const modeSplit: Record<string, number> = {};
	for (const m of modeRows) modeSplit[m.mode ?? 'unknown'] = m.n;

	// Soot the logged commutes leave over a decade, and the avoidable share. Per journey this is
	// the same figure the route card shows (routePM25 × pm25GramsOverYears); the counterfactual is
	// the receipt's own basis — the same trip on a metro trunk (0 PM2.5) with short auto access.
	let pm25ActualG10yr = 0;
	let pm25AvoidableG10yr = 0;
	// Soot-per-km distribution: one count per band, built in the same scan (no extra query).
	const pm25BandsAll = [0, 0, 0, 0, 0];
	const sootRows = d
		.prepare('SELECT segments, trips_per_year AS trips FROM lines')
		.all() as { segments: string; trips: number | null }[];
	for (const r of sootRows) {
		const trips = r.trips ?? DEFAULT_TRIPS_PER_YEAR;
		let legs: Leg[];
		try {
			legs = JSON.parse(r.segments) as Leg[];
		} catch {
			continue;
		}
		const { km, gPerKm } = routePM25(legs);
		if (km <= 0) continue;
		pm25BandsAll[pm25Bucket(gPerKm)]++;
		const actual = pm25GramsOverYears(gPerKm, km, trips, SOOT_YEARS);
		const { firstMile, lastMile } = firstLastMileKm(km);
		const cleanGPerKm = ((firstMile + lastMile) * MODE_PM25_G_PER_PKM.auto) / km;
		const clean = pm25GramsOverYears(cleanGPerKm, km, trips, SOOT_YEARS);
		pm25ActualG10yr += actual;
		pm25AvoidableG10yr += Math.max(0, actual - clean);
	}

	return {
		count: agg.n,
		avgCo2PerTripKg: agg.avgTrip ? Math.round(agg.avgTrip * 100) / 100 : 0,
		avgCo2PerKmG: agg.avgKm ? Math.round(agg.avgKm) : 0,
		modeSplit,
		pm25ActualG10yr,
		pm25AvoidableG10yr,
		pm25BandsAll
	};
}

/** Per-trip CO2 (kg) and distance (km) for every line — for distribution binning. */
export function allTripStats(): { distanceKm: number; co2PerTripKg: number }[] {
	return getDb()
		.prepare('SELECT distance_km AS distanceKm, co2_per_trip_kg AS co2PerTripKg FROM lines')
		.all() as { distanceKm: number; co2PerTripKg: number }[];
}

/** Per-km CO2 (g) for every line submitted since local midnight — feeds the live
 *  "where you sit today" histogram. Per-km is distance-independent, so a short dirty
 *  trip and a long dirty trip land in the same place. */
// Per-km dirtiness of every trip logged so far (not just today), for the "your mode"
// histogram. Per-km so distance doesn't confound the spread.
export function allPerKmStats(): number[] {
	const rows = getDb()
		.prepare('SELECT co2_per_km_g AS g FROM lines WHERE co2_per_km_g IS NOT NULL')
		.all() as { g: number }[];
	return rows.map((r) => r.g);
}

// ── Purge / reset (operating the exhibit) ─────────────────────────────────────

export function purgeLines(): void {
	getDb().exec('DELETE FROM lines;');
}

export function purgeAll(): void {
	getDb().exec('DELETE FROM lines; DELETE FROM submissions;');
}
