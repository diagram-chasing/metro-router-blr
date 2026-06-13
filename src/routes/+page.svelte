<script lang="ts">
	import { browser } from '$app/environment';

	import Map from '$lib/components/Map.svelte';
	import { planAllModes, firstWithMode } from '$lib/utils/otp';
	import { itineraryToSegments, type RouteSegment } from '$lib/exhibit/routeCandidates';
	import { buildVectorJourneyFromItinerary } from '$lib/utils/vectorExport';

	let originPick: [number, number] | null = null;
	let destinationPick: [number, number] | null = null;
	let segments: RouteSegment[] | null = null;
	let isLoading = false;

	async function handlePick(e: CustomEvent<{ lng: number; lat: number }>) {
		if (isLoading) return;
		const point: [number, number] = [e.detail.lng, e.detail.lat];

		if (!originPick) {
			originPick = point;
			return;
		}
		if (!destinationPick) {
			destinationPick = point;
			await calculateJourney();
		}
	}

	async function calculateJourney() {
		if (!browser || !originPick || !destinationPick) return;
		try {
			isLoading = true;
			const bundle = await planAllModes(originPick, destinationPick);
			const itinerary =
				firstWithMode(bundle.metro, 'SUBWAY') ??
				firstWithMode(bundle.bus, 'BUS') ??
				bundle.car[0] ??
				bundle.walk[0] ??
				null;

			segments = itinerary ? itineraryToSegments(itinerary) : null;

			// Publish to the TouchDesigner-facing endpoint so TD's poller picks it up.
			if (itinerary) {
				const vector = buildVectorJourneyFromItinerary(originPick, destinationPick, itinerary, {
					priceINR: 0
				});
				fetch('/api/journey/current', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(vector)
				}).catch((e) => console.warn('Failed to publish vector journey:', e));
			}
		} catch (error) {
			console.error('Journey calculation failed:', error);
		} finally {
			isLoading = false;
		}
	}

	function reset() {
		originPick = null;
		destinationPick = null;
		segments = null;
	}
</script>

<main class="absolute inset-0 bg-white">
	<Map {originPick} {destinationPick} {segments} on:pick={handlePick} />
	<button type="button" class="reset-btn" on:click={reset} disabled={isLoading}>Reset</button>
</main>

<style>
	.reset-btn {
		position: absolute;
		top: 16px;
		right: 16px;
		z-index: 10;
		background: #ffffff;
		color: #000000;
		border: 1px solid #000000;
		padding: 6px 14px;
		font-size: 12px;
		font-family: inherit;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		cursor: pointer;
	}
	.reset-btn:hover:not(:disabled) {
		background: #000000;
		color: #ffffff;
	}
	.reset-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
