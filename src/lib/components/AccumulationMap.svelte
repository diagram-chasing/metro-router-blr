<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	import maplibre from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { GREY_BG, GREY_SHADES } from '$lib/exhibit/grey';
	import { renderAllStationsAndLines } from '$lib/utils/mapHelpers';

	// One accumulated route as the /api/lines endpoint serves it.
	type WireLine = {
		id: number;
		greyBucket: number;
		co2PerKmG: number;
		chosenMode: string;
		segments: { coords: [number, number][]; legKind: string }[];
	};
	type Stats = { count: number; avgCo2PerTripKg: number; avgCo2PerKmG: number };

	let mapContainer: HTMLDivElement;
	let map: maplibre.Map | undefined;
	let styleReady = false;
	let pollTimer: ReturnType<typeof setInterval> | undefined;

	let lastId = 0;
	const drawnIds = new Set<number>();

	let stats = $state<Stats | null>(null);

	// ── URL-param layer config (read once on mount; a TD source sets these per URL) ──
	// ?basemap=0|1  ?lines=0|1  ?recent=0|1  ?stations=0|1  ?hud=0|1
	// ?bg=<css color>  ?poll=<ms>
	let showBasemap = true;
	let showLines = true;
	let recentOnly = false;
	let showStations = false;
	let showHud = false;
	let bg = GREY_BG;
	let pollMs = 4000;

	const flag = (p: URLSearchParams, key: string, def: boolean) => {
		const v = p.get(key);
		return v === null ? def : v === '1' || v === 'true';
	};

	const BENGALURU = { lng: 77.5946, lat: 12.9716, zoom: 11 };

	function makeStyle(): maplibre.StyleSpecification {
		const base: maplibre.StyleSpecification = {
			version: 8,
			name: 'Accumulation',
			sources: {},
			glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
			layers: [{ id: 'background', type: 'background', paint: { 'background-color': bg } }]
		};
		if (!showBasemap) return base;
		// Faint b&w geographic context (same vocabulary as the exhibit map).
		base.sources = { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } };
		base.layers[0].paint = { 'background-color': '#ffffff' };
		const road = (id: string, classes: string[], w: [number, number][]): maplibre.LayerSpecification => ({
			id,
			type: 'line',
			source: 'openmaptiles',
			'source-layer': 'transportation',
			filter: ['in', 'class', ...classes],
			paint: {
				'line-color': '#000000',
				'line-width': ['interpolate', ['linear'], ['zoom'], ...w.flat()],
				'line-opacity': 0.06
			}
		});
		base.layers.push(
			{
				id: 'water',
				type: 'fill',
				source: 'openmaptiles',
				'source-layer': 'water',
				paint: { 'fill-color': '#000000', 'fill-opacity': 0.05 }
			},
			road('road-secondary', ['secondary', 'tertiary'], [
				[9, 0.4],
				[16, 1.6]
			]),
			road('road-primary', ['primary', 'trunk', 'motorway'], [
				[6, 0.5],
				[16, 2.5]
			])
		);
		return base;
	}

	// ── Line drawing ──────────────────────────────────────────────────────────
	const lineWidth = () => (recentOnly ? 4 : 2.5);

	function feature(coords: [number, number][]): GeoJSON.Feature<GeoJSON.LineString> {
		return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } };
	}

	function addLine(line: WireLine) {
		if (!map || drawnIds.has(line.id)) return;
		const color = GREY_SHADES[Math.max(0, Math.min(GREY_SHADES.length - 1, line.greyBucket))];
		line.segments.forEach((seg, i) => {
			if (!map || seg.coords.length < 2) return;
			const sid = `line-${line.id}-${i}`;
			if (!map.getSource(sid)) map.addSource(sid, { type: 'geojson', data: feature(seg.coords) });
			// On the white base map a dark casing keeps even near-white (dirty)
			// lines legible. Skipped when the base map is off so the TD input stays
			// a clean grey-on-black luminance ramp with nothing bleeding into it.
			if (showBasemap && !map.getLayer(`${sid}-casing`)) {
				map.addLayer({
					id: `${sid}-casing`,
					type: 'line',
					source: sid,
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': '#0a0a0a', 'line-width': lineWidth() + 3, 'line-opacity': 0.55 }
				});
			}
			if (!map.getLayer(`${sid}-l`)) {
				map.addLayer({
					id: `${sid}-l`,
					type: 'line',
					source: sid,
					layout: { 'line-join': 'round', 'line-cap': 'round' },
					paint: { 'line-color': color, 'line-width': lineWidth(), 'line-opacity': 0.95 }
				});
			}
		});
		drawnIds.add(line.id);
		if (line.id > lastId) lastId = line.id;
	}

	function clearLines() {
		if (!map) return;
		for (const id of drawnIds) {
			let i = 0;
			while (map.getLayer(`line-${id}-${i}-l`) || map.getLayer(`line-${id}-${i}-casing`)) {
				if (map.getLayer(`line-${id}-${i}-l`)) map.removeLayer(`line-${id}-${i}-l`);
				if (map.getLayer(`line-${id}-${i}-casing`)) map.removeLayer(`line-${id}-${i}-casing`);
				if (map.getSource(`line-${id}-${i}`)) map.removeSource(`line-${id}-${i}`);
				i++;
			}
		}
		drawnIds.clear();
		lastId = 0;
	}

	async function refresh() {
		if (!map || !styleReady) return;
		try {
			if (showLines) {
				if (recentOnly) {
					const res = await fetch('/api/lines?recent=1');
					const { lines } = (await res.json()) as { lines: WireLine[] };
					const latest = lines[0];
					if (latest && !drawnIds.has(latest.id)) {
						clearLines();
						addLine(latest);
					}
				} else {
					const res = await fetch(`/api/lines?sinceId=${lastId}`);
					const { lines } = (await res.json()) as { lines: WireLine[] };
					for (const l of lines) addLine(l);
				}
			}
			if (showHud) {
				const s = await fetch('/api/stats');
				stats = (await s.json()) as Stats;
			}
		} catch (err) {
			console.warn('Accumulation refresh failed:', err);
		}
	}

	onMount(() => {
		const p = new URLSearchParams(window.location.search);
		showBasemap = flag(p, 'basemap', true);
		showLines = flag(p, 'lines', true);
		recentOnly = flag(p, 'recent', false);
		showStations = flag(p, 'stations', false);
		showHud = flag(p, 'hud', false);
		bg = p.get('bg') ?? GREY_BG;
		pollMs = Math.max(1000, Number(p.get('poll') ?? 4000) || 4000);

		map = new maplibre.Map({
			container: mapContainer,
			style: makeStyle(),
			center: [BENGALURU.lng, BENGALURU.lat],
			zoom: BENGALURU.zoom,
			dragPan: false,
			dragRotate: false,
			scrollZoom: false,
			doubleClickZoom: false,
			touchZoomRotate: false,
			touchPitch: false,
			keyboard: false,
			boxZoom: false,
			attributionControl: showBasemap ? undefined : false
		});

		map.on('load', () => {
			styleReady = true;
			if (!map) return;
			if (showStations && showBasemap) renderAllStationsAndLines(map);
			void refresh();
			pollTimer = setInterval(() => void refresh(), pollMs);
		});

		return () => {
			if (pollTimer) clearInterval(pollTimer);
			map?.remove();
		};
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});
</script>

