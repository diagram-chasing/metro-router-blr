<script lang="ts">
	import { onMount } from 'svelte';

	import { browser } from '$app/environment';

	import Map from '$lib/components/Map.svelte';
	import { nearbyBusStops, nearestBusStop, type NearestBusStop } from '$lib/utils/busStops';
	import { findBusRouteBetween, type BusRouteMatch } from '$lib/utils/busRouter';
	import { JourneyCalculator } from '$lib/utils/JourneyCalculator';
	import { computeMetroSegments } from '$lib/utils/mapHelpers';
	import { fetchRoadRoute } from '$lib/utils/valhallaRoute';
	import { buildVectorJourney } from '$lib/utils/vectorExport';

	import { buildCandidates, type MetroLegInfo } from './routeCandidates';
	import RouteOptions from './RouteOptions.svelte';
	import { answers, setAnswer } from './store.svelte';

	import pkg from '@mapbox/polyline';
	const { decode: decodePoly } = pkg;

	let originPick = $state<[number, number] | null>(answers.origin ?? null);
	let destinationPick = $state<[number, number] | null>(answers.destination ?? null);
	let cachedWalkTo = $state<string | undefined>(undefined);
	let cachedWalkFrom = $state<string | undefined>(undefined);
	let cachedMetroSegments = $state<GeoJSON.FeatureCollection | null>(null);
	let isLoading = $state(false);
	let lastError = $state<string | null>(null);

	let metroLeg = $state<MetroLegInfo>({});
	let originBus = $state<NearestBusStop | null>(null);
	let destBus = $state<NearestBusStop | null>(null);
	let busMatch = $state<BusRouteMatch | null>(null);
	let cabEncoded = $state<string | undefined>(undefined);
	let walkEncoded = $state<string | undefined>(undefined);
	let busFirstMileEncoded = $state<string | undefined>(undefined);
	let busLastMileEncoded = $state<string | undefined>(undefined);
	// Non-reactive refs: we only need to know what stop coords the cached
	// first/last-mile polylines were fetched against, so we can invalidate them
	// when the matched stops differ. Reading these inside $effect must not
	// trigger re-runs, hence the object-property indirection (Svelte 5's
	// compiler would otherwise either elide unused `let`s or treat $state
	// writes as effect dependencies).
	const busMileTargets: { first: [number, number] | null; last: [number, number] | null } = {
		first: null,
		last: null
	};

	let journeyCalculator: JourneyCalculator | undefined;

	const routeReady = $derived(!!originPick && !!destinationPick && !!answers.distanceKm);

	const statusLabel = $derived(
		!originPick
			? 'Tap map to set origin'
			: !destinationPick
				? 'Tap to set destination'
				: 'Total distance'
	);

	const candidates = $derived(
		routeReady ? buildCandidates(answers, metroLeg, originBus, destBus) : []
	);

	const selectedCandidate = $derived(
		candidates.find((c) => c.id === answers.chosenRouteId) ?? null
	);
	// When the user hasn't picked yet, preview the top candidate so the map
	// isn't blank between dropping pins and tapping a card. Selection state in
	// the panel UI stays driven by chosenRouteId only.
	const previewCandidate = $derived(selectedCandidate ?? candidates[0] ?? null);
	const selectedKind = $derived(previewCandidate?.kind);

	// Show metro walks only when the previewed option is metro.
	const walkingRouteToStation = $derived(
		selectedKind === 'metro' ? cachedWalkTo : undefined
	);
	const walkingRouteFromStation = $derived(
		selectedKind === 'metro' ? cachedWalkFrom : undefined
	);

	function fcFromCoordLists(lines: [number, number][][]): GeoJSON.FeatureCollection {
		return {
			type: 'FeatureCollection',
			features: lines.map((coords) => ({
				type: 'Feature',
				properties: {},
				geometry: { type: 'LineString', coordinates: coords }
			}))
		};
	}

	function decodeMapboxPolyline(encoded: string): [number, number][] {
		// Mapbox precision=5 polylines come back as [lat, lng]; the rest of the app
		// works in [lng, lat].
		return decodePoly(encoded).map(([lat, lng]) => [lng, lat] as [number, number]);
	}

	// metroSegments doubles as "lines to render" for the selected option. Metro
	// renders the metro polyline; cab/auto/walk render Valhalla road lines (with
	// straight-line fallback while loading); bus renders the GTFS route polyline
	// between the two nearest stops with short connector segments to/from the pins.
	const metroSegments = $derived.by<GeoJSON.FeatureCollection | null>(() => {
		if (!originPick || !destinationPick || !selectedKind) return null;

		if (selectedKind === 'metro') return cachedMetroSegments;

		if (selectedKind === 'cab' || selectedKind === 'auto') {
			if (cabEncoded) {
				return fcFromCoordLists([decodeMapboxPolyline(cabEncoded)]);
			}
			return fcFromCoordLists([[originPick, destinationPick]]);
		}

		if (selectedKind === 'walk') {
			if (walkEncoded) {
				return fcFromCoordLists([decodeMapboxPolyline(walkEncoded)]);
			}
			return fcFromCoordLists([[originPick, destinationPick]]);
		}

		if (selectedKind === 'bus' && originBus && destBus) {
			// Once a match is found, prefer the stops the matched service actually
			// uses (may differ from the absolute nearest if a slightly-farther stop
			// had a direct service).
			const oStop: [number, number] = busMatch
				? busMatch.originStopCoord
				: [originBus.stop.lon, originBus.stop.lat];
			const dStop: [number, number] = busMatch
				? busMatch.destStopCoord
				: [destBus.stop.lon, destBus.stop.lat];
			const firstMile = busFirstMileEncoded
				? decodeMapboxPolyline(busFirstMileEncoded)
				: [originPick, oStop];
			const lastMile = busLastMileEncoded
				? decodeMapboxPolyline(busLastMileEncoded)
				: [dStop, destinationPick];
			if (busMatch) {
				return fcFromCoordLists([firstMile, busMatch.coords, lastMile]);
			}
			// Still resolving (or no GTFS match): keep straight stop→stop as fallback.
			return fcFromCoordLists([firstMile, [oStop, dStop], lastMile]);
		}

		return fcFromCoordLists([[originPick, destinationPick]]);
	});

	// Lazy-fetch the road/transit polyline once a kind is actually picked. Each
	// fetcher is internally cached so repeated picks don't re-hit the network.
	$effect(() => {
		if (!originPick || !destinationPick || !selectedKind) return;

		if ((selectedKind === 'cab' || selectedKind === 'auto') && !cabEncoded) {
			void fetchRoadRoute(originPick, destinationPick, 'auto').then((r) => {
				if (r) cabEncoded = r.encoded;
			});
		}
		if (selectedKind === 'walk' && !walkEncoded) {
			void fetchRoadRoute(originPick, destinationPick, 'pedestrian').then((r) => {
				if (r) walkEncoded = r.encoded;
			});
		}
		if (selectedKind === 'bus' && originPick && destinationPick) {
			if (!busMatch) {
				const oPin = originPick;
				const dPin = destinationPick;
				void (async () => {
					const [oCands, dCands] = await Promise.all([
						nearbyBusStops(oPin, 600, 6).catch(() => []),
						nearbyBusStops(dPin, 600, 6).catch(() => [])
					]);
					if (oCands.length === 0 || dCands.length === 0) return;
					const m = await findBusRouteBetween(
						oCands.map((s) => ({ id: s.stop.id, coord: [s.stop.lon, s.stop.lat] })),
						dCands.map((s) => ({ id: s.stop.id, coord: [s.stop.lon, s.stop.lat] }))
					).catch((err) => {
						console.warn('bus route lookup failed', err);
						return null;
					});
					if (!m) return;
					// If the match uses different stops than what first/last mile was
					// fetched against, invalidate so the effect refetches.
					if (busMatch === null) {
						const oKey = busMileTargets.first;
						const dKey = busMileTargets.last;
						if (oKey && !coordsEqual(oKey, m.originStopCoord)) busFirstMileEncoded = undefined;
						if (dKey && !coordsEqual(dKey, m.destStopCoord)) busLastMileEncoded = undefined;
					}
					busMatch = m;
				})();
			}
			// First/last mile uses the matched stops if available, else nearest.
			const oStop: [number, number] = busMatch
				? busMatch.originStopCoord
				: originBus
					? [originBus.stop.lon, originBus.stop.lat]
					: originPick;
			const dStop: [number, number] = busMatch
				? busMatch.destStopCoord
				: destBus
					? [destBus.stop.lon, destBus.stop.lat]
					: destinationPick;
			if (!busFirstMileEncoded) {
				busMileTargets.first = oStop;
				void fetchRoadRoute(originPick, oStop, 'pedestrian').then((r) => {
					if (r) busFirstMileEncoded = r.encoded;
				});
			}
			if (!busLastMileEncoded) {
				busMileTargets.last = dStop;
				void fetchRoadRoute(dStop, destinationPick, 'pedestrian').then((r) => {
					if (r) busLastMileEncoded = r.encoded;
				});
			}
		}
	});

	function coordsEqual(a: [number, number], b: [number, number]): boolean {
		return Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;
	}

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
			const [journey, segments, oBus, dBus] = await Promise.all([
				journeyCalculator.calculateJourney(originPick, destinationPick),
				computeMetroSegments({ coordinates: originPick }, { coordinates: destinationPick }),
				nearestBusStop(originPick).catch(() => null),
				nearestBusStop(destinationPick).catch(() => null)
			]);
			cachedWalkTo = journey?.firstLegWalkRoute;
			cachedWalkFrom = journey?.secondLegWalkRoute;
			cachedMetroSegments = segments;
			originBus = oBus;
			destBus = dBus;

			if (journey) {
				setAnswer('distanceKm', journey.totalDistanceKm);
				setAnswer('originStation', journey.originStation);
				setAnswer('destinationStation', journey.destinationStation);

				metroLeg = {
					originStation: journey.originStation,
					destinationStation: journey.destinationStation,
					totalMetroMin: journey.firstLegMetroTime + journey.secondLegMetroTime,
					originWalkMeters: journey.firstLegWalkDistance,
					destinationWalkMeters: journey.secondLegWalkDistance
				};

				if (segments) {
					const vector = buildVectorJourney(originPick, destinationPick, journey, segments);
					fetch('/api/journey/current', {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify(vector)
					}).catch((err) => console.warn('Failed to publish vector journey:', err));
				}
			} else {
				metroLeg = {};
				// Bus distance is straight-line; good enough to surface bus/cab/auto/walk
				// candidates even when the metro route can't be computed.
				if (oBus && dBus) {
					const km = straightLineKm(originPick, destinationPick);
					setAnswer('distanceKm', km);
				} else {
					lastError = 'Could not find a route — try pins closer to the metro network.';
				}
			}
		} catch (err) {
			console.error('Journey calculation failed:', err);
			lastError = err instanceof Error ? err.message : 'Route calculation failed.';
		} finally {
			isLoading = false;
		}
	}

	function straightLineKm(a: [number, number], b: [number, number]): number {
		const R = 6371;
		const toRad = Math.PI / 180;
		const dLat = (b[1] - a[1]) * toRad;
		const dLon = (b[0] - a[0]) * toRad;
		const lat1 = a[1] * toRad;
		const lat2 = b[1] * toRad;
		const s = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
		return 2 * R * Math.asin(Math.sqrt(s));
	}

	onMount(() => {
		if (originPick && destinationPick) {
			void calculate();
		}
	});

	function clear() {
		originPick = null;
		destinationPick = null;
		cachedWalkTo = undefined;
		cachedWalkFrom = undefined;
		cachedMetroSegments = null;
		lastError = null;
		metroLeg = {};
		originBus = null;
		destBus = null;
		busMatch = null;
		cabEncoded = undefined;
		walkEncoded = undefined;
		busFirstMileEncoded = undefined;
		busLastMileEncoded = undefined;
		busMileTargets.first = null;
		busMileTargets.last = null;
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
		<Map
			{originPick}
			{destinationPick}
			{walkingRouteToStation}
			{walkingRouteFromStation}
			{metroSegments}
			on:pick={handlePick}
		/>

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
