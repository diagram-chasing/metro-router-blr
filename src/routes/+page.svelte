<script lang="ts">
	import { browser } from '$app/environment';

	import Map from '$lib/components/Map.svelte';
	import { JourneyCalculator } from '$lib/utils/JourneyCalculator';
	import { computeMetroSegments } from '$lib/utils/mapHelpers';
	import { buildVectorJourney } from '$lib/utils/vectorExport';

	let originPick: [number, number] | null = null;
	let destinationPick: [number, number] | null = null;
	let walkingRouteToStation: string | undefined;
	let walkingRouteFromStation: string | undefined;
	let metroSegments: GeoJSON.FeatureCollection | null = null;
	let isLoading = false;

	let journeyCalculator: JourneyCalculator | undefined;

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
		if (!journeyCalculator) journeyCalculator = new JourneyCalculator();
		try {
			isLoading = true;
			const [journey, segments] = await Promise.all([
				journeyCalculator.calculateJourney(originPick, destinationPick),
				computeMetroSegments({ coordinates: originPick }, { coordinates: destinationPick })
			]);
			walkingRouteToStation = journey?.firstLegWalkRoute;
			walkingRouteFromStation = journey?.secondLegWalkRoute;
			metroSegments = segments;

			// Publish to the TouchDesigner-facing endpoint so TD's poller picks it up.
			if (journey && segments) {
				const vector = buildVectorJourney(originPick, destinationPick, journey, segments);
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
		walkingRouteToStation = undefined;
		walkingRouteFromStation = undefined;
		metroSegments = null;
	}
</script>

<main class="absolute inset-0 bg-white">
	<Map
		{originPick}
		{destinationPick}
		{walkingRouteToStation}
		{walkingRouteFromStation}
		{metroSegments}
		on:pick={handlePick}
	/>
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
