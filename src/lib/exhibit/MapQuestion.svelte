<script lang="ts">
	import { onMount } from 'svelte';

	import { browser } from '$app/environment';

	import Map from '$lib/components/Map.svelte';
	import { JourneyCalculator } from '$lib/utils/JourneyCalculator';
	import { computeMetroSegments } from '$lib/utils/mapHelpers';
	import { buildVectorJourney } from '$lib/utils/vectorExport';

	import { PRESET_OPTIONS } from './questions';
	import { answers, setAnswer } from './store.svelte';
	import TactileButton from './TactileButton.svelte';

	let originPick = $state<[number, number] | null>(answers.origin ?? null);
	let destinationPick = $state<[number, number] | null>(answers.destination ?? null);
	let walkingRouteToStation = $state<string | undefined>(undefined);
	let walkingRouteFromStation = $state<string | undefined>(undefined);
	let metroSegments = $state<GeoJSON.FeatureCollection | null>(null);
	let isLoading = $state(false);
	let lastError = $state<string | null>(null);

	let journeyCalculator: JourneyCalculator | undefined;

	const routeReady = $derived(!!originPick && !!destinationPick && !!answers.distanceKm);

	async function handlePick(e: CustomEvent<{ lng: number; lat: number }>) {
		if (isLoading) return;
		const point: [number, number] = [e.detail.lng, e.detail.lat];

		if (!originPick) {
			originPick = point;
			setAnswer('origin', point);
			return;
		}
		if (!destinationPick) {
			destinationPick = point;
			setAnswer('destination', point);
			await calculate();
		}
	}

	async function calculate() {
		if (!browser || !originPick || !destinationPick) return;
		if (!journeyCalculator) journeyCalculator = new JourneyCalculator();
		try {
			isLoading = true;
			lastError = null;
			const [journey, segments] = await Promise.all([
				journeyCalculator.calculateJourney(originPick, destinationPick),
				computeMetroSegments({ coordinates: originPick }, { coordinates: destinationPick })
			]);
			walkingRouteToStation = journey?.firstLegWalkRoute;
			walkingRouteFromStation = journey?.secondLegWalkRoute;
			metroSegments = segments;

			if (journey) {
				setAnswer('distanceKm', journey.totalDistanceKm);
				setAnswer('originStation', journey.originStation);
				setAnswer('destinationStation', journey.destinationStation);

				if (segments) {
					const vector = buildVectorJourney(originPick, destinationPick, journey, segments);
					fetch('/api/journey/current', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(vector)
					}).catch((err) => console.warn('Failed to publish vector journey:', err));
				}
			} else {
				lastError = 'Could not find a route — try pins closer to the metro network.';
			}
		} catch (err) {
			console.error('Journey calculation failed:', err);
			lastError = err instanceof Error ? err.message : 'Route calculation failed.';
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		if (originPick && destinationPick) {
			void calculate();
		}
	});

	function clear() {
		originPick = null;
		destinationPick = null;
		walkingRouteToStation = undefined;
		walkingRouteFromStation = undefined;
		metroSegments = null;
		lastError = null;
		setAnswer('origin', undefined);
		setAnswer('destination', undefined);
		setAnswer('distanceKm', undefined);
		setAnswer('originStation', undefined);
		setAnswer('destinationStation', undefined);
		setAnswer('chosenPreset', undefined);
	}
</script>

