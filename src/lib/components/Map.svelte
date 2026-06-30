<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';

	import maplibre from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { renderAllStationsAndLines } from '$lib/utils/mapHelpers';
	import type { RouteSegment } from '$lib/exhibit/routeCandidates';
	import { TILES_URL, GLYPHS_URL } from '$lib/viz/basemapSource';

	export let originPick: [number, number] | null = null;
	export let destinationPick: [number, number] | null = null;
	// Ordered, per-leg drawable stretches of the selected route (already in
	// [lng, lat]). Animated one after another in sequence.
	export let segments: RouteSegment[] | null = null;

	const dispatch = createEventDispatcher<{ pick: { lng: number; lat: number } }>();

	let mapContainer: HTMLDivElement;
	let map: maplibre.Map | undefined;
	let styleReady = false;

	// Bumped to cancel any in-flight animation when a new one starts or on reset.
	let animationToken = 0;

	const BENGALURU_CENTER = { lng: 77.5946, lat: 12.9716, zoom: 12.4 };

	// Toner-inspired b&w base layer over OpenFreeMap vector tiles (OpenMapTiles schema).
	// Black water, hairline-to-thin black roads, white parks. No labels — the metro
	// overlay is the focus; geographic context is for orientation only.
	const TONER_STYLE: maplibre.StyleSpecification = {
		version: 8,
		name: 'Toner',
		sources: {
			openmaptiles: {
				type: 'vector',
				url: TILES_URL
			}
		},
		glyphs: GLYPHS_URL,
		layers: [
			{
				id: 'background',
				type: 'background',
				paint: { 'background-color': '#ffffff' }
			},
			{
				id: 'park',
				type: 'fill',
				source: 'openmaptiles',
				'source-layer': 'park',
				paint: { 'fill-color': '#f3f3f3', 'fill-opacity': 0.05 }
			},
			{
				id: 'water',
				type: 'fill',
				source: 'openmaptiles',
				'source-layer': 'water',
				paint: { 'fill-color': '#000000', 'fill-opacity': 0.05 }
			},
			{
				id: 'road-minor',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'transportation',
				minzoom: 12,
				filter: ['in', 'class', 'minor', 'service', 'track'],
				paint: {
					'line-color': '#000000',
					'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.25, 16, 0.7],
					'line-opacity': 0.05
				}
			},
			{
				id: 'road-secondary',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'transportation',
				filter: ['in', 'class', 'secondary', 'tertiary'],
				paint: {
					'line-color': '#000000',
					'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.4, 16, 1.6],
					'line-opacity': 0.05
				}
			},
			{
				id: 'road-primary',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'transportation',
				filter: ['in', 'class', 'primary', 'trunk', 'motorway'],
				paint: {
					'line-color': '#000000',
					'line-width': ['interpolate', ['linear'], ['zoom'], 6, 0.5, 16, 2.5],
					'line-opacity': 0.05
				}
			},
			{
				id: 'admin-boundary',
				type: 'line',
				source: 'openmaptiles',
				'source-layer': 'boundary',
				filter: ['<=', 'admin_level', 4],
				paint: {
					'line-color': '#000000',
					'line-dasharray': [3, 2],
					'line-width': 0.7,
					'line-opacity': 0.05
				}
			},
			// Place labels from the local 'place' tiles (same source-layer the homepage map
			// uses). Font must match a self-hosted stack in static/fonts exactly — IBM Plex
			// Mono Medium — or labels render blank against PUBLIC_GLYPHS_URL=/fonts. Coloured
			// dark-on-white for the toner base. Neighbourhood tier intentionally has no
			// minzoom so the names show at the default zoom.
			{
				id: 'place-minor',
				type: 'symbol',
				source: 'openmaptiles',
				'source-layer': 'place',
				filter: ['in', 'class', 'suburb', 'neighbourhood', 'quarter', 'village'],
				layout: {
					'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
					'text-font': ['IBM Plex Mono Medium'],
					'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 14, 14],
					'text-transform': 'uppercase',
					'text-letter-spacing': 0.06,
					'text-max-width': 7
				},
				paint: {
					'text-color': '#3a3a32',
					'text-halo-color': '#ffffff',
					'text-halo-width': 1.6,
					'text-halo-blur': 0.4
				}
			},
			{
				id: 'place-major',
				type: 'symbol',
				source: 'openmaptiles',
				'source-layer': 'place',
				filter: ['in', 'class', 'city', 'town'],
				layout: {
					'text-field': ['coalesce', ['get', 'name:latin'], ['get', 'name']],
					'text-font': ['IBM Plex Mono Medium'],
					'text-size': ['interpolate', ['linear'], ['zoom'], 9, 13, 14, 19],
					'text-transform': 'uppercase',
					'text-letter-spacing': 0.06,
					'text-max-width': 7
				},
				paint: {
					'text-color': '#111111',
					'text-halo-color': '#ffffff',
					'text-halo-width': 1.8,
					'text-halo-blur': 0.4
				}
			}
		]
	};

	// Per-leg-kind rendering. Walk legs are thinner/greyer and animate quickly;
	// transit and road legs are bolder and reveal more slowly.
	const widthForKind = (kind: RouteSegment['kind']): number => (kind === 'walk' ? 3 : 3.5);
	const durationForKind = (kind: RouteSegment['kind']): number => {
		if (kind === 'walk') return 500;
		if (kind === 'cab' || kind === 'auto') return 1000;
		return 1200; // metro / bus
	};

	// Layer/source ids created for the current journey, so we can tear them down
	// before drawing the next one (segment count varies per route).
	let journeyLayerIds: string[] = [];

	const ensureLineLayer = (
		layerId: string,
		sourceId: string,
		color: string,
		width: number
	) => {
		if (!map) return;
		if (!map.getSource(sourceId)) {
			map.addSource(sourceId, {
				type: 'geojson',
				data: {
					type: 'Feature',
					properties: {},
					geometry: { type: 'LineString', coordinates: [] }
				}
			});
		}
		if (!map.getLayer(layerId)) {
			map.addLayer({
				id: layerId,
				type: 'line',
				source: sourceId,
				layout: { 'line-join': 'round', 'line-cap': 'round' },
				paint: { 'line-color': color, 'line-width': width }
			});
		}
	};

	const setLineCoords = (sourceId: string, coords: [number, number][]) => {
		if (!map) return;
		const src = map.getSource(sourceId) as maplibre.GeoJSONSource | undefined;
		if (!src) return;
		src.setData({
			type: 'Feature',
			properties: {},
			geometry: { type: 'LineString', coordinates: coords }
		});
	};

	const easeInOutQuad = (t: number) =>
		t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

	const animateCoords = (
		coords: [number, number][],
		sourceId: string,
		durationMs: number,
		token: number
	): Promise<void> =>
		new Promise((resolve) => {
			if (coords.length < 2) {
				setLineCoords(sourceId, coords);
				resolve();
				return;
			}
			const start = performance.now();
			const step = (now: number) => {
				if (token !== animationToken) return resolve();
				const t = Math.min(1, (now - start) / durationMs);
				const eased = easeInOutQuad(t);
				const endIdx = Math.max(2, Math.floor(eased * coords.length));
				setLineCoords(sourceId, coords.slice(0, endIdx));
				if (t < 1) requestAnimationFrame(step);
				else {
					setLineCoords(sourceId, coords);
					resolve();
				}
			};
			requestAnimationFrame(step);
		});

	const updatePickMarkers = () => {
		if (!map || !styleReady) return;

		const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
		if (originPick) {
			features.push({
				type: 'Feature',
				properties: {},
				geometry: { type: 'Point', coordinates: originPick }
			});
		}
		if (destinationPick) {
			features.push({
				type: 'Feature',
				properties: {},
				geometry: { type: 'Point', coordinates: destinationPick }
			});
		}

		const data: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features };

		const existing = map.getSource('pick-markers-source') as maplibre.GeoJSONSource | undefined;
		if (existing) {
			existing.setData(data);
		} else {
			map.addSource('pick-markers-source', { type: 'geojson', data });
			map.addLayer({
				id: 'pick-markers',
				type: 'circle',
				source: 'pick-markers-source',
				paint: {
					'circle-radius': 6,
					'circle-color': '#000000'
				}
			});
		}

		ensurePickMarkersOnTop();
	};

	const ensurePickMarkersOnTop = () => {
		if (!map) return;
		if (map.getLayer('pick-markers')) map.moveLayer('pick-markers');
	};

	const clearJourneyLayers = () => {
		if (!map) return;
		for (const id of journeyLayerIds) {
			const layerId = `${id}-layer`;
			if (map.getLayer(layerId)) map.removeLayer(layerId);
			if (map.getSource(id)) map.removeSource(id);
		}
		journeyLayerIds = [];
	};

	const animateJourney = async () => {
		if (!map || !styleReady) return;
		animationToken++;
		const token = animationToken;

		clearJourneyLayers();
		const legs = (segments ?? []).filter((s) => s.coords.length >= 2);
		if (legs.length === 0) return;

		// Create every layer up-front so z-order is stable, then reveal in sequence.
		legs.forEach((seg, i) => {
			const sourceId = `journey-seg-${i}`;
			ensureLineLayer(`${sourceId}-layer`, sourceId, seg.color, widthForKind(seg.kind));
			setLineCoords(sourceId, []);
			journeyLayerIds.push(sourceId);
		});
		ensurePickMarkersOnTop();

		for (let i = 0; i < legs.length; i++) {
			if (token !== animationToken) return;
			await animateCoords(legs[i].coords, `journey-seg-${i}`, durationForKind(legs[i].kind), token);
		}
	};

	onMount(() => {
		map = new maplibre.Map({
			container: mapContainer,
			style: TONER_STYLE,
			center: [BENGALURU_CENTER.lng, BENGALURU_CENTER.lat],
			zoom: BENGALURU_CENTER.zoom,
			dragPan: true,
			dragRotate: false,
			scrollZoom: true,
			doubleClickZoom: true,
			touchZoomRotate: true,
			touchPitch: false,
			keyboard: false,
			boxZoom: false
		});

		// Pinch-zoom yes, twist-to-rotate no — keep the map north-up.
		map.touchZoomRotate.disableRotation();

		map.addControl(
			new maplibre.NavigationControl({ showCompass: false, showZoom: true, visualizePitch: false }),
			'bottom-left'
		);

		map.on('click', (e) => {
			dispatch('pick', { lng: e.lngLat.lng, lat: e.lngLat.lat });
		});

		map.on('load', () => {
			styleReady = true;
			if (!map) return;
			renderAllStationsAndLines(map);
			updatePickMarkers();
			if (segments && segments.length) {
				animateJourney();
			}
		});

		return () => {
			animationToken++;
			map?.remove();
		};
	});

	$: if (styleReady) {
		void originPick;
		void destinationPick;
		updatePickMarkers();
	}

	// Redraw whenever the selected route's geometry changes.
	$: if (styleReady && segments) {
		animateJourney();
	}

	$: if (styleReady && (!originPick || !destinationPick || !segments)) {
		animationToken++;
		clearJourneyLayers();
	}
</script>

<!-- Wrapper is `absolute inset-0`, so its height comes from the insets (a definite
     622px against the positioned `.map-area` parent) rather than percentage resolution
     against a flex-stretched ancestor — that chain collapses `h-full` to 0. maplibre
     forces `position: relative` onto its own container, defeating `absolute` there, so
     the inner container fills the now-definite wrapper with `h-full w-full`. -->
<div class="absolute inset-0">
	<div bind:this={mapContainer} class="h-full w-full"></div>
</div>

<style>
	:global(.maplibregl-canvas) {
		width: 100%;
		height: 100%;
		cursor: crosshair;
	}

	:global(.maplibregl-ctrl-logo) {
		display: none !important;
	}

	/* Attribution is required by OpenFreeMap / OpenMapTiles / OSM.
	   Style it down to a minimal mark so it doesn't fight the dashboard, but keep it visible. */
	:global(.maplibregl-ctrl-attrib) {
		background: rgba(255, 255, 255, 0.85);
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 10px;
		padding: 2px 6px;
	}
	:global(.maplibregl-ctrl-attrib a) {
		color: #1c1c1c;
	}
	:global(.maplibregl-ctrl-attrib-button) {
		display: none !important;
	}
</style>
