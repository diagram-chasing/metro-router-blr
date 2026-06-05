// In-memory store of computed receipts, keyed by id.
// Single Vite dev process means this singleton is shared across requests.
// Not suitable for production multi-process deployments — exhibition/dev only.

import type { Answers } from '$lib/exhibit/types';
import type { ComputedReceipt } from './computeReceipt';

import type { Mode } from '$lib/exhibit/types';

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

const receipts = new Map<string, StoredReceipt>();

const MAX_KEEP = 500;

export function putReceipt(r: StoredReceipt): void {
	receipts.set(r.id, r);
	if (receipts.size > MAX_KEEP) {
		const oldest = receipts.keys().next().value;
		if (oldest !== undefined) receipts.delete(oldest);
	}
}

export function getReceipt(id: string): StoredReceipt | undefined {
	return receipts.get(id);
}

export function listReceipts(): StoredReceipt[] {
	return Array.from(receipts.values()).sort((a, b) => b.createdAt - a.createdAt);
}
