// Dev-only gallery: ~12 hand-picked permutations rendered as real on-screen
// receipts (ReceiptDoc → RouteMap + Stamp + QR), for layout / length / tone
// spot-checks the text matrix can't show. Same fixtures as scripts/receiptMatrix.ts.

import { buildCase, type Combo } from '$lib/receipt/_fixtures';

export const ssr = false; // RouteMap / Stamp / QR are client-only

type GalleryCombo = Omit<Combo, 'frequency' | 'lifestyle' | 'tripName' | 'seedId'> & {
	tripName?: string;
};

let n = 0;
const make = (label: string, p: GalleryCombo) => ({
	label,
	view: buildCase({
		frequency: 'daily',
		lifestyle: 'moderate',
		tripName: p.tripName ?? 'medium',
		seedId: `gallery-${n++}`,
		...p
	}).view
});

export function load() {
	const cases = [
		make('car → metro · the cleaner gap', {
			usualMode: 'car',
			pickedKind: 'metro',
			distanceKm: 6,
			dataState: 'populated'
		}),
		make('metro → cab · the inverse gap', {
			usualMode: 'metro',
			pickedKind: 'cab',
			distanceKm: 6,
			dataState: 'populated'
		}),
		make('auto → auto · no gap, single verdict', {
			usualMode: 'auto',
			pickedKind: 'auto',
			distanceKm: 6,
			dataState: 'populated'
		}),
		make('bus · no route drawn (no map, no gap)', {
			usualMode: 'bus',
			pickedKind: 'none',
			distanceKm: 6,
			dataState: 'populated'
		}),
		make('car → metro · critical + gap', {
			usualMode: 'car',
			pickedKind: 'metro',
			distanceKm: 6,
			dataState: 'populated'
		}),
		make('metro → metro · affirm, no gap', {
			usualMode: 'metro',
			pickedKind: 'metro',
			distanceKm: 6,
			dataState: 'populated'
		}),
		make('car → walk · huge cleaner gap (short)', {
			usualMode: 'car',
			pickedKind: 'walk',
			distanceKm: 2,
			tripName: 'short',
			dataState: 'populated'
		}),
		make('two_wheeler → metro · long trip', {
			usualMode: 'two_wheeler',
			pickedKind: 'metro',
			distanceKm: 18,
			tripName: 'long',
			dataState: 'populated'
		}),
		make('car → road route · no gap (merged car/cab)', {
			usualMode: 'car',
			pickedKind: 'cab',
			distanceKm: 6,
			dataState: 'populated'
		}),
		make('auto · empty data (no histogram/odometer)', {
			usualMode: 'auto',
			pickedKind: 'none',
			distanceKm: 6,
			dataState: 'empty'
		}),
		make('car → metro · very short (clean-year branch)', {
			usualMode: 'car',
			pickedKind: 'metro',
			distanceKm: 0.8,
			tripName: 'very-short',
			dataState: 'populated'
		}),
		make('metro · occasional, no route, sparse data', {
			usualMode: 'metro',
			pickedKind: 'none',
			distanceKm: 6,
			dataState: 'sparse'
		})
	];
	return { cases };
}
