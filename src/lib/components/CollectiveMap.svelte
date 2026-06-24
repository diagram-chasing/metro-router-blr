<script lang="ts">
	// The collective health wall: a 500 m choropleth of "months of life lost" over the
	// dark city basemap, per-neighbourhood ±months numbers on top, and a submit
	// animation where the latest route's grid squares light up in sequence before the
	// field recalculates. Skeleton mirrors FlowMap (deck.gl over maplibre), but the
	// scene is a flat choropleth + labels rather than 3D towers.
	import { onMount } from 'svelte';

	import maplibre from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { createClock, type Clock } from '$lib/viz/clock';
	import { loadDeck, type Deck } from '$lib/viz/deck';
	import { ChoroplethField, type Field, type HoodReading } from '$lib/viz/choroplethField';
	import { buildChoroplethLayer, buildHoodLabels } from '$lib/viz/layers';
	import { darkStyle, WALL_BG, easeInOutCubic } from '$lib/viz/palette';
	import EmptyState from '$lib/components/wall/EmptyState.svelte';

	let { variant = 'wall' }: { variant?: 'home' | 'wall' } = $props();

	// Reactive overlay bits (everything else is imperative for perf).
	let count = $state<number | null>(null);
	let headline = $state(0);

	let mapContainer: HTMLDivElement;
	let map: maplibre.Map | undefined;
	let overlay: InstanceType<Deck['MapboxOverlay']> | undefined;

	// Resting view: the whole emissions-grid bbox centred.
	const REST = { lng: 77.6199, lat: 12.9885, zoom: 11 };

	const num = (p: URLSearchParams, k: string, d: number) => {
		const v = Number(p.get(k));
		return isFinite(v) && v > 0 ? v : d;
	};

	// Submit-animation phase durations (s).
	const DUR: Record<string, number> = {
		dim: 0.6,
		reveal: 1.8,
		hold: 3.4,
		recalc: 2.4,
		zoomBack: 1.4,
		settle: 0.8
	};
	const PHASES = ['dim', 'reveal', 'hold', 'recalc', 'zoomBack', 'settle'] as const;
	const DIM_MIN = 0.3;
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

	onMount(() => {
		let disposed = false;
		let clock: Clock | undefined;
		let pollTimer: ReturnType<typeof setInterval> | undefined;
		let fieldTimer: ReturnType<typeof setInterval> | undefined;
		let demoTimer: ReturnType<typeof setInterval> | undefined;

		const field = new ChoroplethField();
		const seen = new Set<number>();
		let lastId = 0;
		let now = 0;
		let cellDeg = 0.005;
		// Resting camera — set to frame the emissions grid bbox once it's known.
		const restView = { center: [REST.lng, REST.lat] as [number, number], zoom: REST.zoom };

		// State machine.
		let phase: 'idle' | (typeof PHASES)[number] = 'idle';
		let phaseStart = 0;
		let activeRoute: [number, number][] = [];
		let activeIsDemo = false;
		let routeCells: number[] = [];
		let queuedRoute: [number, number][] | null = null;
		let queuedIsDemo = false;

		const routeOfLine = (l: { segments: { coords: [number, number][] }[] }) => {
			const pts: [number, number][] = [];
			for (const s of l.segments) for (const c of s.coords) pts.push(c);
			return pts;
		};

		(async () => {
			const p = new URLSearchParams(window.location.search);
			const bg = p.get('bg') ?? WALL_BG;
			const zoom = num(p, 'zoom', REST.zoom);
			const pollMs = Math.max(1500, num(p, 'poll', 4000));
			const dpr = num(p, 'dpr', Math.min(2, window.devicePixelRatio || 1));
			cellDeg = Math.min(0.02, Math.max(0.0025, num(p, 'cell', 0.005)));
			const years = num(p, 'years', 10);
			const gain = num(p, 'gain', 9); // µg/m³ per year our commute layer adds at the peak
			field.setGain(gain, years);
			const demo = p.get('demo') === '1';

			const deck = await loadDeck();
			if (disposed) return;

			map = new maplibre.Map({
				container: mapContainer,
				style: darkStyle(bg),
				center: [REST.lng, REST.lat],
				zoom,
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

			const fieldUrl = `/api/emissions?grid=raw&decay=1.2&cell=${cellDeg}`;

			// Resting baseline: the CHETNA CO₂ grid baked to our lattice (µg/m³ proxy).
			const loadBaseline = async () => {
				try {
					const res = await fetch('/baseline-grid.json');
					const b = (await res.json()) as { values: number[] };
					field.setBaseline(b.values);
				} catch (err) {
					console.warn('CollectiveMap baseline load failed:', err);
				}
			};

			const pollField = async () => {
				try {
					const res = await fetch(fieldUrl);
					const raw = (await res.json()) as Field;
					field.setSnapshot(raw, now);
				} catch (err) {
					console.warn('CollectiveMap field poll failed:', err);
				}
			};

			const pollLines = async () => {
				try {
					const res = await fetch(`/api/lines?sinceId=${lastId}`);
					const { lines } = (await res.json()) as {
						lines: { id: number; segments: { coords: [number, number][] }[] }[];
					};
					for (const l of lines) {
						if (seen.has(l.id)) continue;
						seen.add(l.id);
						if (l.id > lastId) lastId = l.id;
						const r = routeOfLine(l);
						if (r.length >= 2) {
							queuedRoute = r; // animate the newest
							queuedIsDemo = false;
						}
					}
				} catch (err) {
					console.warn('CollectiveMap lines poll failed:', err);
				}
			};

			const pollStats = async () => {
				try {
					const res = await fetch('/api/stats');
					const s = (await res.json()) as { count: number };
					count = s.count;
				} catch {
					/* ignore */
				}
			};

			// ── Submit-animation state machine ──
			const enter = (p2: typeof phase, t: number) => {
				phase = p2;
				phaseStart = t;
				if (p2 === 'dim') {
					routeCells = field.rasterizeRoute(activeRoute);
					field.igniteRoute(routeCells, t + DUR.dim, DUR.reveal);
					const b = new maplibre.LngLatBounds();
					for (const c of activeRoute) b.extend(c);
					const cam = map!.cameraForBounds(b, { padding: 140, maxZoom: 13.5 });
					if (cam) map!.easeTo({ ...cam, duration: (DUR.dim + DUR.reveal) * 1000, easing: easeInOutCubic });
				} else if (p2 === 'recalc') {
					// Re-poll so the just-submitted route is folded into the field, then run a
					// visible recalculation sweep from the route's centre — the corridors
					// climb (our commutes compounding over the decade) as the wave passes.
					// Demo routes aren't on the server, so deposit them locally to compound.
					if (activeIsDemo) field.addRouteDeposit(routeCells, t);
					void pollField();
					let cx = 0;
					let cy = 0;
					for (const c of activeRoute) {
						cx += c[0];
						cy += c[1];
					}
					cx /= activeRoute.length || 1;
					cy /= activeRoute.length || 1;
					field.setRecalc(field.cellIndexAt(cx, cy), t, DUR.recalc);
				} else if (p2 === 'zoomBack') {
					field.clearRoute(); // ignite folds away, leaving the compounded corridor
					map!.easeTo({
						center: restView.center,
						zoom: restView.zoom,
						duration: DUR.zoomBack * 1000,
						easing: easeInOutCubic
					});
				} else if (p2 === 'idle') {
					field.clearRoute();
				}
			};

			const step = (t: number) => {
				if (phase === 'idle') {
					field.setDim(1);
					if (queuedRoute) {
						activeRoute = queuedRoute;
						activeIsDemo = queuedIsDemo;
						queuedRoute = null;
						enter('dim', t);
					}
					return;
				}
				const el = t - phaseStart;
				const dim =
					phase === 'dim'
						? lerp(1, DIM_MIN, easeInOutCubic(clamp01(el / DUR.dim)))
						: phase === 'settle'
							? lerp(DIM_MIN, 1, easeInOutCubic(clamp01(el / DUR.settle)))
							: DIM_MIN;
				field.setDim(dim);
				if (el >= DUR[phase]) {
					const ni = PHASES.indexOf(phase as (typeof PHASES)[number]) + 1;
					enter(ni < PHASES.length ? PHASES[ni] : 'idle', t);
				}
			};

			let labelTick = -1;
			let hoods: HoodReading[] = [];
			clock = createClock((t) => {
				now = t;
				step(t);
				field.setFrame(t);

				const tick = Math.round(t * 6); // choropleth colour buffer regen cadence
				const lt = Math.round(t * 8); // label refresh cadence
				if (lt !== labelTick) {
					labelTick = lt;
					hoods = field.hoodMonths();
					headline = Math.round(field.totalMonths());
				}

				const layers = field.ready
					? [buildChoroplethLayer(deck, field, tick), ...buildHoodLabels(deck, hoods, lt)]
					: [];
				overlay?.setProps({ layers });
			});

			// Demo: queue a synthetic route periodically so State B can be seen without
			// live submissions.
			const fireDemo = () => {
				const a: [number, number] = [77.55 + Math.random() * 0.16, 12.9 + Math.random() * 0.16];
				const b: [number, number] = [77.55 + Math.random() * 0.16, 12.9 + Math.random() * 0.16];
				const mid: [number, number] = [(a[0] + b[0]) / 2 + 0.01, (a[1] + b[1]) / 2 - 0.01];
				queuedRoute = [a, mid, b];
				queuedIsDemo = true;
			};

			await Promise.all([loadBaseline(), pollField(), pollLines(), pollStats()]);

			// Frame the grid bbox so the choropleth fits the view, and remember it as the
			// resting camera the submit animation returns to.
			if (field.ready) {
				const [lonMin, latMin, lonMax, latMax] = field.bounds;
				map.fitBounds(
					[
						[lonMin, latMin],
						[lonMax, latMax]
					],
					{ padding: 64, duration: 0 }
				);
				restView.center = map.getCenter().toArray() as [number, number];
				restView.zoom = map.getZoom();
			}

			clock.start();
			pollTimer = setInterval(() => {
				void pollLines();
				void pollStats();
			}, pollMs);
			fieldTimer = setInterval(() => void pollField(), Math.round(pollMs * 1.5));
			if (demo) {
				fireDemo();
				demoTimer = setInterval(fireDemo, 14000);
			}
		})();

		return () => {
			disposed = true;
			clock?.stop();
			if (pollTimer) clearInterval(pollTimer);
			if (fieldTimer) clearInterval(fieldTimer);
			if (demoTimer) clearInterval(demoTimer);
			overlay?.finalize?.();
			map?.remove();
		};
	});
</script>

<div class="wrap" class:wall={variant === 'wall'}>
	<div bind:this={mapContainer} class="map"></div>

	{#if count !== null && count > 0}
		<div class="header">
			<div class="kicker">Bengaluru · collective commute health</div>
			<div class="figure">
				<span class="n">{headline.toLocaleString()}</span>
				<span class="u">est. months of life lost</span>
			</div>
		</div>

		<div class="legend">
			<span class="cap">given back</span>
			<span class="bar"></span>
			<span class="cap">lost</span>
		</div>
	{:else if count !== null}
		<EmptyState />
	{/if}
</div>

<style>
	.wrap {
		position: absolute;
		inset: 0;
		background: #04060c;
	}
	.map {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	.header {
		position: absolute;
		top: 22px;
		left: 24px;
		z-index: 15;
		display: flex;
		flex-direction: column;
		gap: 6px;
		pointer-events: none;
	}
	.kicker {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 10px;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: #7e90a8;
	}
	.figure {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.figure .n {
		font-family: 'IBM Plex Sans', system-ui, sans-serif;
		font-size: clamp(30px, 4vw, 56px);
		font-weight: 700;
		line-height: 1;
		color: #ffe2d6;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.figure .u {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 11px;
		letter-spacing: 0.12em;
		color: #9fb1c8;
	}
	.legend {
		position: absolute;
		bottom: 24px;
		left: 24px;
		z-index: 15;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		background: rgba(6, 10, 16, 0.6);
		border: 1px solid rgba(120, 160, 200, 0.14);
		border-radius: 8px;
		backdrop-filter: blur(8px);
		pointer-events: none;
	}
	.legend .cap {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: 9px;
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #8aa0bd;
	}
	.legend .bar {
		width: 150px;
		height: 9px;
		border-radius: 5px;
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
	:global(.maplibregl-ctrl-logo),
	:global(.maplibregl-ctrl-attrib-button) {
		display: none !important;
	}
</style>
