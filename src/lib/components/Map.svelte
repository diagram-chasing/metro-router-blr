<script lang="ts">
	import { createEventDispatcher, onMount } from 'svelte';

	import maplibre from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';
	import polyline from '@mapbox/polyline';

	import { renderAllStationsAndLines } from '$lib/utils/mapHelpers';

	export let originPick: [number, number] | null = null;
	export let destinationPick: [number, number] | null = null;
	export let walkingRouteToStation: string | undefined = undefined;
	export let walkingRouteFromStation: string | undefined = undefined;
	export let metroSegments: GeoJSON.FeatureCollection | null = null;

	const dispatch = createEventDispatcher<{ pick: { lng: number; lat: number } }>();

	let mapContainer: HTMLDivElement;
	let map: maplibre.Map | undefined;
	let styleReady = false;

	// Bumped to cancel any in-flight animation when a new one starts or on reset.
	let animationToken = 0;

	const BENGALURU_CENTER = { lng: 77.5946, lat: 12.9716, zoom: 11 };

	const BLANK_STYLE = {
		version: 8 as const,
		sources: {},
		layers: [
			{
				id: 'background',
				type: 'background' as const,
				paint: { 'background-color': '#FFFFFF' }
			}
		]
	};

	const WALK_COLOR = '#666666';
	const METRO_COLOR = '#000000';
	const WALK_WIDTH = 3;
	const METRO_WIDTH = 3.5;
	const WALK_DURATION_MS = 500;
	const METRO_DURATION_MS = 1200;

	// @mapbox/polyline.decode returns [lat, lng] in degrees (precision 5 default).
	// MapLibre wants [lng, lat]. The previous `/ 10` was a leftover and was plotting
	// the walks at ~(1.3°, 7.7°) — off the coast of Africa, invisible on the BLR map.
	const decodeWalk = (encoded: string): [number, number][] =>
		polyline
			.decode(encoded)
			.map((point: [number, number]) => [point[1], point[0]] as [number, number]);

	const flattenMetroCoords = (fc: GeoJSON.FeatureCollection | null): [number, number][] => {
		if (!fc) return [];
		return fc.features.flatMap((f) =>
			f.geometry.type === 'LineString' ? (f.geometry.coordinates as [number, number][]) : []
		);
	};

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

		if (map.getSource('pick-markers-source')) {
			(map.getSource('pick-markers-source') as maplibre.GeoJSONSource).setData(data);
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
		['route-to-station-layer', 'route-from-station-layer', 'metro-highlight'].forEach((id) => {
			if (map?.getLayer(id)) map.removeLayer(id);
		});
		['route-to-station', 'route-from-station', 'metro-highlight-source'].forEach((id) => {
			if (map?.getSource(id)) map.removeSource(id);
		});
	};

	const animateJourney = async () => {
		if (!map || !styleReady) return;
		animationToken++;
		const token = animationToken;

		const walk1 = walkingRouteToStation ? decodeWalk(walkingRouteToStation) : [];
		const walk2 = walkingRouteFromStation ? decodeWalk(walkingRouteFromStation) : [];
		const metro = flattenMetroCoords(metroSegments);

		// Create layers up-front in z-order: walk1 (bottom), metro, walk2 (top), then pick markers above all.
		ensureLineLayer('route-to-station-layer', 'route-to-station', WALK_COLOR, WALK_WIDTH);
		ensureLineLayer('metro-highlight', 'metro-highlight-source', METRO_COLOR, METRO_WIDTH);
		ensureLineLayer('route-from-station-layer', 'route-from-station', WALK_COLOR, WALK_WIDTH);
		setLineCoords('route-to-station', []);
		setLineCoords('metro-highlight-source', []);
		setLineCoords('route-from-station', []);
		ensurePickMarkersOnTop();

		await animateCoords(walk1, 'route-to-station', WALK_DURATION_MS, token);
		if (token !== animationToken) return;
		await animateCoords(metro, 'metro-highlight-source', METRO_DURATION_MS, token);
		if (token !== animationToken) return;
		await animateCoords(walk2, 'route-from-station', WALK_DURATION_MS, token);
	};

	onMount(() => {
		map = new maplibre.Map({
			container: mapContainer,
			style: BLANK_STYLE,
			center: [BENGALURU_CENTER.lng, BENGALURU_CENTER.lat],
			zoom: BENGALURU_CENTER.zoom,
			dragPan: false,
			dragRotate: false,
			scrollZoom: false,
			doubleClickZoom: false,
			touchZoomRotate: false,
			touchPitch: false,
			keyboard: false,
			boxZoom: false
		});

		map.on('click', (e) => {
			dispatch('pick', { lng: e.lngLat.lng, lat: e.lngLat.lat });
		});

		map.on('load', () => {
			styleReady = true;
			if (!map) return;
			renderAllStationsAndLines(map);
			updatePickMarkers();
			if (walkingRouteToStation && walkingRouteFromStation && metroSegments) {
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

	$: if (styleReady && walkingRouteToStation && walkingRouteFromStation && metroSegments) {
		animateJourney();
	}

	$: if (styleReady && !originPick && !destinationPick) {
		animationToken++;
		clearJourneyLayers();
	}
</script>

<div class="relative h-full w-full">
	<div bind:this={mapContainer} class="absolute inset-0 h-full w-full" />
</div>

<style>
	:global(.maplibregl-canvas) {
		width: 100%;
		height: 100%;
		cursor: crosshair;
	}

	:global(.maplibregl-ctrl-attrib),
	:global(.maplibregl-ctrl-logo) {
		display: none !important;
	}
</style>
