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
				co2_per_trip_kg, co2_per_km_g, grey_bucket, trips_per_year, segments)
			 VALUES (@submissionId, @createdAt, @chosenMode, @distanceKm,
				@co2PerTripKg, @co2PerKmG, @greyBucket, @tripsPerYear, @segments)`
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
			segments: JSON.stringify(line.segments)
		});
	return Number(info.lastInsertRowid);
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
};

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
	return {
		count: agg.n,
		avgCo2PerTripKg: agg.avgTrip ? Math.round(agg.avgTrip * 100) / 100 : 0,
		avgCo2PerKmG: agg.avgKm ? Math.round(agg.avgKm) : 0,
		modeSplit
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
