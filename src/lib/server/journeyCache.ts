// In-memory cache of the latest vector journey the browser posted.
// Single Vite dev process means this singleton is shared across requests.
// Not suitable for production multi-process deployments — exhibition/dev only.

import type { VectorJourney } from '$lib/utils/vectorExport';

let cached: VectorJourney | null = null;
let updatedAt = 0;

export function getCurrent(): { data: VectorJourney; updatedAt: number } | null {
	return cached ? { data: cached, updatedAt } : null;
}

export function setCurrent(data: VectorJourney): void {
	cached = data;
	updatedAt = Date.now();
}
