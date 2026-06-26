<script lang="ts">
	import { onMount } from 'svelte';

	import maplibre from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { createClock, type Clock } from '$lib/viz/clock';
	import { loadDeck, type Deck } from '$lib/viz/deck';
	import { ChoroplethField, type Field, type HoodReading } from '$lib/viz/choroplethField';
	import { buildChoroplethLayer, buildHoodLabels } from '$lib/viz/layers';
	import { darkStyle, WALL_BG, easeInOutCubic } from '$lib/viz/palette';
	import { Params } from '$lib/viz/health';
	import EmptyState from '$lib/components/wall/EmptyState.svelte';

	let { variant = 'wall' }: { variant?: 'home' | 'wall' } = $props();

	// Reactive overlay bits (everything else is imperative for perf).
	let count = $state<number | null>(null);
	let headline = $state(0);
	let queued = $state(0); // routes waiting their spotlight — surfaced as "+N others joined"
	let activeTag = $state<string | undefined>(undefined); // O→D label of the route on screen
	let scaleW = $state(1); // wall type scale (from ?scale=, derived on-site from viewing distance)

	let mapContainer: HTMLDivElement;
	let map: maplibre.Map | undefined;
	let overlay: InstanceType<Deck['MapboxOverlay']> | undefined;

	// Resting view: the whole emissions-grid bbox centred.
	const REST = { lng: 77.6199, lat: 12.9885, zoom: 11 };

	const num = (p: URLSearchParams, k: string, d: number) => {
		const v = Number(p.get(k));
		return isFinite(v) && v > 0 ? v : d;
	};

	// Submit-animation phase durations (s). Paced long for a distant reader: the hold lets
	// the lit corridor be read, and IDLE_REST lets the headline settle between routes.
	const DUR: Record<string, number> = {
		dim: 0.6,
		reveal: 1.8,
		hold: 4.6,
		recalc: 2.4,
		zoomBack: 1.4,
		settle: 1.1
	};
	const PHASES = ['dim', 'reveal', 'hold', 'recalc', 'zoomBack', 'settle'] as const;
	const DIM_MIN = 0.3;
	const IDLE_REST = 1.4; // s the resting field + headline hold before the next route fires
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

	onMount(() => {
		let disposed = false;
		let clock: Clock | undefined;
		let pollTimer: ReturnType<typeof setInterval> | undefined;
		let fieldTimer: ReturnType<typeof setInterval> | undefined;
		let demoTimer: ReturnType<typeof setInterval> | undefined;

		const field = new ChoroplethField();
		let lastId = 0; // forward-only cursor; dedup is `id > lastId`, so no unbounded Set
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
		// FIFO of routes awaiting their spotlight — every submission gets its moment; under
		// backlog we compress the long phases (below) rather than dropping anyone.
		type Pending = { route: [number, number][]; isDemo: boolean; label?: string };
		const queue: Pending[] = [];

		// Compress only the long, non-reveal phases when routes are waiting, so nobody waits
		// too long for their spotlight; never faster than 0.45× so it stays legible at distance.
		const phaseDur = (ph: string) => {
			if (ph === 'hold' || ph === 'recalc') {
				return DUR[ph] * Math.max(0.45, 1 - 0.12 * queue.length);
			}
			return DUR[ph];
		};

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
			const years = num(p, 'years', Params.years);
			// µg/m³ per year the commute layer ADDS at the peak corridor, on top of the real
			// ACAG ambient baseline. Defaults to the calibrated Params value; ?gain= overrides.
			const gain = num(p, 'gain', Params.our_gain_per_year);
			field.setGain(gain, years);
			scaleW = num(p, 'scale', 1); // wall type scale; set on-site from the viewing distance
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

			// Resting baseline: ACAG annual-mean PM2.5 (µg/m³) baked to our lattice — the
			// air the city already breathes; the commute layer adds onto it.
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
						lines: {
							id: number;
							originLabel?: string;
							destinationLabel?: string;
							segments: { coords: [number, number][] }[];
						}[];
					};
					for (const l of lines) {
						if (l.id <= lastId) continue; // forward-only; server already filters by sinceId
						lastId = Math.max(lastId, l.id);
						const r = routeOfLine(l);
						if (r.length < 2) continue;
						const label =
							l.originLabel && l.destinationLabel
								? `${l.originLabel} → ${l.destinationLabel}`
								: undefined;
						queue.push({ route: r, isDemo: false, label }); // every route, not just the newest
					}
					queued = queue.length;
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
					if (cam)
						map!.easeTo({
							...cam,
							duration: (DUR.dim + DUR.reveal) * 1000,
							easing: easeInOutCubic
						});
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
					if (activeTag) activeTag = undefined; // clear the on-screen tag between routes
					// Let the resting field + headline settle before the next route, unless a
					// backlog is building — then dequeue promptly so nobody waits too long.
					const rest = queue.length > 2 ? 0.3 : IDLE_REST;
					if (t - phaseStart < rest) return;
					const next = queue.shift();
					if (next) {
						queued = queue.length;
						activeRoute = next.route;
						activeIsDemo = next.isDemo;
						activeTag = next.label;
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
				if (el >= phaseDur(phase)) {
					const ni = PHASES.indexOf(phase as (typeof PHASES)[number]) + 1;
					enter(ni < PHASES.length ? PHASES[ni] : 'idle', t);
				}
			};

			let labelTick = -1;
			let hoods: HoodReading[] = [];
			// Watchdog only on the unattended wall: if the rAF loop stalls (GPU context loss,
			// throttle), reload to last-good rather than freezing a dead frame on the wall.
			const watchdog =
				variant === 'wall' ? { onStall: () => location.reload(), stallMs: 6000 } : {};
			clock = createClock((t) => {
				now = t;
				step(t);
				field.setFrame(t);

				const tick = Math.round(t * 6); // choropleth colour buffer regen cadence
				const lt = Math.round(t * 8); // label refresh cadence
				if (lt !== labelTick) {
					labelTick = lt;
					hoods = field.hoodMonths();
					// Methods note: the map bed is TOTAL air = real ACAG ambient PM2.5 (the city's
					// existing burden, traffic included) + the commute increment. The headline,
					// though, reports only the MARGINAL months the submitted commutes add on top of
					// that ambient bed — a what-if attributable to these journeys, not the city's
					// full burden (which is dominated by ambient air the commutes didn't cause).
					headline = Math.round(field.marginalMonths());
				}

				const layers = field.ready
					? [buildChoroplethLayer(deck, field, tick), ...buildHoodLabels(deck, hoods, lt, scaleW)]
					: [];
				overlay?.setProps({ layers });
			}, watchdog);

			// Demo: queue a synthetic route periodically so State B can be seen without
			// live submissions.
			const fireDemo = () => {
				const a: [number, number] = [77.55 + Math.random() * 0.16, 12.9 + Math.random() * 0.16];
				const b: [number, number] = [77.55 + Math.random() * 0.16, 12.9 + Math.random() * 0.16];
				const mid: [number, number] = [(a[0] + b[0]) / 2 + 0.01, (a[1] + b[1]) / 2 - 0.01];
				queue.push({ route: [a, mid, b], isDemo: true });
				queued = queue.length;
			};

			// Boot resilience: a wall powers on before its local server is necessarily ready.
			// Retry the critical loads with backoff until the field is live, instead of sticking
			// on EmptyState forever. The basemap is already visible during this, so never blank.
			for (let i = 0; !field.ready && !disposed; i++) {
				await Promise.all([loadBaseline(), pollField(), pollStats()]);
				if (!field.ready && !disposed) {
					await new Promise((r) => setTimeout(r, Math.min(5000, 500 * (i + 1))));
				}
			}
			await pollLines();

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

<div class="wrap" class:wall={variant === 'wall'} style="--wall-scale:{scaleW}">
	<div bind:this={mapContainer} class="map"></div>

	{#if count !== null && count > 0}
		<!-- Safe-area inset keeps everything critical off a keystoned/vignetted projector edge -->
		<div class="safe">
			<div class="header">
				<!-- <div class="figure">
					<span class="n">{headline.toLocaleString()}</span>
				</div> -->
				<!-- {#if activeTag}
					<div class="callout">
						<span class="lead">your route</span>
						{activeTag}{#if queued > 0}{/if}
					</div>
				{/if} -->
			</div>

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
	{:else if count !== null}
		<EmptyState />
	{/if}
</div>

<style>
	.wrap {
		position: absolute;
		inset: 0;
		background: #04060c;
		--wall-scale: 1;
	}
	/* Hide the OS cursor on the unattended wall. */
	.wrap.wall {
		cursor: none;
	}
	.map {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	/* Generous safe inset — critical content stays clear of projector edges. */
	.safe {
		position: absolute;
		inset: 0;
		z-index: 15;
		padding: clamp(20px, 4.5%, 84px);
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		pointer-events: none;
	}
	.header {
		display: flex;
		flex-direction: column;
		gap: calc(var(--wall-scale) * 7px);
	}
	.kicker {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: calc(var(--wall-scale) * 13px);
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: #8ea0b8;
	}
	.figure {
		display: flex;
		align-items: baseline;
		gap: calc(var(--wall-scale) * 12px);
		flex-wrap: wrap;
	}
	.figure .n {
		font-family: 'IBM Plex Sans', system-ui, sans-serif;
		font-size: calc(var(--wall-scale) * clamp(44px, 6vw, 92px));
		font-weight: 700;
		line-height: 1;
		color: #ffe2d6;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.figure .u {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: calc(var(--wall-scale) * 15px);
		letter-spacing: 0.1em;
		color: #b3c2d6;
	}
	.callout {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: calc(var(--wall-scale) * 15px);
		letter-spacing: 0.06em;
		color: #dfe9f6;
		margin-top: calc(var(--wall-scale) * 4px);
	}
	.callout .lead {
		color: #ffd9a8;
		text-transform: uppercase;
		letter-spacing: 0.16em;
		margin-right: 0.6em;
	}
	.callout .more {
		color: #8ea0b8;
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
		/* WHO-healthy (cool, left) → city's cleanest air (neutral, mid) → more lost (red). */
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
	.caveat {
		max-width: calc(var(--wall-scale) * 360px);
		text-align: right;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: calc(var(--wall-scale) * 12px);
		line-height: 1.5;
		letter-spacing: 0.04em;
		color: #76889f;
	}
	:global(.maplibregl-ctrl-logo),
	:global(.maplibregl-ctrl-attrib-button) {
		display: none !important;
	}
</style>
