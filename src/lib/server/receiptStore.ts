// Receipt persistence, backed by the local SQLite store (see db.ts).
//
// Exhibition/dev only — a single local server owns the database file. The API
// here is unchanged from the previous in-memory implementation so callers
// (the /api/receipt endpoint) don't need to change.

import type { Answers } from '$lib/exhibit/types';
import type { ComputedReceipt } from './computeReceipt';

import type { Mode } from '$lib/exhibit/types';
import { getSubmission, insertSubmission, listSubmissions } from './db';

export type GeoSnapshot = {
	originLabel?: string;
	destinationLabel?: string;
	// Per-leg breakdown so the receipt strip can render mode splits
	// (e.g. walk + metro + walk for a metro-mixed route).
	segments?: { mode: Mode; lengthM: number }[];
};

export type StoredReceipt = {
	id: string;
	createdAt: number;
	answers: Answers;
	computed: ComputedReceipt;
	geo?: GeoSnapshot;
};

export function putReceipt(r: StoredReceipt): void {
	insertSubmission(r);
}

export function getReceipt(id: string): StoredReceipt | undefined {
	return getSubmission(id);
}

export function listReceipts(): StoredReceipt[] {
	return listSubmissions();
}
