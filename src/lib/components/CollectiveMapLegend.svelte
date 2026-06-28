<script lang="ts">
	import { onMount } from 'svelte';

	import maplibre from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { loadDeck, type Deck } from '$lib/viz/deck';
	import { ChoroplethField } from '$lib/viz/choroplethField';
	import { buildFieldLayer, buildHoodLabels } from '$lib/viz/layers';
	import { darkStyle, WALL_BG } from '$lib/viz/palette';
	import {
		REST,
		numParam as num,
		flagParam as flag,
		emissionsFieldUrl,
		flattenSegments,
		loadBaseline as loadFieldBaseline,
		pollField as pollFieldSnapshot
	} from '$lib/viz/wallField';

	// Static screenshot version of CollectiveMap: paints the resting field, ignites a
	// single route held at full glow, and scatters a few neighbourhood labels — no clock,
	// polling, state machine, or OSM basemap. Toggle states for separate frames via URL:
	//   ?route=0    baseline only        ?labels=N  cap the scattered figures (default 5; 0 hides)
	//   ?dim=1      don't dim the field behind the lit route (default dims to 0.45)
	//   ?basemap=1  bring back the OSM road/place context

	let scaleW = $state(1);

	let mapContainer: HTMLDivElement;
	let map: maplibre.Map | undefined;
	let overlay: InstanceType<Deck['MapboxOverlay']> | undefined;

	const SETTLED = 100; // a `now` well past growth + ignite-rise, so the field reads fully settled

	// A wandering commute through the centre, Catmull-Rom smoothed so the corridor curves
	// like a real path rather than reading as a ruled diagonal. Control points are fractions
	// of the grid bbox, so it frames well at any extent.
	function syntheticRoute(
		lonMin: number,
		latMin: number,
		lonMax: number,
		latMax: number
	): [number, number][] {
		const at = (fx: number, fy: number): [number, number] => [
			lonMin + (lonMax - lonMin) * fx,
			latMin + (latMax - latMin) * fy
		];
		const ctrl: [number, number][] = [
			at(0.2, 0.24),
			at(0.31, 0.4),
			at(0.46, 0.43),
			at(0.55, 0.57),
			at(0.67, 0.61),
			at(0.81, 0.76)
		];
		const out: [number, number][] = [];
		const P = (i: number) => ctrl[Math.max(0, Math.min(ctrl.length - 1, i))];
		const SEG = 18;
		for (let i = 0; i < ctrl.length - 1; i++) {
			const [x0, y0] = P(i - 1);
			const [x1, y1] = P(i);
			const [x2, y2] = P(i + 1);
			const [x3, y3] = P(i + 2);
			for (let s = 0; s < SEG; s++) {
				const t = s / SEG;
				const t2 = t * t;
				const t3 = t2 * t;
				out.push([
					0.5 * (2 * x1 + (-x0 + x2) * t + (2 * x0 - 5 * x1 + 4 * x2 - x3) * t2 + (-x0 + 3 * x1 - 3 * x2 + x3) * t3),
					0.5 * (2 * y1 + (-y0 + y2) * t + (2 * y0 - 5 * y1 + 4 * y2 - y3) * t2 + (-y0 + 3 * y1 - 3 * y2 + y3) * t3)
				]);
			}
		}
		out.push(ctrl[ctrl.length - 1]);
		return out;
	}

	onMount(() => {
		let disposed = false;
		const field = new ChoroplethField();
		let cellDeg = 0.005;

		(async () => {
			const p = new URLSearchParams(window.location.search);
			const bg = p.get('bg') ?? WALL_BG;
			const dpr = num(p, 'dpr', Math.min(2, window.devicePixelRatio || 1));
			cellDeg = Math.min(0.02, Math.max(0.0015, num(p, 'cell', 0.003)));
			// gain/years/saturation are baked into the field from $lib/config/wall.ts
			scaleW = num(p, 'scale', 1);

			const showRoute = flag(p, 'route', true);
			const labelsParam = p.get('labels');
			const labelCount = labelsParam === null ? 5 : Math.max(0, Math.floor(Number(labelsParam)) || 0);
			const useBasemap = flag(p, 'basemap', false);
			// Dim the resting field behind the lit route so the corridor reads as highlighted;
			// baseline-only frames stay at full brightness.
			const dim = showRoute ? num(p, 'dim', 0.45) : 1;

			// Bare canvas by default — no roads/water/place labels, just our field + figures.
			const style: maplibre.StyleSpecification = useBasemap
				? darkStyle(bg)
				: {
						version: 8,
						sources: {},
						layers: [{ id: 'bg', type: 'background', paint: { 'background-color': bg } }]
					};

			const deck = await loadDeck();
			if (disposed) return;

			map = new maplibre.Map({
				container: mapContainer,
				style,
				center: [REST.lng, REST.lat],
				zoom: REST.zoom,
				pitch: 0,
				bearing: 0,
				pixelRatio: dpr,
				interactive: false,
				attributionControl: false
			});

			await new Promise<void>((resolve) => map!.on('load', () => resolve()));
			if (disposed) return;

			overlay = new deck.MapboxOverlay({ interleaved: true, layers: [] });
			map.addControl(overlay as unknown as maplibre.IControl);

			const fieldUrl = emissionsFieldUrl(cellDeg);

			const loadBaseline = () => loadFieldBaseline(field, 'legend baseline');
			const pollField = () => pollFieldSnapshot(field, fieldUrl, 0, 'legend field');

			// Prefer a genuine submitted route (real road geometry reads natural); fall back to
			// null so we draw a smoothed synthetic corridor instead.
			const loadRealRoute = async (): Promise<[number, number][] | null> => {
				try {
					const res = await fetch('/api/lines?limit=5000');
					const { lines } = (await res.json()) as {
						lines: { segments: { coords: [number, number][] }[] }[];
					};
					let best: [number, number][] | null = null;
					for (const l of lines) {
						const pts = flattenSegments(l.segments);
						if (pts.length >= 2 && (!best || pts.length > best.length)) best = pts;
					}
					return best;
				} catch {
					return null;
				}
			};

			for (let i = 0; !field.ready && !disposed; i++) {
				await Promise.all([loadBaseline(), pollField()]);
				if (!field.ready && !disposed) {
					await new Promise((r) => setTimeout(r, Math.min(5000, 500 * (i + 1))));
				}
			}
			if (disposed || !field.ready) return;

			// Frame the whole grid bbox full-screen so the labels scatter across the view.
			const [lonMin, latMin, lonMax, latMax] = field.bounds;
			map.fitBounds(
				[
					[lonMin, latMin],
					[lonMax, latMax]
				],
				{ padding: 64, duration: 0 }
			);

			// One settled frame: full growth, then light a single corridor and hold it at the
			// ignite plateau (igniteRoute at t=0 with SETTLED ≫ rise → glow stays full).
			field.setDim(dim);
			field.setFrame(SETTLED);
			if (showRoute) {
				const real = await loadRealRoute();
				if (disposed) return;
				const route = real ?? syntheticRoute(lonMin, latMin, lonMax, latMax);
				const cells = field.rasterizeRoute(route);
				field.igniteRoute(cells, 0, 0);
			}
			field.fillTexture(); // bake the settled state (growth + ignite) into the texture

			// No OSM basemap here, so anchors come from the field itself (lattice sample + farthest-
			// point spread), capped to the requested count.
			const hoods = labelCount > 0 ? field.autoHoods(labelCount) : [];
			const fieldLayer = buildFieldLayer(deck, field, { time: SETTLED });
			overlay.setProps({
				layers: [
					...(fieldLayer ? [fieldLayer] : []),
					...buildHoodLabels(deck, hoods, SETTLED, scaleW)
				]
			});
			map.triggerRepaint();
		})();

		return () => {
			disposed = true;
			overlay?.finalize?.();
			map?.remove();
		};
	});