<div class="wrap">
	<div bind:this={mapContainer} class="map"></div>
	{#if showHud && stats}
		<div class="hud">
			<div class="row"><span class="lbl">routes</span><span class="val">{stats.count}</span></div>
			<div class="row">
				<span class="lbl">avg / trip</span><span class="val">{stats.avgCo2PerTripKg} kg</span>
			</div>
			<div class="row">
				<span class="lbl">avg / km</span><span class="val">{stats.avgCo2PerKmG} g</span>
			</div>
		</div>
	{/if}
</div>

<style>
	.wrap {
		position: absolute;
		inset: 0;
	}
	.map {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.hud {
		position: absolute;
		top: 16px;
		left: 16px;
		z-index: 10;
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 16px;
		background: rgba(16, 16, 16, 0.85);
		border: 1px solid #2a2a2a;
		border-radius: 8px;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		color: #ededed;
	}
	.row {
		display: flex;
		justify-content: space-between;
		gap: 18px;
		font-variant-numeric: tabular-nums;
	}
	.lbl {
		font-size: 9px;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: #8a8a8a;
		align-self: center;
	}
	.val {
		font-size: 15px;
		font-weight: 500;
	}
	:global(.maplibregl-ctrl-logo) {
		display: none !important;
	}
	:global(.maplibregl-ctrl-attrib-button) {
		display: none !important;
	}
</style>
