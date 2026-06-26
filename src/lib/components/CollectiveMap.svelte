<script lang="ts">
	import { onMount } from 'svelte';

	import maplibre from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { createClock, type Clock } from '$lib/viz/clock';
	import { loadDeck, type Deck } from '$lib/viz/deck';
	import { ChoroplethField, type Field, type HoodReading } from '$lib/viz/choroplethField';
	import { buildFieldLayer, buildHoodLabels } from '$lib/viz/layers';
	import { darkStyle, WALL_BG, easeInOutCubic, easeOutCubic, divergingAt } from '$lib/viz/palette';
	import { Params } from '$lib/viz/health';
	import EmptyState from '$lib/components/wall/EmptyState.svelte';

	let { variant = 'wall' }: { variant?: 'home' | 'wall' } = $props();

	// Legend swatches: the diverging ramp sampled at discrete steps (cool → neutral → hot), drawn
	// as separate blocks rather than a smooth gradient so the scale reads clearly from a distance.
	const swatches = [0, 0.17, 0.34, 0.5, 0.66, 0.83, 1].map((t) => divergingAt(t));

	// Reactive overlay bits (everything else is imperative for perf).
	let count = $state<number | null>(null);
	let headline = $state(0);
	let queued = $state(0); // routes waiting their spotlight — surfaced as "+N others joined"
	let activeTag = $state<string | undefined>(undefined); // O→D label of the route on screen
	let scaleW = $state(1); // wall type scale (from ?scale=, derived on-site from viewing distance)

	// Recalc readout — a large, minimal card in the top band (route + the µg/m³ this journey
	// added). Fixed position so it stays clear of the lit corridor and reads from across the
	// room; only opacity animates. Driven from the rAF loop.
	let card = $state<{ show: boolean; opacity: number; route?: string; ug: number }>({
		show: false,
		opacity: 0,
		ug: 0
	});

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

	// Anchored recalc card envelope (s): rise, hold, fall. ~2.9s total — outlasts `recalc` and
	// fades through `zoomBack`, tracking the corridor as the camera pulls back.
	const CARD_RISE = 0.5;
	const CARD_HOLD = 1.5;
	const CARD_FALL = 0.9;
	const CARD_TOTAL = CARD_RISE + CARD_HOLD + CARD_FALL;

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
		// The just-submitted route's recalc-card payload; null when no card is live.
		let cardData: { route?: string; ug: number; start: number } | null = null;
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
			cellDeg = Math.min(0.02, Math.max(0.0015, num(p, 'cell', 0.003)));
			const years = num(p, 'years', Params.years);
			// µg/m³ per year the commute layer ADDS at the peak corridor, on top of the real
			// ACAG ambient baseline. Defaults to the calibrated Params value; ?gain= overrides.
			const gain = num(p, 'gain', Params.our_gain_per_year);
			field.setGain(gain, years);
			scaleW = num(p, 'scale', 1); // wall type scale; set on-site from the viewing distance
			// Idle ambient-motion strength (?idle=): 1 = default, 0 = the old static look, >1 bolder.
			// num() rejects 0 (it wants >0), so parse directly to keep 0 meaningful.
			const idleRaw = Number(p.get('idle'));
			const idleAmt = isFinite(idleRaw) && idleRaw >= 0 ? idleRaw : 1;
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
					const b = (await res.json()) as {
						nLat: number;
						nLon: number;
						bbox: [number, number, number, number];
						values: number[];
					};
					field.setBaseline(b);
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
					const cam = map!.cameraForBounds(b, { padding: 140, maxZoom: 12 });
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
					field.setRecalcPath(activeRoute); // pulse radiates along the route shape
					// Hand the card its payload: the emissions this journey added. It narrates the
					// recalc sweep running underneath it.
					cardData = { route: activeTag, ug: field.estimateRouteUg(), start: t };
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
				field.fillTexture(); // rebuilds the field texture only when the data moved

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

				// Continuous `t` (not quantised) → smooth shader animation; the texture itself
				// only re-uploads when fillTexture bumped its identity.
				const fieldLayer = field.ready
					? buildFieldLayer(deck, field, { time: t, idle: idleAmt })
					: null;

				// Recalc card: fade on the rise/hold/fall envelope. Fixed position, so only opacity
				// animates — no jitter at distance.
				if (cardData) {
					const e = t - cardData.start;
					if (e > CARD_TOTAL) {
						cardData = null;
						if (card.show) card = { show: false, opacity: 0, ug: 0 };
					} else {
						const op =
							e < CARD_RISE
								? easeOutCubic(clamp01(e / CARD_RISE))
								: e < CARD_RISE + CARD_HOLD
									? 1
									: 1 - Math.pow(clamp01((e - CARD_RISE - CARD_HOLD) / CARD_FALL), 3);
						card = { show: true, opacity: clamp01(op), route: cardData.route, ug: cardData.ug };
					}
				}

				const layers = fieldLayer ? [fieldLayer, ...buildHoodLabels(deck, hoods, lt, scaleW)] : [];
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

			// Frame the grid bbox to COVER the viewport (fill edge-to-edge, overflowing the
			// looser axis) so no basemap shows around the grid. fitBounds is "contain", so we
			// then zoom in by the cover ratio. Remembered as the resting camera.
			if (field.ready) {
				const [lonMin, latMin, lonMax, latMax] = field.bounds;
				const sw: [number, number] = [lonMin, latMin];
				const ne: [number, number] = [lonMax, latMax];
				map.fitBounds([sw, ne], { padding: 0, duration: 0 });
				const pa = map.project(sw);
				const pb = map.project(ne);
				const pw = Math.abs(pb.x - pa.x);
				const ph = Math.abs(pb.y - pa.y);
				const cover = Math.max(mapContainer.clientWidth / pw, mapContainer.clientHeight / ph);
				if (isFinite(cover) && cover > 0) {
					map.setZoom(map.getZoom() + Math.log2(cover));
				}
				restView.center = map.getCenter().toArray() as [number, number];
				restView.zoom = map.getZoom();
				// Never show beyond the grid: clamp every camera move (incl. edge-route easeTo) to the
				// grid bbox, so framing a corridor near the border can't reveal the bare basemap around it.
				map.setMaxBounds([
					[lonMin, latMin],
					[lonMax, latMax]
				]);
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

	{#if card.show}
		<!-- The recalc readout as a little receipt slip: white paper, monospace, a dashed rule, and
		     the emissions added in a reverse (black-on-white) hero bar — matching src/lib/receipt. -->
		<div class="routecard" style="opacity:{card.opacity}; --wall-scale:{scaleW}">
			<div class="route">{card.route ?? 'New journey'}</div>
			<div class="rule"></div>
			<div class="emis">+{Math.round(card.ug)}<span class="unit"> µg/m³</span></div>
		</div>
	{/if}

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
					<div class="legend-title">Months of life lost</div>
					<div class="swatches">
						{#each swatches as c, i (i)}
							<span class="sw" style="background: rgb({c[0]}, {c[1]}, {c[2]})"></span>
						{/each}
					</div>
					<div class="legend-labels">
						<span>Fewer</span>
						<span>More ▸</span>
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
	/* Recalc readout styled as a receipt slip: white paper, monospace, a dashed rule, and the
	   emissions in a reverse (black-on-white) hero — same language as src/lib/receipt/ReceiptDoc.
	   No glass/blur/glow; crisp 1-bit, font smoothing off, to match the printed aesthetic. */
	.routecard {
		position: absolute;
		top: clamp(24px, 6%, 110px);
		left: 50%;
		transform: translateX(-50%);
		z-index: 16;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: calc(var(--wall-scale) * 11px);
		min-width: calc(var(--wall-scale) * 300px);
		padding: calc(var(--wall-scale) * 16px) calc(var(--wall-scale) * 18px);
		background: #fff;
		color: #000;
		font-family: ui-monospace, 'Liberation Mono', 'Cascadia Mono', 'DejaVu Sans Mono', Menlo,
			'Courier New', monospace;
		-webkit-font-smoothing: none;
		font-smooth: never;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
		transition: opacity 0.15s linear;
		will-change: opacity;
	}
	.routecard .route {
		font-size: calc(var(--wall-scale) * 22px);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		text-align: center;
		line-height: 1.15;
	}
	.routecard .rule {
		border-top: 2px dashed #000;
	}
	/* The reverse hero, after ReceiptDoc's .rev (white-on-black inverted total). */
	.routecard .emis {
		background: #000;
		color: #fff;
		font-size: calc(var(--wall-scale) * clamp(40px, 5vw, 76px));
		font-weight: 700;
		line-height: 1;
		text-align: center;
		letter-spacing: 0.01em;
		padding: calc(var(--wall-scale) * 10px) calc(var(--wall-scale) * 12px);
		font-variant-numeric: tabular-nums;
	}
	.routecard .emis .unit {
		font-size: 0.4em;
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	.footer {
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		gap: calc(var(--wall-scale) * 16px);
		flex-wrap: wrap;
	}
	/* Legend as a receipt slip too: white paper, mono, discrete colour blocks (not a gradient)
	   with crisp black outlines, and clear end labels. Same language as .routecard. */
	.legend {
		display: flex;
		flex-direction: column;
		gap: calc(var(--wall-scale) * 8px);
		padding: calc(var(--wall-scale) * 12px) calc(var(--wall-scale) * 14px);
		background: #fff;
		color: #000;
		font-family: ui-monospace, 'Liberation Mono', 'Cascadia Mono', 'DejaVu Sans Mono', Menlo,
			'Courier New', monospace;
		-webkit-font-smoothing: none;
		font-smooth: never;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.55);
	}
	.legend .legend-title {
		font-size: calc(var(--wall-scale) * 13px);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
	}
	.legend .swatches {
		display: flex;
		gap: calc(var(--wall-scale) * 3px);
	}
	.legend .sw {
		width: calc(var(--wall-scale) * 34px);
		height: calc(var(--wall-scale) * 16px);
		border: 1.5px solid #000;
	}
	.legend .legend-labels {
		display: flex;
		justify-content: space-between;
		font-size: calc(var(--wall-scale) * 12px);
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.05em;
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