<div class="wrap">
	<div class="map-area">
		<Map
			{originPick}
			{destinationPick}
			{walkingRouteToStation}
			{walkingRouteFromStation}
			{metroSegments}
			on:pick={handlePick}
		/>

		<div class="hud" class:dim={isLoading}>
			<button type="button" class="clear" onclick={clear} disabled={isLoading}>CLEAR PINS</button>

			<div class="readout">
				<div class="cell">
					<span class="lbl">ORIGIN</span>
					<span class="val" class:lit={!!originPick}>
						{originPick ? '● SET' : '— TAP MAP —'}
					</span>
				</div>
				<div class="cell">
					<span class="lbl">DESTINATION</span>
					<span class="val" class:lit={!!destinationPick}>
						{destinationPick ? '● SET' : originPick ? '— TAP AGAIN —' : '...'}
					</span>
				</div>
				<div class="cell">
					<span class="lbl">TOTAL DIST</span>
					<span class="val" class:lit={!!answers.distanceKm}>
						{answers.distanceKm ? `${answers.distanceKm.toFixed(2)} KM` : '—— · ——'}
					</span>
				</div>
			</div>
		</div>

		{#if isLoading}
			<div class="loading">CRUNCHING ROUTE…</div>
		{/if}

		{#if lastError}
			<div class="err">{lastError}</div>
		{/if}
	</div>

	<aside class="presets-panel">
		<div class="presets-head">
			<span class="presets-title">HOW WOULD YOU MAKE IT?</span>
		</div>

		<div class="presets-list" class:locked={!routeReady}>
			{#each PRESET_OPTIONS as p (p.value)}
				<div class="preset-cell">
					<TactileButton
						label={p.label}
						size="lg"
						glow="amber"
						selected={answers.chosenPreset === p.value}
						disabled={!routeReady}
						onclick={() => setAnswer('chosenPreset', p.value)}
					/>
				</div>
			{/each}
		</div>
	</aside>
</div>

<style>
	.wrap {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 18px;
	}

	.map-area {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		border: 2px solid #1c1c1c;
		border-radius: 12px;
		overflow: hidden;
		background: #fff;
		box-shadow:
			inset 0 0 0 1px rgba(255, 255, 255, 0.03),
			inset 0 0 32px rgba(0, 0, 0, 0.6);
	}

	.presets-panel {
		flex: 0 0 340px;
		display: flex;
		flex-direction: column;
		gap: 18px;
		padding: 18px 18px 22px;
		background: #161616;
		border: 1px solid #050505;
		border-radius: 12px;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.04),
			inset 0 -1px 0 rgba(0, 0, 0, 0.6);
	}

	.presets-head {
		padding: 4px 4px 12px;
		border-bottom: 1px solid #2a2a2a;
	}
	.presets-title {
		display: block;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 13px;
		letter-spacing: 0.2em;
		color: #ededed;
	}

	.presets-list {
		flex: 1;
		display: grid;
		grid-auto-rows: 1fr;
		gap: 16px;
		min-height: 0;
	}
	.presets-list.locked {
		opacity: 0.55;
	}

	.preset-cell {
		min-height: 0;
		display: flex;
	}

	/* HUD anchored bottom-center of the map */
	.hud {
		position: absolute;
		left: 50%;
		bottom: 18px;
		transform: translateX(-50%);
		display: flex;
		align-items: stretch;
		gap: 14px;
		padding: 12px 14px;
		background: #161616;
		border: 1px solid #050505;
		border-radius: 10px;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.05),
			0 6px 22px rgba(0, 0, 0, 0.7);
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		color: #b0b0b0;
	}
	.hud.dim {
		opacity: 0.6;
	}

	.clear {
		background: #1c1c1c;
		color: #c0c0c0;
		border: 1px solid #050505;
		padding: 10px 14px;
		border-radius: 6px;
		font-family: inherit;
		font-size: 12px;
		letter-spacing: 0.16em;
		font-weight: 600;
		cursor: pointer;
		text-transform: uppercase;
		box-shadow:
			inset 0 1px 0 rgba(255, 255, 255, 0.05),
			0 2px 0 #050505;
	}
	.clear:active:not(:disabled) {
		transform: translateY(1px);
		box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.5);
	}
	.clear:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.readout {
		display: flex;
		gap: 18px;
		align-items: stretch;
	}
	.cell {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 4px 12px;
		border-left: 1px solid #2a2a2a;
	}
	.cell:first-child {
		border-left: none;
	}
	.lbl {
		font-size: 10px;
		letter-spacing: 0.22em;
		color: #6a6a6a;
	}
	.val {
		font-size: 16px;
		letter-spacing: 0.1em;
		color: #4a4a4a;
	}
	.val.lit {
		color: #ededed;
	}

	.loading {
		position: absolute;
		top: 16px;
		left: 50%;
		transform: translateX(-50%);
		padding: 8px 16px;
		background: rgba(16, 16, 16, 0.94);
		color: #ededed;
		font-family: 'IBM Plex Mono', monospace;
		font-size: 13px;
		letter-spacing: 0.22em;
		border-radius: 6px;
	}
	.err {
		position: absolute;
		top: 16px;
		right: 16px;
		max-width: 280px;
		padding: 10px 14px;
		background: rgba(60, 16, 12, 0.95);
		color: #ffb098;
		font-family: 'IBM Plex Mono', monospace;
		font-size: 12px;
		letter-spacing: 0.08em;
		border-radius: 6px;
	}
</style>
