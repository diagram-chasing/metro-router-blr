<script lang="ts">
	import { onMount } from 'svelte';

	import maplibre from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { createClock, type Clock } from '$lib/viz/clock';
	import { loadDeck, type Deck } from '$lib/viz/deck';
	import { ChoroplethField, type HoodReading } from '$lib/viz/choroplethField';
	import { buildFieldLayer, buildHoodLabels } from '$lib/viz/layers';
	import { roadsOnlyStyle, easeInOutCubic, easeOutCubic, easeInOutSine } from '$lib/viz/palette';
	import { WALL } from '$lib/config/wall';
	import {
		REST,
		emissionsFieldUrl,
		flattenSegments,
		loadBaseline as loadFieldBaseline,
		pollField as pollFieldSnapshot
	} from '$lib/viz/wallField';
	import { routePM25, PM25_MAX_G_PER_PKM, type Leg } from '$lib/emissions';

	let { variant = 'wall' }: { variant?: 'home' | 'wall' } = $props();

	// Reactive overlay bits (everything else is imperative for perf).
	let count = $state<number | null>(null);
	let yearsLost = $state(0); // avg years of life added by commutes, over affected corridors
	// Hero label brackets the number: top line, figure, bottom line. Empty drops that line.
	let title = $state(WALL.title);
	let subtitle = $state(WALL.subtitle);
	let titleEvery = $state(WALL.titleEvery); // s between hero appearances
	let heroOpacity = $state(0); // hero pulse opacity, driven from the rAF loop
	let loading = $state(false); // true while the pre-reveal progress bar fills
	let loadProgress = $state(0); // 0..1 fill of that bottom-edge bar
	let queued = $state(0); // routes waiting their spotlight — surfaced as "+N others joined"
	let activeTag = $state<string | undefined>(undefined); // O→D label of the route on screen
	let scaleW = $state(WALL.scale); // wall type scale, for viewing distance

	// Recalc readout — a large, minimal card in the top band (route + the grams of PM2.5 this
	// journey deposits over a decade). Fixed position so it stays clear of the lit corridor and
	// reads from across the room; only opacity animates. Driven from the rAF loop.
	let card = $state<{ show: boolean; opacity: number; route?: string; grams: number }>({
		show: false,
		opacity: 0,
		grams: 0
	});

	let mapContainer: HTMLDivElement;
	let map: maplibre.Map | undefined;
	let overlay: InstanceType<Deck['MapboxOverlay']> | undefined;

	const DUR: Record<string, number> = WALL.dur;
	const PHASES = ['dim', 'reveal', 'hold', 'recalc', 'zoomBack', 'settle'] as const;
	const DIM_MIN = WALL.dimMin;
	const IDLE_REST = WALL.idleRest; // s the resting field + headline hold before the next route fires
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

	const HERO_RISE = WALL.hero.rise;
	const HERO_HOLD = WALL.hero.hold;
	const HERO_FALL = WALL.hero.fall;

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
		let phase: 'idle' | 'load' | (typeof PHASES)[number] = 'idle';
		let phaseStart = 0;
		let activeRoute: [number, number][] = [];
		let activeIsDemo = false;
		let activeKm = 0; // featured route's trip length (km)
		let activePm25 = 0; // featured route's blended PM2.5 (g/passenger-km)
		let activeTrips = 0; // featured route's trips/year
		let activeScale = 0; // featured route's emission scale (0..1) vs the dirtiest mode
		let routeCells: number[] = [];
		// The featured route's card payload; null when no card is live. Set as the camera zooms
		// in, cleared once it has zoomed back out.
		let cardData: { route?: string; grams: number } | null = null;
		// FIFO of routes awaiting their spotlight — every submission gets its moment; under
		// backlog we compress the long phases (below) rather than dropping anyone. Each carries the
		// route's PM2.5 attributes so its card figure and field bump match the mode actually chosen.
		type Pending = {
			route: [number, number][];
			isDemo: boolean;
			label?: string;
			km: number;
			pm25PerPkm: number;
			tripsPerYear: number;
			emissionScale: number;
		};
		const queue: Pending[] = [];

		// Compress only the long, non-reveal phases when routes are waiting, so nobody waits
		// too long for their spotlight; never faster than 0.45× so it stays legible at distance.
		const phaseDur = (ph: string) => {
			if (ph === 'hold' || ph === 'recalc') {
				return DUR[ph] * Math.max(0.45, 1 - 0.12 * queue.length);
			}
			return DUR[ph];
		};

		(async () => {
			// All tuning lives in $lib/config/wall.ts — the field self-configures from it; nothing here
			// reads the URL. (gain/years/saturation are read straight off WALL inside ChoroplethField.)
			const bg = WALL.bg;
			const zoom = REST.zoom;
			const pollMs = WALL.poll;
			const dpr = WALL.dpr || Math.min(2, window.devicePixelRatio || 1);
			cellDeg = WALL.cell;
			const loadDur = WALL.load;
			const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
			const idleAmt = WALL.idle;
			const driftAmt = WALL.drift;
			const demo = WALL.demo;
			const blockyAmt = WALL.blocky; // heat super-cell size (chunks the smooth field)

			const deck = await loadDeck();
			if (disposed) return;

			map = new maplibre.Map({
				container: mapContainer,
				style: roadsOnlyStyle(bg),
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

			// Constant dotted road network, baked over the grid bbox (static/wall-roads.json via
			// `pnpm wall-roads:build`). Live tiles drop minor/service roads at the wide resting
			// zoom, so they'd pop in only when zoomed into a corridor; baked, the whole network is
			// steady at every scale and covers the full grid. Falls back to the style's vector road
			// layers when the bake hasn't been generated yet.
			const addBakedRoads = async () => {
				try {
					const res = await fetch('/wall-roads.json');
					if (!res.ok) return; // not baked → keep the vector road layers from roadsOnlyStyle
					const wr = (await res.json()) as {
						roads: [number, number][][];
						roadsFaint: [number, number][][];
					};
					const fc = (lines: [number, number][][]) => ({
						type: 'FeatureCollection' as const,
						features: lines.map((coordinates) => ({
							type: 'Feature' as const,
							properties: {},
							geometry: { type: 'LineString' as const, coordinates }
						}))
					});
					const dotted = (
						id: string,
						opacity: number,
						w: [number, number, number, number]
					): maplibre.LayerSpecification => ({
						id,
						type: 'line',
						source: id,
						layout: { 'line-cap': 'round', 'line-join': 'round' },
						paint: {
							'line-color': '#000000',
							'line-width': ['interpolate', ['linear'], ['zoom'], w[0], w[1], w[2], w[3]],
							'line-dasharray': [0, 2.2],
							'line-opacity': opacity
						}
					});
					const before = map!.getLayer('place-minor') ? 'place-minor' : undefined;
					if (!map!.getSource('wall-roads')) {
						map!.addSource('wall-roads', { type: 'geojson', data: fc(wr.roads) });
						map!.addSource('wall-roads-faint', { type: 'geojson', data: fc(wr.roadsFaint) });
						map!.addLayer(dotted('wall-roads-faint', 0.18, [9, 0.7, 16, 1.6]), before);
						map!.addLayer(dotted('wall-roads', 0.6, [9, 0.9, 16, 2.2]), before);
					}
					// Drop the vector tiers so the baked network isn't doubled or zoom-dependent.
					for (const id of ['roads', 'roads-faint']) if (map!.getLayer(id)) map!.removeLayer(id);
				} catch (err) {
					console.warn('CollectiveMap wall-roads load failed:', err);
				}
			};
			await addBakedRoads();

			// The deck heat field is inserted just BELOW the bottom-most basemap context layer, so
			// the dotted roads and place labels render on top of the heat and bloom in with the
			// zoom-grade ramp below — rather than sitting under the field where the heat washes them
			// out. Bottom-most existing of the baked tiers, the vector fallback, or the labels.
			const fieldBeforeId = [
				'wall-roads-faint',
				'roads-faint',
				'wall-roads',
				'roads',
				'place-minor',
				'place-major'
			].find((id) => map!.getLayer(id));

			const fieldUrl = emissionsFieldUrl(cellDeg);

			// Resting baseline: ACAG annual-mean PM2.5 (µg/m³) baked to our lattice — the
			// air the city already breathes; the commute layer adds onto it.
			const loadBaseline = () => loadFieldBaseline(field, 'CollectiveMap baseline');
			const pollField = () => pollFieldSnapshot(field, fieldUrl, now, 'CollectiveMap field poll');

			// `seed` advances the cursor past everything already in the DB without queuing it: the
			// existing routes are already baked into the field (via pollField), so re-spotlighting
			// them on load would replay the whole backlog. Only routes that arrive after this seed
			// get the reveal animation.
			const pollLines = async (seed = false) => {
				try {
					const res = await fetch(`/api/lines?sinceId=${lastId}`);
					const { lines } = (await res.json()) as {
						lines: {
							id: number;
							originLabel?: string;
							destinationLabel?: string;
							tripsPerYear: number | null;
							segments: Leg[];
						}[];
					};
					for (const l of lines) {
						if (l.id <= lastId) continue; // forward-only; server already filters by sinceId
						lastId = Math.max(lastId, l.id);
						if (seed) continue; // cursor only — don't animate routes that predate this load
						const r = flattenSegments(l.segments);
						if (r.length < 2) continue;
						const label =
							l.originLabel && l.destinationLabel
								? `${l.originLabel} → ${l.destinationLabel}`
								: undefined;
						// Blend the route's PM2.5 over its legs (walk/metro count 0) so the card and the
						// field bump reflect the mode actually chosen.
						const pm = routePM25(l.segments);
						const emissionScale = PM25_MAX_G_PER_PKM > 0 ? pm.gPerKm / PM25_MAX_G_PER_PKM : 0;
						queue.push({
							route: r,
							isDemo: false,
							label,
							km: pm.km,
							pm25PerPkm: pm.gPerKm,
							tripsPerYear: l.tripsPerYear ?? 288,
							emissionScale
						}); // every route, not just the newest
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
				if (p2 === 'load') {
					loading = true;
					loadProgress = 0;
				} else if (p2 === 'dim') {
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
					// Card rides the whole featured window: it appears as the camera zooms in and
					// fades out as it zooms back. The grams figure is deterministic, so compute it up front.
					cardData = {
						route: activeTag,
						grams: field.estimateRouteGrams(activeKm, activeTrips, activePm25)
					};
				} else if (p2 === 'recalc') {
					// Recalculation sweep AROUND the route while we're still zoomed in — the field
					// does NOT climb yet. Folding the route in is deferred to zoomBack so the order
					// reads recalc → zoom out → reflect (the climb used to race ahead of the sweep).
					// Keep the buffered snapshot fresh so it's current at that reflect beat.
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
				} else if (p2 === 'zoomBack') {
					// Reflect: now fold the route in so the corridor climbs (our commutes compounding
					// over the decade) as the camera pulls back to the full field. Apply any buffered
					// server snapshot first, then the demo's local deposit on top of it.
					field.releaseSnapshots(t);
					if (activeIsDemo) field.addRouteDeposit(routeCells, t, 0.9, activeScale);
					field.clearRoute(); // ignite folds away, leaving the compounded corridor
					map!.easeTo({
						center: restView.center,
						zoom: restView.zoom,
						duration: DUR.zoomBack * 1000,
						easing: easeInOutCubic
					});
				} else if (p2 === 'settle') {
					cardData = null; // card has faded out with the zoom-back
				} else if (p2 === 'idle') {
					field.clearRoute();
				}
			};

			// ── Ambient idle drift ──
			// When nothing is being featured the camera doesn't sit dead still: it slowly
			// wanders the grid with long sine-eased glides — mostly gentle zoom-ins onto a
			// sub-region, panning from one to the next, then breathing back out to the full
			// resting frame every third move. Only ISSUED while idle; an in-flight glide is
			// left to finish during the following "load" wait, and the route reveal's easeTo
			// overrides it. At rest zoom the grid already fills the viewport (maxBounds clamps
			// any pan), so the only motion with headroom is the zoom-in — exactly the calm
			// effect we want. Empty queue → idle persists → it wanders freely; once routes
			// arrive, idle is brief and the spotlight takes over.
			const AMBIENT = WALL.ambient; // s per glide / s held at each framing
			let ambientNextAt = -1; // t the next glide may fire; <0 = not yet seeded
			let ambientMove = 0; // glide counter; every 3rd breathes out to the full frame
			const ambientEnabled = driftAmt > 0 && !reduceMotion;

			const ambientDrift = (t: number) => {
				if (!ambientEnabled || !field.ready) return;
				if (ambientNextAt < 0) ambientNextAt = t + 6; // let the field reveal settle first
				if (phase !== 'idle') {
					// A route owns the camera (or is loading); resume a beat after it rests again.
					ambientNextAt = t + AMBIENT.hold;
					return;
				}
				if (t < ambientNextAt) return;

				const [lonMin, latMin, lonMax, latMax] = field.bounds;
				const w = lonMax - lonMin;
				const h = latMax - latMin;
				const breatheOut = ambientMove % 3 === 2;
				ambientMove++;

				let center: [number, number];
				let zoom: number;
				if (breatheOut) {
					center = restView.center;
					zoom = restView.zoom;
				} else {
					// A random sub-region, inset from the edges so maxBounds doesn't clamp it.
					const mx = 0.28 * w;
					const my = 0.28 * h;
					center = [
						lonMin + mx + Math.random() * (w - 2 * mx),
						latMin + my + Math.random() * (h - 2 * my)
					];
					zoom = restView.zoom + (0.5 + 0.8 * Math.random()) * Math.min(1.6, driftAmt);
				}

				const dur = AMBIENT.glide * (0.85 + 0.3 * Math.random()); // ±15% organic timing
				ambientNextAt = t + dur + AMBIENT.hold;
				map!.easeTo({ center, zoom, duration: dur * 1000, easing: easeInOutSine });
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
						activeKm = next.km;
						activePm25 = next.pm25PerPkm;
						activeTrips = next.tripsPerYear;
						activeScale = next.emissionScale;
						enter('load', t); // "load" the route for loadDur seconds before revealing it
					}
					return;
				}
				if (phase === 'load') {
					field.setDim(1); // map rests while the bar fills
					loadProgress = clamp01((t - phaseStart) / loadDur);
					if (t - phaseStart >= loadDur) {
						loading = false;
						loadProgress = 0;
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
				ambientDrift(t); // gentle camera wander during the quiet times
				field.setFrame(t);
				field.fillTexture(); // rebuilds the field texture only when the data moved

				const lt = Math.round(t * 8); // label refresh cadence
				if (lt !== labelTick) {
					labelTick = lt;
					hoods = field.hoodMonths();
					// Methods note: the map bed is TOTAL air = real ACAG ambient PM2.5 (the city's
					// existing burden, traffic included) + the commute increment. The headline,
					// though, reports only the MARGINAL years the submitted commutes add on top of
					// that ambient bed — a what-if attributable to these journeys, not the city's
					// full burden (which is dominated by ambient air the commutes didn't cause) —
					// averaged over the corridors they actually touch, not the empty bbox.
					yearsLost = field.marginalYearsAdded();
				}

				// Continuous `t` (not quantised) → smooth shader animation; the texture itself
				// only re-uploads when fillTexture bumped its identity.
				const fieldLayer = field.ready
					? buildFieldLayer(deck, field, {
							time: t,
							idle: idleAmt,
							beforeId: fieldBeforeId,
							blocky: blockyAmt
						})
					: null;

				// Route card: fades in as the camera zooms to the route, holds through the featured
				// window, fades out as it zooms back. Tied to the phase, so it's on for exactly the
				// zoomed-in span. Fixed position, so only opacity animates — no jitter at distance.
				if (cardData) {
					const ce = t - phaseStart;
					const co =
						phase === 'dim'
							? easeOutCubic(clamp01(ce / DUR.dim))
							: phase === 'reveal' || phase === 'hold' || phase === 'recalc'
								? 1
								: phase === 'zoomBack'
									? 1 - easeInOutCubic(clamp01(ce / DUR.zoomBack))
									: 0;
					card = {
						show: co > 0.001,
						opacity: clamp01(co),
						route: cardData.route,
						grams: cardData.grams
					};
				} else if (card.show) {
					card = { show: false, opacity: 0, grams: 0 };
				}

				// Hero pulse: fade in, hold, fade out, then stay hidden until the next cycle. Keyed
				// to `now % titleEvery` so the window is fixed and the period sets only the gap.
				let hv: number;
				if (reduceMotion) {
					hv = 1;
				} else {
					const hc = titleEvery > 0 ? now % titleEvery : 0;
					hv =
						hc < HERO_RISE
							? easeOutCubic(clamp01(hc / HERO_RISE))
							: hc < HERO_RISE + HERO_HOLD
								? 1
								: hc < HERO_RISE + HERO_HOLD + HERO_FALL
									? 1 - Math.pow(clamp01((hc - HERO_RISE - HERO_HOLD) / HERO_FALL), 3)
									: 0;
				}
				if (heroOpacity !== hv) heroOpacity = hv; // skip 60fps no-op writes while hidden

				const layers = fieldLayer ? [fieldLayer, ...buildHoodLabels(deck, hoods, lt, scaleW)] : [];
				overlay?.setProps({ layers });
			}, watchdog);

			// Demo: queue a synthetic route periodically so State B can be seen without live
			// submissions. Cycle the mode so the attract loop shows the mode-aware intensity — a
			// metro deposits nothing (no bright thread), a car the most.
			const DEMO_KINDS = ['cab', 'bus', 'auto', 'metro'] as const;
			let demoN = 0;
			const fireDemo = () => {
				const a: [number, number] = [77.55 + Math.random() * 0.16, 12.9 + Math.random() * 0.16];
				const b: [number, number] = [77.55 + Math.random() * 0.16, 12.9 + Math.random() * 0.16];
				const mid: [number, number] = [(a[0] + b[0]) / 2 + 0.01, (a[1] + b[1]) / 2 - 0.01];
				const route: [number, number][] = [a, mid, b];
				const pm = routePM25([{ coords: route, legKind: DEMO_KINDS[demoN++ % DEMO_KINDS.length] }]);
				const emissionScale = PM25_MAX_G_PER_PKM > 0 ? pm.gPerKm / PM25_MAX_G_PER_PKM : 0;
				queue.push({
					route,
					isDemo: true,
					km: pm.km,
					pm25PerPkm: pm.gPerKm,
					tripsPerYear: 480,
					emissionScale
				});
				queued = queue.length;
			};

			// Boot resilience: a wall powers on before its local server is necessarily ready.
			// Retry the critical loads with backoff until the field is live. The basemap is
			// already visible during this, so never blank.
			for (let i = 0; !field.ready && !disposed; i++) {
				await Promise.all([loadBaseline(), pollField(), pollStats()]);
				if (!field.ready && !disposed) {
					await new Promise((r) => setTimeout(r, Math.min(5000, 500 * (i + 1))));
				}
			}
			await pollLines(true); // seed past existing routes; only new submissions get spotlighted

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

				// Reward the zoom-ins. Now that roads + labels composite ON TOP of the heat (the
				// field's beforeId puts it underneath), grade their opacity by zoom so the wide
				// resting frame is near-pure heat and the basemap detail blooms in over it as the
				// drift moves in — the city's streets and place names fading up out of the field
				// in the area we approach, then fading back out as it pulls away. Keyed to the
				// runtime cover zoom (only known now); easeTo's zoom interpolation drives the fade
				// for free, both ways. Faint streets + neighbourhood names gain the most (a clean
				// reveal); arteries and the city name keep a whisper at rest so the frame isn't bare.
				const z0 = restView.zoom;
				const z1 = restView.zoom + 1.3;
				const ramp = (a: number, b: number) => ['interpolate', ['linear'], ['zoom'], z0, a, z1, b];
				const grade = (id: string, prop: string, a: number, b: number) => {
					if (map!.getLayer(id)) map!.setPaintProperty(id, prop, ramp(a, b));
				};
				grade('wall-roads-faint', 'line-opacity', 0.08, 0.6); // baked residential/service
				grade('wall-roads', 'line-opacity', 0.4, 0.9); // baked arteries
				grade('roads-faint', 'line-opacity', 0.08, 0.6); // vector fallback (no bake)
				grade('roads', 'line-opacity', 0.4, 0.9); // vector fallback (no bake)
				grade('place-minor', 'text-opacity', 0.0, 1.0); // neighbourhood names reveal on zoom
				grade('place-major', 'text-opacity', 0.5, 1.0); // city/town names firm up

				// Never show beyond the grid: clamp every camera move (incl. edge-route easeTo) to the
				// grid bbox, so framing a corridor near the border can't reveal the bare basemap around it.
				map.setMaxBounds([
					[lonMin, latMin],
					[lonMax, latMax]
				]);
			}

			// From here on the field only changes at a route's reflect beat: background polls are
			// buffered (frozen) and released in zoomBack, so the corridor never climbs mid-reveal.
			field.freezeSnapshots();

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

	{#if loading}
		<!-- Thin "loading" bar filling the bottom edge L→R while the next route is prepared. -->
		<div class="loadbar"><div class="fill" style="transform:scaleX({loadProgress})"></div></div>
	{/if}

	{#if card.show}
		<!-- The featured route's readout as a little receipt slip: white paper, monospace, a dashed
		     rule, and the PM2.5 this commute deposits over a decade in a reverse (black-on-white)
		     hero bar — matching src/lib/receipt. On screen for the whole zoomed-in window. -->
		<div class="routecard slip" style="opacity:{card.opacity}; --wall-scale:{scaleW}">
			<div class="route">{card.route ?? 'New journey'}</div>
			<div class="rule"></div>
			{#if card.grams >= 1000}
				<div class="emis">+{(card.grams / 1000).toFixed(1)}<span class="unit"> kg PM2.5 / 10yr</span></div>
			{:else}
				<div class="emis">+{Math.round(card.grams)}<span class="unit"> g PM2.5 / 10yr</span></div>
			{/if}
		</div>
	{/if}

	{#if count !== null && count > 0}
		<!-- The title as a receipt slip — same language as src/lib/receipt/ReceiptDoc: white paper,
		     mono, a dashed rule, the number in a reverse (white-on-black) hero bar. Top-left, inset
		     off the keystoned/vignetted projector edge. ?title= / ?subtitle= set the lines; either
		     empty drops that line. -->
		<div class="safe">
			<div class="hero slip" style="opacity:{heroOpacity}">
				{#if title}
					<div class="line">{title}</div>
					<div class="rule"></div>
				{/if}
				<div class="total">{yearsLost.toFixed(1)}</div>
				{#if subtitle}<div class="fine">{subtitle}</div>{/if}
			</div>
		</div>
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
	/* Thin pre-reveal loading bar — full-width faint track at the very bottom edge, warm fill
	   scaling in from the left. Above the overlays so it's never occluded. */
	.loadbar {
		position: absolute;
		left: 0;
		right: 0;
		bottom: 0;
		height: calc(var(--wall-scale) * 4px);
		background: rgba(255, 255, 255, 0.08);
		z-index: 18;
		pointer-events: none;
	}
	.loadbar .fill {
		height: 100%;
		width: 100%;
		transform-origin: left center;
		background: #ffe2d6;
		will-change: transform;
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
	/* Shared receipt-slip surface — white paper, mono, crisp 1-bit, same language as
	   src/lib/receipt/ReceiptDoc (.paper). Both the hero title and the route card use it. */
	.slip {
		background: #fff;
		color: #000;
		font-family: ui-monospace, 'Liberation Mono', 'Cascadia Mono', 'DejaVu Sans Mono', Menlo,
			'Courier New', monospace;
		-webkit-font-smoothing: none;
		font-smooth: never;
		box-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
	}
	.hero {
		display: flex;
		flex-direction: column;
		gap: calc(var(--wall-scale) * 8px);
		width: fit-content;
		max-width: 60%;
		padding: calc(var(--wall-scale) * 12px) calc(var(--wall-scale) * 15px);
		text-align: center;
		/* Opacity is driven from the rAF loop (pulse once per ?titleEvery=s). */
		will-change: opacity;
	}
	.hero .line {
		font-size: calc(var(--wall-scale) * clamp(14px, 1.4vw, 26px));
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		line-height: 1.15;
	}
	.hero .rule {
		border-top: 2px dashed #000;
	}
	/* The reverse hero bar (white-on-black), after ReceiptDoc's .rev inverted total. */
	.hero .total {
		background: #000;
		color: #fff;
		font-size: calc(var(--wall-scale) * clamp(46px, 5.8vw, 106px));
		font-weight: 700;
		line-height: 1;
		letter-spacing: -0.01em;
		padding: calc(var(--wall-scale) * 7px) calc(var(--wall-scale) * 14px);
		font-variant-numeric: tabular-nums;
	}
	.hero .fine {
		font-size: calc(var(--wall-scale) * clamp(12px, 1.2vw, 19px));
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}
	/* Recalc readout styled as a receipt slip: white paper, monospace, a dashed rule, and the
	   emissions in a reverse (black-on-white) hero — same language as src/lib/receipt/ReceiptDoc.
	   No glass/blur/glow; crisp 1-bit, font smoothing off, to match the printed aesthetic. */
	.routecard {
		position: absolute;
		right: clamp(20px, 4.5%, 84px);
		bottom: clamp(20px, 4.5%, 84px);
		z-index: 16;
		pointer-events: none;
		display: flex;
		flex-direction: column;
		gap: calc(var(--wall-scale) * 8px);
		min-width: calc(var(--wall-scale) * 220px);
		max-width: calc(var(--wall-scale) * 320px);
		padding: calc(var(--wall-scale) * 12px) calc(var(--wall-scale) * 14px);
		transition: opacity 0.15s linear;
		will-change: opacity;
	}
	.routecard .route {
		font-size: calc(var(--wall-scale) * 15px);
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
		font-size: calc(var(--wall-scale) * clamp(26px, 3vw, 44px));
		font-weight: 700;
		line-height: 1;
		text-align: center;
		letter-spacing: 0.01em;
		padding: calc(var(--wall-scale) * 8px) calc(var(--wall-scale) * 10px);
		font-variant-numeric: tabular-nums;
	}
	.routecard .emis .unit {
		font-size: 0.4em;
		font-weight: 700;
		letter-spacing: 0.05em;
	}
	:global(.maplibregl-ctrl-logo),
	:global(.maplibregl-ctrl-attrib-button) {
		display: none !important;
	}
</style>