</script>

<div class="wrap" style="--wall-scale:{scaleW}">
	<div bind:this={mapContainer} class="map"></div>

	<div class="safe">
		<div class="footer">
			<div class="legend">
				<span class="bar"></span>
				<div class="caps">
					<span class="cap cool">WHO healthy</span>
					<span class="cap">city's cleanest air</span>
					<span class="cap hot">more months lost ▸</span>
				</div>
			</div>
		</div>
	</div>
</div>

<style>
	.wrap {
		position: absolute;
		inset: 0;
		background: #04060c;
		--wall-scale: 1;
	}
	.map {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.safe {
		position: absolute;
		inset: 0;
		z-index: 15;
		padding: clamp(20px, 4.5%, 84px);
		display: flex;
		flex-direction: column;
		justify-content: flex-end;
		pointer-events: none;
	}
	.footer {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: calc(var(--wall-scale) * 16px);
		flex-wrap: wrap;
	}
	.legend {
		display: flex;
		flex-direction: column;
		gap: calc(var(--wall-scale) * 6px);
		padding: calc(var(--wall-scale) * 9px) calc(var(--wall-scale) * 13px);
		background: rgba(6, 10, 16, 0.62);
		border: 1px solid rgba(120, 160, 200, 0.16);
		border-radius: 8px;
		backdrop-filter: blur(8px);
	}
	.legend .bar {
		width: calc(var(--wall-scale) * 240px);
		height: calc(var(--wall-scale) * 12px);
		border-radius: 6px;
		background: linear-gradient(
			90deg,
			rgb(54, 150, 236) 0%,
			rgb(96, 172, 224) 22%,
			rgb(32, 40, 56) 50%,
			rgb(240, 168, 64) 64%,
			rgb(246, 110, 58) 80%,
			rgb(240, 64, 72) 92%,
			rgb(255, 196, 168) 100%
		);
	}
	.legend .caps {
		display: flex;
		justify-content: space-between;
		width: calc(var(--wall-scale) * 240px);
	}
	.legend .cap {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: calc(var(--wall-scale) * 11px);
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #93a6c0;
	}
	.legend .cap.cool {
		color: #7fb0e0;
	}
	.legend .cap.hot {
		color: #f3a06a;
	}
	:global(.maplibregl-ctrl-logo),
	:global(.maplibregl-ctrl-attrib-button) {
		display: none !important;
	}
</style>
