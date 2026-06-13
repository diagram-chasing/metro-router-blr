<script lang="ts">
	import { onMount } from 'svelte';

	import { browser } from '$app/environment';

	import Map from '$lib/components/Map.svelte';
	import { planAllModes, type PlanBundle } from '$lib/utils/otp';
	import { buildVectorJourneyFromItinerary } from '$lib/utils/vectorExport';

	import { buildOtpCandidates, stationNames, tripDistanceKm } from './routeCandidates';
	import RouteOptions from './RouteOptions.svelte';
	import { answers, setAnswer } from './store.svelte';

	let originPick = $state<[number, number] | null>(answers.origin ?? null);
	let destinationPick = $state<[number, number] | null>(answers.destination ?? null);
	let bundle = $state<PlanBundle | null>(null);
	let isLoading = $state(false);
	let lastError = $state<string | null>(null);

	const routeReady = $derived(!!originPick && !!destinationPick && !!bundle);

	const statusLabel = $derived(
		!originPick
			? 'Tap map to set origin'
			: !destinationPick
				? 'Tap to set destination'
				: 'Total distance'
	);

	const candidates = $derived(bundle ? buildOtpCandidates(answers, bundle) : []);

	const selectedCandidate = $derived(
		candidates.find((c) => c.id === answers.chosenRouteId) ?? null
	);
	// When the user hasn't picked yet, preview the top candidate so the map
	// isn't blank between dropping pins and tapping a card. Selection state in
	// the panel UI stays driven by chosenRouteId only.
	const previewCandidate = $derived(selectedCandidate ?? candidates[0] ?? null);

	// The map renders the previewed candidate's real OTP geometry, leg by leg.
	const mapSegments = $derived(previewCandidate?.segments ?? null);

	// Publish the previewed route as a "vector journey" for the receipt /
	// TouchDesigner consumers whenever the selection (or pins) change.
	$effect(() => {
		if (!browser || !originPick || !destinationPick) return;
		const c = previewCandidate;
		if (!c?.itinerary) return;
		const vector = buildVectorJourneyFromItinerary(originPick, destinationPick, c.itinerary, {
			priceINR: c.costINR,
			distanceKm: answers.distanceKm
		});
		void fetch('/api/journey/current', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(vector)
		}).catch((err) => console.warn('Failed to publish vector journey:', err));
	});

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
		try {
			isLoading = true;
			lastError = null;

			const b = await planAllModes(originPick, destinationPick);
			bundle = b;

			const hasAny =
				b.metro.length > 0 || b.bus.length > 0 || b.car.length > 0 || b.walk.length > 0;
			if (!hasAny) {
				lastError = 'Could not find a route — try different pins.';
				return;
			}

			const dist = tripDistanceKm(b);
			if (dist > 0) setAnswer('distanceKm', dist);

			const stns = stationNames(b);
			setAnswer('originStation', stns.origin);
			setAnswer('destinationStation', stns.destination);
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
		bundle = null;
		lastError = null;
		setAnswer('origin', undefined);
		setAnswer('destination', undefined);
		setAnswer('distanceKm', undefined);
		setAnswer('originStation', undefined);
		setAnswer('destinationStation', undefined);
		setAnswer('chosenRouteId', undefined);
	}
</script>

<div class="wrap">
	<div class="map-area">
		<Map {originPick} {destinationPick} segments={mapSegments} on:pick={handlePick} />

		<div class="hud" class:dim={isLoading}>
			<div class="schematic" aria-hidden="true">
				<span class="dot" class:lit={!!originPick}></span>
				<span class="link" class:lit={!!originPick && !!destinationPick}></span>
				<span class="dot" class:lit={!!destinationPick}></span>
			</div>

			<div class="readout">
				<div class="value">
					{#if answers.distanceKm}
						<span class="num">{answers.distanceKm.toFixed(2)}</span>
						<span class="unit">km</span>
					{:else}
						<span class="num placeholder">––.––</span>
						<span class="unit placeholder">km</span>
					{/if}
				</div>
				<span class="lbl">{statusLabel}</span>
			</div>

			{#if originPick || destinationPick}
				<button
					type="button"
					class="clear"
					onclick={clear}
					disabled={isLoading}
					aria-label="Clear pins"
					title="Clear pins"
				>
					<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
						<path
							d="M3 3 L11 11 M11 3 L3 11"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
						/>
					</svg>
				</button>
			{/if}
		</div>

		{#if isLoading}
			<div class="loading">CRUNCHING ROUTE…</div>
		{/if}

		{#if lastError}
			<div class="err">{lastError}</div>
		{/if}
	</div>

	<RouteOptions
		{candidates}
		selectedId={answers.chosenRouteId}
		locked={!routeReady}
		onSelect={(id) => setAnswer('chosenRouteId', id)}
	/>
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

	/* HUD anchored bottom-center of the map */
	.hud {
		position: absolute;
		left: 50%;
		bottom: 20px;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 12px 16px 12px 18px;
		background: #141414;
		border: 1px solid #2a2a2a;
		border-radius: 10px;
		box-shadow: 0 12px 36px rgba(0, 0, 0, 0.55);
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		color: #ededed;
		min-width: 320px;
		transition: opacity 0.2s ease;
	}
	.hud.dim {
		opacity: 0.55;
	}

	/* Route schematic: ○━━○ that fills in as pins are placed */
	.schematic {
		display: flex;
		align-items: center;
		gap: 0;
		flex-shrink: 0;
	}
	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		border: 1.5px solid #4a4a4a;
		background: transparent;
		transition:
			background 0.2s ease,
			border-color 0.2s ease;
	}
	.dot.lit {
		background: #ededed;
		border-color: #ededed;
	}
	.link {
		width: 22px;
		height: 1.5px;
		background: #4a4a4a;
		transition: background 0.2s ease;
	}
	.link.lit {
		background: #ededed;
	}

	.readout {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		flex: 1;
		min-width: 0;
	}
	.value {
		display: flex;
		align-items: baseline;
		gap: 5px;
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	.num {
		font-size: 22px;
		font-weight: 500;
		color: #ededed;
		letter-spacing: 0;
	}
	.unit {
		font-size: 12px;
		font-weight: 400;
		color: #8a8a8a;
		letter-spacing: 0;
	}
	.placeholder {
		color: #3a3a3a;
	}
	.lbl {
		font-size: 9px;
		font-weight: 600;
		letter-spacing: 0.22em;
		color: #7a7a7a;
		text-transform: uppercase;
		line-height: 1;
	}

	.clear {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: 4px;
		color: #6a6a6a;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			color 0.15s ease,
			background 0.15s ease;
	}
	.clear:hover:not(:disabled) {
		color: #ededed;
		background: rgba(255, 255, 255, 0.06);
	}
	.clear:disabled {
		opacity: 0.35;
		cursor: not-allowed;
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
