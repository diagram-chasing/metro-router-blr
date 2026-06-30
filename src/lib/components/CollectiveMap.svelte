<script lang="ts">
	import { onMount } from 'svelte';

	import maplibre from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { createClock, type Clock } from '$lib/viz/clock';
	import { loadDeck, type Deck } from '$lib/viz/deck';
	import { ChoroplethField, type HoodReading } from '$lib/viz/choroplethField';
	import {
		buildFieldLayer,
		buildHoodLabels,
		buildDotsLayer,
		buildRouteLayers
	} from '$lib/viz/layers';
	import { roadsOnlyStyle, easeInOutCubic, easeOutCubic, easeInOutSine } from '$lib/viz/palette';
	import { loadWallRoads, gridDots, gridDotsFill, hexToRgb } from '$lib/viz/dottedBasemap';
	import { WALL } from '$lib/config/wall';
	import {
		REST,
		emissionsFieldUrl,
		flattenSegments,
		loadBaseline as loadFieldBaseline,
		pollField as pollFieldSnapshot
	} from '$lib/viz/wallField';
	import {
		routePM25,
		PM25_MAX_G_PER_PKM,
		MODE_PM25_G_PER_PKM,
		legKindToMode,
		pm25Bucket,
		type Leg
	} from '$lib/emissions';
	import type { LegKind } from '$lib/exhibit/routeCandidates';
	import SootSpreadBanner from './SootSpreadBanner.svelte';
	import AqiExplainer from './AqiExplainer.svelte';

	let { variant = 'wall' }: { variant?: 'home' | 'wall' } = $props();

	// Reactive overlay bits (everything else is imperative for perf).
	let count = $state<number | null>(null);
	// Aggregate readouts from /api/stats. modeSplit feeds the cold-start fallback distribution; the two
	// PM2.5 sums (over a decade) feed the AQI explainer's avoidable-soot line; pm25Bands is the
	// soot-per-km histogram the spread banner draws.
	let modeSplit = $state<Record<string, number>>({});
	let pm25ActualG = $state(0);
	let pm25AvoidableG = $state(0);
	let pm25Bands = $state<number[]>([]);
	let titleEvery = $state(WALL.titleEvery); // s between banner appearances
	let loading = $state(false); // true while the pre-reveal progress bar fills
	let loadProgress = $state(0); // 0..1 fill of that bottom-edge bar
	let queued = $state(0); // routes waiting their spotlight — surfaced as "+N more waiting"
	let activeTag = $state<string | undefined>(undefined); // O→D label of the route on screen
	let scaleW = $state(WALL.scale); // wall type scale, for viewing distance

	// Top-banner channels — both ride the WALL.hero pulse envelope + titleEvery cadence. The soot-spread
	// distribution and the AQI explainer alternate on idle beats; a route spotlight forces the spread up
	// with ▲ YOU on the featured route's band. spreadMine is that route's g/pkm (-1 = idle, no caret);
	// spreadAppear re-keys the banner so the band draw-in replays each appearance.
	let spreadOpacity = $state(0);
	let spreadAppear = $state(0);
	let spreadMine = $state(-1);
	let explainerOpacity = $state(0);
	let explainerWhich = $state<0 | 1>(0);

	// Rising soot number — the grams of PM2.5 the featured journey deposits over a decade, fading in at
	// the route's centre, scaling up and floating upward as if emitted. Replaces the old corner card;
	// projected to screen each frame, transform-only so it never thrashes layout.
	let emit = $state<{
		show: boolean;
		x: number;
		y: number;
		opacity: number;
		scale: number;
		grams: number;
	}>({
		show: false,
		x: 0,
		y: 0,
		opacity: 0,
		scale: 1,
		grams: 0
	});

	// Incoming-journey teaser shown during the load dwell — builds anticipation for the next reveal.
	let teaser = $state<{ show: boolean; origin?: string; dest?: string; queued: number }>({
		show: false,
		queued: 0
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

	// Bands the spread banner draws: prefer the server histogram; before the first poll (or an old
	// server) fall back to an approximation from modeSplit × each mode's PM2.5 — enough to avoid an
	// empty banner on cold start. modeSplit is keyed by candidate kind (cab/auto/metro/bus/walk).
	const fallbackBands = $derived.by(() => {
		const b = [0, 0, 0, 0, 0];
		for (const [kind, n] of Object.entries(modeSplit)) {
			const mode = legKindToMode(kind as LegKind);
			b[pm25Bucket(MODE_PM25_G_PER_PKM[mode] ?? 0)] += n;
		}
		return b;
	});
	const bandsToShow = $derived(pm25Bands.length ? pm25Bands : fallbackBands);

	// ── Dev-only overlay toggles (persisted) ──
	// Number keys flip an overlay's visibility (1 spread · 2 explainer · 3 emit · 4 teaser · 5 loadbar);
	// Shift+number PINS it — forces it on-screen at full opacity with sample data so it can be styled in
	// isolation, independent of the animation state machine. 0 toggles all, v swaps the explainer's two
	// messages, h/? hides this hint. State persists to localStorage so it survives HMR/reloads. Gated to
	// dev — import.meta.env.DEV is statically false in prod, so this whole block is dead-code-eliminated
	// and the wall is never affected (dbg defaults all-true, pins all-false → overlays behave normally).
	const DEV = import.meta.env.DEV;
	const DBG_KEY = 'collectivemap:debug';
	type DbgKey = 'spread' | 'explainer' | 'emit' | 'teaser' | 'loadbar';
	type PinKey = 'spread' | 'explainer' | 'emit' | 'teaser';
	const loadDbg = () => {
		if (!DEV || typeof localStorage === 'undefined') return null;
		try {
			return JSON.parse(localStorage.getItem(DBG_KEY) ?? 'null') as {
				dbg?: Partial<Record<DbgKey, boolean>>;
				pin?: Partial<Record<PinKey, boolean>>;
				dbgHelp?: boolean;
				dbgWhich?: 0 | 1;
				freezeDrift?: boolean;
			} | null;
		} catch {
			return null;
		}
	};
	const savedDbg = loadDbg();
	let dbg = $state({
		spread: savedDbg?.dbg?.spread ?? true,
		explainer: savedDbg?.dbg?.explainer ?? true,
		emit: savedDbg?.dbg?.emit ?? true,
		teaser: savedDbg?.dbg?.teaser ?? true,
		loadbar: savedDbg?.dbg?.loadbar ?? true
	});
	let pin = $state({
		spread: savedDbg?.pin?.spread ?? false,
		explainer: savedDbg?.pin?.explainer ?? false,
		emit: savedDbg?.pin?.emit ?? false,
		teaser: savedDbg?.pin?.teaser ?? false
	});
	let dbgHelp = $state(savedDbg?.dbgHelp ?? true);
	let dbgWhich = $state<0 | 1>(savedDbg?.dbgWhich ?? 0);
	let winW = $state(0);
	let winH = $state(0);

	// Camera / state-machine controls (for styling a specific phase). freezeDrift stops the ambient
	// wander; freezeMachine pauses the whole spotlight sequence at the current phase AND holds its clock
	// so within-phase animations stop where they are; armHold makes the next summoned route auto-freeze
	// once it reaches the zoomed-in highlight. fireDemoRef bridges to the imperative loop's fireDemo().
	let freezeDrift = $state(savedDbg?.freezeDrift ?? false);
	let freezeMachine = $state(false);
	let armHold = $state(false);
	let fireDemoRef: (() => void) | null = null;

	// Persist on any change (deep-reads via stringify so every nested flag is tracked).
	$effect(() => {
		if (!DEV || typeof localStorage === 'undefined') return;
		localStorage.setItem(DBG_KEY, JSON.stringify({ dbg, pin, dbgHelp, dbgWhich, freezeDrift }));
	});

	onMount(() => {
		if (!DEV) return;
		const KEYS: Record<string, DbgKey> = {
			Digit1: 'spread',
			Digit2: 'explainer',
			Digit3: 'emit',
			Digit4: 'teaser',
			Digit5: 'loadbar'
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.code === 'KeyH' || e.key === '?') return void (dbgHelp = !dbgHelp);
			if (e.code === 'KeyV') return void (dbgWhich = dbgWhich === 0 ? 1 : 0);
			if (e.code === 'KeyD') return void (freezeDrift = !freezeDrift); // freeze the ambient camera
			if (e.code === 'KeyF') return void (freezeMachine = !freezeMachine); // pause the state machine
			if (e.code === 'KeyG') {
				// Summon a demo route and lock it once it reaches the zoomed-in highlight.
				freezeMachine = false;
				armHold = true;
				fireDemoRef?.();
				return;
			}
			if (e.code === 'KeyX') return void ((freezeMachine = false), (armHold = false)); // resume
			if (e.code === 'Digit0') {
				const v = !(dbg.spread || dbg.explainer || dbg.emit || dbg.teaser || dbg.loadbar);
				dbg.spread = v;
				dbg.explainer = v;
				dbg.emit = v;
				dbg.teaser = v;
				dbg.loadbar = v;
				return;
			}
			const key = KEYS[e.code];
			if (!key) return;
			if (e.shiftKey && key !== 'loadbar')
				pin[key] = !pin[key]; // Shift+n → pin for styling
			else dbg[key] = !dbg[key]; // n → show/hide
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// Effective overlay views — when pinned, force the element on at full opacity with sample data so it
	// renders steadily for styling even while the state machine is idle.
	const SAMPLE_BANDS = [3, 11, 9, 6, 2];
	const emitView = $derived.by(() => {
		if (!pin.emit) return emit;
		if (emit.show) return { ...emit, opacity: 1 };
		return { show: true, x: winW / 2, y: winH / 2, opacity: 1, scale: 1, grams: 1840 };
	});
	const spreadView = $derived.by(() => {
		if (!dbg.spread) return null;
		const live = count !== null && count > 0;
		if (pin.spread) {
			const bands = bandsToShow.some((n) => n > 0) ? bandsToShow : SAMPLE_BANDS;
			return {
				bands,
				total: live ? (count ?? 0) : 31,
				mine: spreadMine >= 0 ? spreadMine : 0.012,
				opacity: 1,
				appearance: spreadAppear
			};
		}
		if (!live) return null;
		return {
			bands: bandsToShow,
			total: count ?? 0,
			mine: spreadMine,
			opacity: spreadOpacity,
			appearance: spreadAppear
		};
	});
	const teaserView = $derived.by(() => {
		if (!dbg.teaser) return null;
		if (pin.teaser)
			return {
				show: true,
				origin: teaser.origin ?? 'Indiranagar',
				dest: teaser.dest ?? 'Majestic',
				queued: teaser.queued || 3
			};
		return teaser.show ? teaser : null;
	});
	const showExplainer = $derived(dbg.explainer && (pin.explainer || (count !== null && count > 0)));

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

		// Dotted basemap (the receipt / mapscii dot-field as live points). Grid-sampled once at boot
		// into tiers; the rAF loop rebuilds the layers each frame so opacity can bloom with zoom.
		// Roads are two tiers of black dots; water/green are coloured dot-FILLS of the baked polygons
		// (mapscii rasterises filled polygons to the same dot grid — see dottedBasemap.gridDotsFill).
		let majorDots: [number, number][] | null = null;
		let faintDots: [number, number][] = [];
		let waterDots: [number, number][] = [];
		let greenDots: [number, number][] = [];
		const dotColor = hexToRgb(WALL.basemap.color);
		const waterColor = hexToRgb(WALL.basemap.water.color);
		const greenColor = hexToRgb(WALL.basemap.green.color);
		let dotsZ0 = REST.zoom; // zoom→opacity bloom range, fixed once the cover zoom is known
		let dotsZ1 = REST.zoom + 1.3;

		// State machine.
		let phase: 'idle' | 'load' | (typeof PHASES)[number] = 'idle';
		let phaseStart = 0;
		// The live dim ramp (1 at rest → DIM_MIN while a route is featured), hoisted out of step() so
		// the rAF loop can read it: the water/green dot-fields fade out with it, leaving only the roads
		// lit during a spotlight.
		let dimLevel = 1;
		let activeRoute: [number, number][] = [];
		let activeCenter: [number, number] | null = null; // featured route's bbox centre (geo) — load lean + rising-soot anchor
		let activeIsDemo = false;
		let activeOrigin: string | undefined; // featured route's origin/destination names (receipt chips)
		let activeDest: string | undefined;
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
			originLabel?: string;
			destLabel?: string;
			km: number;
			pm25PerPkm: number;
			tripsPerYear: number;
			emissionScale: number;
		};
		const queue: Pending[] = [];

		// Compress the two message phases when routes are waiting, so nobody waits too long for
		// their spotlight; clamped to a 6s floor (below) so each message stays legible at distance.
		const phaseDur = (ph: string) => {
			if (ph === 'hold' || ph === 'recalc') {
				// Never below 6s: each message has to stay readable across the room despite backlog.
				return Math.max(6, DUR[ph] * (1 - 0.08 * queue.length));
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
			const stepsW = WALL.steps; // posterize the heat into discrete bands (0/<2 = smooth ramp)
			const ditherAmt = WALL.dither; // ordered-dither stipple amount (0 = smooth heat)
			const ditherTypeW = WALL.ditherType; // Bayer matrix size (2 | 4 | 8)
			const ditherPxW = WALL.ditherPx; // stipple dot size in device pixels

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

			// Dotted basemap: the road network (static/wall-roads.json via `pnpm wall-roads:build`)
			// sampled into a field of points and drawn as live GPU dots (a deck ScatterplotLayer in the
			// rAF loop) — the receipt's 1-bit dot-field (src/lib/receipt/viz/RouteMap), crisp at every
			// zoom. A baked raster aliases into moiré stripes under maplibre's mercator warp, so we
			// render points instead. Falls back to roadsOnlyStyle's vector road layers when not baked.
			const addBasemap = async () => {
				const wr = await loadWallRoads();
				if (disposed || !map || !wr) return; // not baked → keep the vector road layers
				majorDots = gridDots(wr.roads, wr.bbox, WALL.basemap.major.cellM);
				faintDots = WALL.basemap.includeFaint
					? gridDots(wr.roadsFaint, wr.bbox, WALL.basemap.faint.cellM)
					: [];
				// Water + greenery: fill the baked polygons into the same dot grid (mapscii's dot-fill).
				waterDots = wr.water ? gridDotsFill(wr.water, wr.bbox, WALL.basemap.water.cellM) : [];
				greenDots = wr.green ? gridDotsFill(wr.green, wr.bbox, WALL.basemap.green.cellM) : [];
				// Drop the vector tiers so the dotted points aren't doubled or zoom-dependent.
				for (const id of ['roads', 'roads-faint']) if (map.getLayer(id)) map.removeLayer(id);
			};
			await addBasemap();

			// The deck heat field is inserted just BELOW the place labels; the dotted basemap layers
			// (water/green fills, then roads — also deck layers, ordered after it) render above the
			// heat and under the labels, so the lakes/green belt and the roads composite on top of the
			// heat and bloom in with the zoom-grade. Vector road layers are the fallback before a bake.
			const fieldBeforeId = ['place-minor', 'place-major', 'roads-faint', 'roads'].find((id) =>
				map!.getLayer(id)
			);

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
							originLabel: l.originLabel,
							destLabel: l.destinationLabel,
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
					const s = (await res.json()) as {
						count: number;
						modeSplit?: Record<string, number>;
						pm25ActualG10yr?: number;
						pm25AvoidableG10yr?: number;
						pm25BandsAll?: number[];
					};
					count = s.count;
					modeSplit = s.modeSplit ?? {};
					pm25ActualG = s.pm25ActualG10yr ?? 0;
					pm25AvoidableG = s.pm25AvoidableG10yr ?? 0;
					pm25Bands = s.pm25BandsAll ?? [];
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
					teaser = { show: true, origin: activeOrigin, dest: activeDest, queued: queue.length };
					// Lean gently toward the incoming route's region so the wait isn't a dead-still frame.
					if (activeCenter) {
						const ll = WALL.loadLean;
						map!.easeTo({
							center: [
								lerp(restView.center[0], activeCenter[0], ll.frac),
								lerp(restView.center[1], activeCenter[1], ll.frac)
							],
							zoom: restView.zoom + ll.zoom,
							duration: WALL.load * 0.6 * 1000,
							easing: easeInOutSine
						});
					}
				} else if (p2 === 'dim') {
					// The blocky route overlay (buildRouteLayers) now carries the reveal, so the field no
					// longer ignites the corridor. We still rasterize for the zoomBack deposit (demo routes).
					routeCells = field.rasterizeRoute(activeRoute);
					const b = new maplibre.LngLatBounds();
					for (const c of activeRoute) b.extend(c);
					const cam = map!.cameraForBounds(b, {
						padding: WALL.focus.padding,
						maxZoom: WALL.focus.maxZoom
					});
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
					// Recalc sweep removed. Hold the zoomed-in route a beat while the field stays put;
					// just keep the buffered server snapshot fresh so it's current when the field climbs
					// at the zoomBack reflect.
					void pollField();
				} else if (p2 === 'zoomBack') {
					// Reflect: now fold the route in so the corridor climbs (our commutes compounding
					// over the decade) as the camera pulls back to the full field. Apply any buffered
					// server snapshot first, then the demo's local deposit on top of it.
					field.releaseSnapshots(t);
					if (activeIsDemo) field.addRouteDeposit(routeCells, t, 0.9, activeScale);
					field.clearRoute(); // force the texture to refresh to the compounded corridor
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
				if (freezeDrift || freezeMachine) return; // dev: hold the camera still for styling
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
					dimLevel = 1;
					if (activeTag) activeTag = undefined; // clear the on-screen tag between routes
					if (freezeMachine) return; // dev: hold idle (no dequeue) for styling the resting frame
					// Let the resting field + headline settle before the next route, unless a
					// backlog is building — then dequeue promptly so nobody waits too long.
					const rest = queue.length > 2 ? 0.3 : IDLE_REST;
					if (t - phaseStart < rest) return;
					const next = queue.shift();
					if (next) {
						queued = queue.length;
						activeRoute = next.route;
						activeIsDemo = next.isDemo;
						activeOrigin = next.originLabel;
						activeDest = next.destLabel;
						activeTag = next.label;
						activeKm = next.km;
						activePm25 = next.pm25PerPkm;
						activeTrips = next.tripsPerYear;
						activeScale = next.emissionScale;
						// Route bbox centre (geo) — drives the load lean and the rising-soot anchor. Bearing
						// and pitch are fixed 0, so this projects straight to screen space.
						let lo0 = Infinity,
							la0 = Infinity,
							lo1 = -Infinity,
							la1 = -Infinity;
						for (const [lo, la] of next.route) {
							if (lo < lo0) lo0 = lo;
							if (lo > lo1) lo1 = lo;
							if (la < la0) la0 = la;
							if (la > la1) la1 = la;
						}
						activeCenter = [(lo0 + lo1) / 2, (la0 + la1) / 2];
						enter('load', t); // "load" the route for loadDur seconds before revealing it
					}
					return;
				}
				if (phase === 'load') {
					field.setDim(1); // map rests while the bar fills
					dimLevel = 1;
					loadProgress = clamp01((t - phaseStart) / loadDur);
					if (!freezeMachine && t - phaseStart >= loadDur) {
						loading = false;
						loadProgress = 0;
						teaser = { ...teaser, show: false };
						enter('dim', t);
					}
					return;
				}
				// dev: a summoned route auto-freezes once it reaches the zoomed-in highlight (hold).
				if (armHold && phase === 'hold') {
					armHold = false;
					freezeMachine = true;
				}
				const el = t - phaseStart;
				const dim =
					phase === 'dim'
						? lerp(1, DIM_MIN, easeInOutCubic(clamp01(el / DUR.dim)))
						: phase === 'settle'
							? lerp(DIM_MIN, 1, easeInOutCubic(clamp01(el / DUR.settle)))
							: DIM_MIN;
				field.setDim(dim);
				dimLevel = dim;
				if (!freezeMachine && el >= phaseDur(phase)) {
					const ni = PHASES.indexOf(phase as (typeof PHASES)[number]) + 1;
					enter(ni < PHASES.length ? PHASES[ni] : 'idle', t);
				}
			};

			let labelTick = -1;
			let anchorTick = -1; // slower cadence for re-querying which labels are visible
			let lastFadeT = 0; // previous frame time, for dt-based opacity easing
			let prevClockT = 0; // previous frame time, for the dev freeze clock-hold
			// Rising-edge trackers for the two top-banner channels (so each appearance replays its draw-in
			// and picks up the right ▲ YOU / explainer message exactly once).
			let spotPrev = false; // spotlight distribution shown last frame
			let explPrev = false; // explainer shown last frame
			let hoods: HoodReading[] = [];
			// Reused render objects, one per live label, keyed the same as liveLabels. We mutate these in
			// place and only swap the `hoods` array when the SET changes, so deck recomputes glyph layout
			// only on membership change — opacity rides the cheap getColor `fade` trigger between.
			const hoodObjs = new Map<string, HoodReading>();
			let fadeKey = 0; // getColor updateTrigger; advanced only while a fade is in flight

			// Number anchors ride the OSM place labels the basemap is already showing — no hand-placed
			// list. maplibre's own symbol collision has already decluttered these, so we re-query the
			// visible set and inherit that spread for free. The set is kept STABLE across refreshes
			// (sticky selection in thinAnchors) and each label eases its opacity in/out, so the wall
			// reads calm — labels gently fade as the view moves instead of reshuffling every refresh.
			type PlaceAnchor = { name: string; c: [number, number]; r: number };
			// A label currently on (or fading off) the wall: its anchor, last field reading, and an eased
			// opacity chasing `target` (1 = shown, 0 = leaving → deleted once it has faded out).
			type LiveLabel = {
				name: string;
				c: [number, number];
				r: number;
				months: number;
				delta: number; // commute-attributable years (months) over the satellite baseline
				op: number;
				target: number;
			};
			const liveLabels = new Map<string, LiveLabel>();
			const keyOf = (a: { name: string; c: [number, number] }) =>
				a.name || `${a.c[0].toFixed(4)},${a.c[1].toFixed(4)}`;

			// Cap the simultaneous figures (WALL.maxLabels). Score each anchor by its field reading and
			// drop those over empty field. To stop the set thrashing as the camera moves, KEEP the labels
			// already shown (activeKeys) as long as they're still candidates, and only farthest-point
			// spread NEW picks into the remaining slots — so survivors stay put and just the gaps change.
			const thinAnchors = (anchors: PlaceAnchor[], activeKeys: Set<string>): PlaceAnchor[] => {
				const scored = anchors
					.map((a) => ({ a, m: field.monthsAround(a.c[0], a.c[1], a.r) ?? -1 }))
					.filter((s) => s.m >= 0);
				if (scored.length <= WALL.maxLabels) return scored.map((s) => s.a);
				const latMid = scored.reduce((s, x) => s + x.a.c[1], 0) / scored.length;
				const kx = Math.cos((latMid * Math.PI) / 180) || 1;
				const d2 = (p: PlaceAnchor, q: PlaceAnchor) =>
					((p.c[0] - q.c[0]) * kx) ** 2 + (p.c[1] - q.c[1]) ** 2;
				// Held-over labels keep their slots (worst-first); the rest compete for any gaps left.
				const picked = scored.filter((s) => activeKeys.has(keyOf(s.a))).sort((x, y) => y.m - x.m);
				const rest = scored.filter((s) => !activeKeys.has(keyOf(s.a)));
				if (picked.length === 0 && rest.length) {
					rest.sort((x, y) => y.m - x.m);
					picked.push(rest.shift()!); // nothing held over yet → the single worst always shows
				}
				while (picked.length < WALL.maxLabels && rest.length) {
					let bestI = 0;
					let bestD = -1;
					for (let i = 0; i < rest.length; i++) {
						let dmin = Infinity;
						for (const q of picked) dmin = Math.min(dmin, d2(rest[i].a, q.a));
						if (dmin > bestD) {
							bestD = dmin;
							bestI = i;
						}
					}
					picked.push(rest.splice(bestI, 1)[0]);
				}
				return picked.slice(0, WALL.maxLabels).map((s) => s.a);
			};

			const refreshPlaceAnchors = () => {
				if (!map) return;
				const layers = ['place-minor'].filter((id) => map!.getLayer(id)); // neighbourhood names
				if (layers.length === 0) return;
				const out: PlaceAnchor[] = [];
				const seen = new Set<string>();
				try {
					for (const f of map.queryRenderedFeatures({ layers })) {
						if (f.geometry.type !== 'Point') continue;
						const c = f.geometry.coordinates as [number, number];
						const name = String(f.properties?.['name:latin'] ?? f.properties?.name ?? '');
						const key = name || `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
						if (seen.has(key)) continue; // a place can repeat across tile seams
						seen.add(key);
						out.push({ name, c, r: 1.8 }); // neighbourhood averaging radius
					}
				} catch {
					return; // tiles mid-load → keep the last good label set
				}
				// Sticky pick (held-over labels keep their slots), then reconcile into liveLabels: picked
				// labels fade toward 1, everything else toward 0 (deleted once it has fully faded out).
				const active = new Set<string>();
				for (const [k, l] of liveLabels) if (l.target === 1) active.add(k);
				const pickedKeys = new Set<string>();
				for (const a of thinAnchors(out, active)) {
					const k = keyOf(a);
					pickedKeys.add(k);
					const rd = field.readingAround(a.c[0], a.c[1], a.r);
					const existing = liveLabels.get(k);
					if (existing) {
						existing.target = 1;
						if (rd) {
							existing.months = rd.months;
							existing.delta = rd.delta;
						}
					} else if (rd) {
						liveLabels.set(k, {
							name: a.name,
							c: a.c,
							r: a.r,
							months: rd.months,
							delta: rd.delta,
							op: 0,
							target: 1
						});
					}
				}
				for (const [k, l] of liveLabels) if (!pickedKeys.has(k)) l.target = 0;
			};

			// Watchdog only on the unattended wall: if the rAF loop stalls (GPU context loss,
			// throttle), reload to last-good rather than freezing a dead frame on the wall.
			const watchdog =
				variant === 'wall' ? { onStall: () => location.reload(), stallMs: 6000 } : {};
			clock = createClock((t) => {
				now = t;
				// dev freeze: advance phaseStart with the clock so `t - phaseStart` is held constant —
				// every phase-relative animation (dim ramp, highlight, soot rise, spread) stops in place.
				if (freezeMachine && prevClockT) phaseStart += t - prevClockT;
				prevClockT = t;
				step(t);
				ambientDrift(t); // gentle camera wander during the quiet times
				field.setFrame(t);
				field.fillTexture(); // rebuilds the field texture only when the data moved

				// Re-query which labels are visible: on a settle (moveend) and, while the camera moves, at
				// a calm 3 Hz so the set doesn't thrash — the per-label fades (below) smooth each change.
				const at = Math.round(t * 3);
				if (at !== anchorTick) {
					anchorTick = at;
					if (map?.isMoving()) refreshPlaceAnchors();
				}

				const lt = Math.round(t * 8); // field-reading refresh cadence
				if (lt !== labelTick) {
					labelTick = lt;
					// Keep each live label's figure current; if the field has gone empty under one (the
					// same gate that leaves the heat transparent there), retire it — it then fades out.
					for (const l of liveLabels.values()) {
						const rd = field.readingAround(l.c[0], l.c[1], l.r);
						if (!rd) l.target = 0;
						else {
							l.months = rd.months;
							l.delta = rd.delta;
						}
					}
				}

				// Ease every label's opacity toward its target this frame, drop the fully-faded, and keep
				// the render objects in sync. dt-based so a full fade takes ~FADE_S at any frame rate
				// (clamped against the long gap when the tab was backgrounded). The `hoods` array swaps
				// only when membership changes; `fadeKey` advances only while a fade is in flight, so
				// fully-settled idle frames cost deck nothing.
				const dt = Math.min(0.05, Math.max(0, t - lastFadeT));
				lastFadeT = t;
				const FADE_S = 0.5;
				let membershipChanged = false;
				let transitioning = false;
				for (const [k, l] of liveLabels) {
					if (l.op !== l.target) {
						const d = dt / FADE_S;
						l.op = l.target > l.op ? Math.min(l.target, l.op + d) : Math.max(l.target, l.op - d);
						transitioning = true;
					}
					if (l.target === 0 && l.op <= 0.001) {
						liveLabels.delete(k);
						if (hoodObjs.delete(k)) membershipChanged = true;
						continue;
					}
					const h = hoodObjs.get(k);
					if (h) {
						h.opacity = l.op;
						h.months = l.months;
						h.delta = l.delta;
					} else {
						hoodObjs.set(k, {
							name: l.name,
							c: l.c,
							months: l.months,
							delta: l.delta,
							opacity: l.op
						});
						membershipChanged = true;
					}
				}
				if (membershipChanged) hoods = [...hoodObjs.values()];
				if (transitioning) fadeKey++;

				// Continuous `t` (not quantised) → smooth shader animation; the texture itself
				// only re-uploads when fillTexture bumped its identity.
				const fieldLayer = field.ready
					? buildFieldLayer(deck, field, {
							time: t,
							idle: idleAmt,
							beforeId: fieldBeforeId,
							blocky: blockyAmt,
							steps: stepsW,
							dither: ditherAmt,
							ditherType: ditherTypeW,
							ditherPx: ditherPxW
						})
					: null;

				// Highlight envelope: 0 at rest → 1 across the featured window → 0 again as the camera
				// zooms back. One curve drives the receipt-style route overlay (fades in) and the ambient
				// neighbourhood labels (fade out) so they move together.
				const phaseEl = t - phaseStart;
				const highlight =
					phase === 'dim'
						? easeOutCubic(clamp01(phaseEl / DUR.dim))
						: phase === 'reveal' || phase === 'hold' || phase === 'recalc'
							? 1
							: phase === 'zoomBack'
								? 1 - easeInOutCubic(clamp01(phaseEl / DUR.zoomBack))
								: 0;

				// Soot number: at hold start the route is fully drawn (the zoom-in easeTo spans dim+reveal).
				// The grams fade in at the route centre and float up, then HOLD — staying fully up for the
				// whole hold phase so the emitted amount reads for its full ~7s (≥6s) window. It fades out
				// only once the camera hands off to the distribution chart (recalc). Projected each frame,
				// transform-only so it never thrashes layout.
				const EMIT_RISE = Math.min(WALL.emit.rise, 0.35 * phaseDur('hold'));
				if (cardData && activeCenter && map && (phase === 'hold' || phase === 'recalc')) {
					const pr = map.project(activeCenter as [number, number]);
					if (phase === 'hold') {
						const e = clamp01(phaseEl / EMIT_RISE);
						const eo = easeOutCubic(e);
						emit = {
							show: true,
							x: pr.x,
							y: pr.y - eo * WALL.emit.risePx * scaleW,
							opacity: clamp01(e / 0.18), // quick fade-in, then held at 1 through hold
							scale: 1 + 0.12 * eo,
							grams: cardData.grams
						};
					} else {
						// recalc: the distribution chart has taken over — fade the number out, then drop it.
						const out = 1 - clamp01(phaseEl / 0.6);
						if (out <= 0.001) {
							if (emit.show) emit = { ...emit, show: false, opacity: 0 };
						} else {
							emit = { ...emit, opacity: out, show: true };
						}
					}
				} else if (emit.show) {
					emit = { ...emit, show: false, opacity: 0 };
				}

				// Two top-banner channels on the WALL.hero pulse + titleEvery cadence. The soot-per-km
				// distribution appears ONLY as the climax of a route spotlight (recalc, after the soot
				// number has had its window) — never on idle beats. The idle pulse cycles the AQI
				// explainer's two messages.
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
				const beat = titleEvery > 0 ? Math.floor(now / titleEvery) : 0;
				const idle = phase === 'idle'; // timer banners pulse only when nothing is featured

				// Distribution chart envelope: it's the spotlight climax. Held at 0 through the soot-number
				// window (hold), draws in at the start of recalc, holds through it (~8s, ≥6s floor), then
				// eases out on the zoom-back as the map resumes.
				const spotE = reduceMotion
					? phase === 'recalc' || phase === 'zoomBack'
						? 1
						: 0
					: phase === 'recalc'
						? clamp01(phaseEl / HERO_RISE)
						: phase === 'zoomBack'
							? 1 - easeInOutCubic(clamp01(phaseEl / DUR.zoomBack))
							: 0;
				const spotlightActive = spotE > 0.001;

				// Rising edge → replay the band draw-in once and pin ▲ YOU on the featured route's band.
				if (spotlightActive && !spotPrev) {
					spreadMine = activePm25;
					spreadAppear++;
				}
				spotPrev = spotlightActive;
				const explShowing = idle && hv > 0.02; // the explainer is the only idle-beat banner now
				if (explShowing && !explPrev) {
					explainerWhich = (beat % 2) as 0 | 1; // alternate its two messages beat to beat
				}
				explPrev = explShowing;

				const nextSpread = spotE; // distribution only during a spotlight, never on idle beats
				const nextExpl = idle ? hv : 0;
				if (spreadOpacity !== nextSpread) spreadOpacity = nextSpread; // skip 60fps no-op writes
				if (explainerOpacity !== nextExpl) explainerOpacity = nextExpl;

				// Dotted basemap tiers (if baked) sit above the heat, below the place labels. Bottom→top:
				// the green then water dot-FILLS (coloured), then the black road dots (faint network under
				// bold arteries). Each dot's radius is metres (cell-filling, so areas/roads stay
				// continuous); opacity blooms with zoom — faint over the wide resting frame, firming up as
				// the camera moves into a corridor.
				const bm = WALL.basemap;
				const bloom = (rest: number, zoom: number) =>
					lerp(rest, zoom, clamp01((map!.getZoom() - dotsZ0) / (dotsZ1 - dotsZ0 || 1)));
				// While a route is featured the field dims to DIM_MIN; fade the water/green dot-fields out
				// on the same envelope (1 at rest → 0 at full dim) so only the roads stay lit in the
				// corridor. Roads pass mul=1 and are unaffected.
				const ecoMul = clamp01((dimLevel - DIM_MIN) / (1 - DIM_MIN || 1));
				const dot = (
					id: string,
					pts: [number, number][],
					cellM: number,
					color: [number, number, number],
					o: { restOpacity: number; zoomOpacity: number },
					mul = 1
				) =>
					buildDotsLayer(deck, pts, {
						id,
						radiusM: cellM * bm.fillRatio,
						minPx: bm.minPx,
						maxPx: bm.maxPx,
						color,
						opacity: bloom(o.restOpacity, o.zoomOpacity) * mul,
						beforeId: fieldBeforeId // above the heat, under the place labels
					});
				const dotLayers =
					majorDots && fieldLayer
						? [
								...(greenDots.length
									? [dot('dots-green', greenDots, bm.green.cellM, greenColor, bm.green, ecoMul)]
									: []),
								...(waterDots.length
									? [dot('dots-water', waterDots, bm.water.cellM, waterColor, bm.water, ecoMul)]
									: []),
								...(faintDots.length
									? [dot('dots-faint', faintDots, bm.faint.cellM, dotColor, bm.faint)]
									: []),
								dot('dots-major', majorDots, bm.major.cellM, dotColor, bm.major)
							]
						: [];

				// Featured route, drawn the receipt way (blocky cells + origin ring + destination disc +
				// endpoint name chips), on top of the dimmed field. The blocks reveal across the `reveal`
				// phase, in lockstep with the heat cells igniting (igniteRoute starts at dim-end and spans
				// DUR.reveal); fully drawn through hold/recalc, then they fade out as the camera zooms back.
				const drawProgress =
					phase === 'reveal'
						? clamp01(phaseEl / DUR.reveal)
						: phase === 'hold' || phase === 'recalc' || phase === 'zoomBack'
							? 1
							: 0;
				const routeLayers =
					fieldLayer && highlight > 0.001 && activeRoute.length >= 2
						? buildRouteLayers(deck, activeRoute, {
								opacity: highlight,
								bg: hexToRgb(WALL.bg),
								beforeId: fieldBeforeId,
								scale: scaleW,
								progress: drawProgress,
								names: { origin: activeOrigin, dest: activeDest }
							})
						: [];

				// The ambient neighbourhood labels fade out as the route comes up (and back in after),
				// so the corridor reads clean. Advance their getColor trigger as the factor moves.
				const labelMul = clamp01(1 - highlight);
				const labelFade = fadeKey + Math.round(labelMul * 255);

				// The commute-vs-baseline delta is a zoom-in detail: hidden at the wide resting frame
				// (where it'd just be tiny clutter across every label), it fades in only as the ambient
				// drift moves in on a sub-region, annotating the handful of labels in that closer view.
				// Keyed to the runtime cover zoom (dotsZ0 = resting zoom): off at rest, fully opaque just
				// 0.4 levels in — well inside the ambient zoom range (~0.5–1.3 above rest) so a closer
				// framing always reads at full strength, not half-faded.
				const deltaMul = clamp01((map!.getZoom() - (dotsZ0 + 0.1)) / 0.3);

				const layers = fieldLayer
					? [
							fieldLayer,
							...dotLayers,
							...routeLayers,
							...buildHoodLabels(deck, hoods, lt, scaleW, labelFade, labelMul, deltaMul)
						]
					: [];
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
			fireDemoRef = fireDemo; // bridge for the dev "summon highlight" (g) shortcut

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

				// Reward the zoom-ins. Now that the dotted basemap composites ON TOP of the heat (the
				// field's beforeId puts it underneath), grade its opacity by zoom so the wide resting
				// frame is near-pure heat and the streets bloom in over it as the drift moves in — fading
				// up out of the field in the area we approach, then back out as it pulls away. Keyed to the
				// runtime cover zoom (only known now); easeTo's zoom interpolation drives the fade for free,
				// both ways. The dotted roads keep a whisper at rest so the frame isn't bare. (The receipt-
				// slip neighbourhood labels are a deck layer drawn at full strength, not graded here.)
				const z0 = restView.zoom;
				const z1 = restView.zoom + 1.3;
				const ramp = (a: number, b: number) => ['interpolate', ['linear'], ['zoom'], z0, a, z1, b];
				const grade = (id: string, prop: string, a: number, b: number) => {
					if (map!.getLayer(id)) map!.setPaintProperty(id, prop, ramp(a, b));
				};
				// The dotted points are a deck layer, not a maplibre paint property — bloom them in the
				// rAF loop instead. Stash the runtime cover-zoom range it interpolates over.
				dotsZ0 = z0;
				dotsZ1 = z1;
				grade('roads-faint', 'line-opacity', 0.08, 0.6); // vector fallback (no bake)
				grade('roads', 'line-opacity', 0.4, 0.9); // vector fallback (no bake)
				// Label the larger neighbourhood areas, not the city; hide the city/town tier.
				if (map.getLayer('place-major')) map.setLayoutProperty('place-major', 'visibility', 'none');
				if (map.getLayer('place-minor')) {
					// The names are now drawn by the deck receipt-slip labels (buildHoodLabels). Keep
					// place-minor only as the collision-spread, queryRenderedFeatures ANCHOR source — its
					// own glyphs stay invisible (opacity 0; collision still runs, so query still returns them).
					map.setPaintProperty('place-minor', 'text-opacity', 0);
					map.setLayoutProperty('place-minor', 'text-size', ramp(26, 36)); // sets the collision box
					// Inflate each label's collision box well beyond its glyphs so maplibre keeps only a
					// sparse spread — the higher-rank (larger) areas survive, the rest collide out. This
					// is what actually thins them; raise it to show fewer, lower to show more.
					map.setLayoutProperty('place-minor', 'text-padding', 150);
				}

				// Never show beyond the grid: clamp every camera move (incl. edge-route easeTo) to the
				// grid bbox, so framing a corridor near the border can't reveal the bare basemap around it.
				map.setMaxBounds([
					[lonMin, latMin],
					[lonMax, latMax]
				]);

				// Re-read which place labels maplibre is showing when the camera settles — the final,
				// authoritative pass (the rAF loop already re-queries at 8 Hz *during* a move so labels
				// track the view live; this catches the resting frame exactly).
				map.on('moveend', refreshPlaceAnchors);
				refreshPlaceAnchors(); // seed at the resting frame, before the first move
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

<svelte:window bind:innerWidth={winW} bind:innerHeight={winH} />

<div
	class="absolute inset-0 bg-[#04060c]"
	class:cursor-none={variant === 'wall'}
	style="--wall-scale:{scaleW}"
>
	<div bind:this={mapContainer} class="absolute inset-0 h-full w-full"></div>

	{#if loading && dbg.loadbar}
		<!-- Thin "loading" bar filling the bottom edge L→R while the next route is prepared. -->
		<div
			class="pointer-events-none absolute inset-x-0 bottom-0 z-[18] h-[calc(var(--wall-scale)*10px)] bg-white/[0.08]"
		>
			<div
				class="h-full w-full origin-left bg-[#ffe2d6] will-change-transform"
				style="transform:scaleX({loadProgress})"
			></div>
		</div>
	{/if}

	{#if teaserView}
		<div
			class="pointer-events-none absolute bottom-[calc(var(--wall-scale)*26px)] left-1/2 z-[18] flex -translate-x-1/2 animate-[teaser-in_0.45s_cubic-bezier(0.2,0.9,0.25,1)_both] flex-row items-center gap-[calc(var(--wall-scale)*16px)] whitespace-nowrap border-[calc(var(--wall-scale)*2px)] border-ink bg-paper px-[calc(var(--wall-scale)*8px)] py-[calc(var(--wall-scale)*8px)] font-mono text-ink shadow-[0_8px_30px_rgba(0,0,0,0.5)] [-webkit-font-smoothing:none] [font-smooth:never] motion-reduce:animate-none"
		>
			<!-- status tag — inverted chip (ink block, paper type) -->
			<span
				class="bg-ink px-[calc(var(--wall-scale)*15px)] py-[calc(var(--wall-scale)*13px)] text-[length:calc(var(--wall-scale)*clamp(10px,1.85vw,24px))] font-bold uppercase tracking-[0.14em] text-paper"
			>
				NEW COMMUTE
			</span>

			{#if teaserView.origin || teaserView.dest}
				<!-- the route is the hero of the row -->
				<span
					class="mr-4 text-[length:calc(var(--wall-scale)*clamp(18px,1.7vw,30px))] font-bold tracking-[0.02em]"
				>
					{teaserView.origin ?? '—'} → {teaserView.dest ?? '—'}
				</span>
			{/if}

			<!-- {#if teaserView.queued > 0}
				<span
					class="text-[length:calc(var(--wall-scale)*clamp(10px,0.85vw,14px))] font-bold uppercase tracking-[0.06em] opacity-55"
				>
					+{teaserView.queued} more
				</span>
			{/if} -->
		</div>
	{/if}

	{#if emitView.show && dbg.emit}
		<div
			class="pointer-events-none absolute left-0 top-0 z-[16] will-change-[transform,opacity]"
			style="transform: translate3d({emitView.x}px, {emitView.y}px, 0) translate(-50%, -50%) scale({emitView.scale}); opacity:{emitView.opacity}; --wall-scale:{scaleW}"
		>
			<div
				class="flex animate-[emit-pop_0.55s_cubic-bezier(0.34,1.56,0.64,1)_both] flex-col items-center gap-[calc(var(--wall-scale)*4px)] border-[calc(var(--wall-scale)*2px)] border-black bg-ink px-[calc(var(--wall-scale)*16px)] py-[calc(var(--wall-scale)*10px)] font-mono text-paper shadow-[0_8px_30px_rgba(0,0,0,0.5)] [-webkit-font-smoothing:none] [font-smooth:never] motion-reduce:animate-none"
			>
				<div
					class="flex items-baseline whitespace-nowrap tabular-nums leading-none tracking-[0.01em] text-[#ff5a36]"
				>
					<span
						class="inline-block origin-bottom animate-[emit-plus_0.5s_cubic-bezier(0.34,1.8,0.5,1)_0.06s_both] text-[length:calc(var(--wall-scale)*clamp(40px,5.5vw,88px))] font-bold motion-reduce:animate-none"
						>+</span
					>
					<span class="text-[length:calc(var(--wall-scale)*clamp(40px,4.5vw,88px))] font-bold">
						{emitView.grams >= 1000
							? (emitView.grams / 1000).toFixed(1)
							: Math.round(emitView.grams)}</span
					>
					<span
						class="ml-[calc(var(--wall-scale)*6px)] text-[length:calc(var(--wall-scale)*clamp(18px,2.5vw,44px))] font-black"
						>{emitView.grams >= 1000 ? 'kg' : 'g'}</span
					>
				</div>
				<div
					class="text-white! animate-[emit-caption_0.4s_ease-out_0.2s_both] text-[length:calc(var(--wall-scale)*clamp(9px,1.8vw,24px))] font-bold uppercase opacity-70 motion-reduce:animate-none"
				>
					PM2.5 over 10 years
				</div>
			</div>
		</div>
	{/if}

	{#if spreadView}
		<!-- Soot-per-km distribution (where this commute lands) — pulses on the timer and is the climax
		     of each spotlight with ▲ YOU on the featured route's band. -->
		<SootSpreadBanner
			bands={spreadView.bands}
			mine={spreadView.mine}
			total={spreadView.total}
			opacity={spreadView.opacity}
			scale={scaleW}
			appearance={spreadView.appearance}
			stagger={WALL.spread.stagger}
			drawIn={WALL.spread.drawIn}
		/>
	{/if}
	{#if showExplainer}
		<!-- The intermittent one-liner: soot → the AQI you breathe → months of life (alternates with
		     the avoidable-soot call-to-action). -->
		<AqiExplainer
			which={pin.explainer ? dbgWhich : explainerWhich}
			actualG={pm25ActualG}
			avoidableG={pm25AvoidableG}
			opacity={pin.explainer ? 1 : explainerOpacity}
			scale={scaleW}
		/>
	{/if}

	{#if DEV && dbgHelp}
		<!-- Dev-only overlay-toggle HUD (gated to import.meta.env.DEV; absent from the prod wall). -->
		<div
			class="pointer-events-none absolute bottom-2 left-2 z-50 rounded bg-black/70 px-3 py-2 font-mono text-xs leading-relaxed text-white"
		>
			<div class="mb-1 font-bold uppercase tracking-wider opacity-60">debug · h to hide</div>
			<div class="mb-1 opacity-50">n hide · ⇧n pin (force-on)</div>
			<div>
				<span class="opacity-50">1</span> spread
				<span class={dbg.spread ? 'text-green-400' : 'text-red-400'}>{dbg.spread ? '●' : '○'}</span>
				{#if pin.spread}<span class="text-yellow-400">pin</span>{/if}
			</div>
			<div>
				<span class="opacity-50">2</span> explainer
				<span class={dbg.explainer ? 'text-green-400' : 'text-red-400'}
					>{dbg.explainer ? '●' : '○'}</span
				>
				{#if pin.explainer}<span class="text-yellow-400">pin</span>{/if}
			</div>
			<div>
				<span class="opacity-50">3</span> emit
				<span class={dbg.emit ? 'text-green-400' : 'text-red-400'}>{dbg.emit ? '●' : '○'}</span>
				{#if pin.emit}<span class="text-yellow-400">pin</span>{/if}
			</div>
			<div>
				<span class="opacity-50">4</span> teaser
				<span class={dbg.teaser ? 'text-green-400' : 'text-red-400'}>{dbg.teaser ? '●' : '○'}</span>
				{#if pin.teaser}<span class="text-yellow-400">pin</span>{/if}
			</div>
			<div>
				<span class="opacity-50">5</span> loadbar
				<span class={dbg.loadbar ? 'text-green-400' : 'text-red-400'}
					>{dbg.loadbar ? '●' : '○'}</span
				>
			</div>
			<div><span class="opacity-50">0</span> toggle all</div>
			<div class="my-1 border-t border-white/20"></div>
			<div>
				<span class="opacity-50">d</span> drift
				<span class={freezeDrift ? 'text-red-400' : 'text-green-400'}
					>{freezeDrift ? 'off' : 'on'}</span
				>
			</div>
			<div>
				<span class="opacity-50">f</span> freeze
				<span class={freezeMachine ? 'text-yellow-400' : 'opacity-50'}
					>{freezeMachine ? 'held' : '—'}</span
				>
			</div>
			<div><span class="opacity-50">g</span> summon highlight</div>
			<div><span class="opacity-50">x</span> resume</div>
			<div><span class="opacity-50">v</span> swap explainer msg</div>
		</div>
	{/if}
</div>

<style>
	/* spring-ish pop: quick overshoot, a settle dip, then home — with a tiny rotate for life */
	@keyframes -global-emit-pop {
		0% {
			opacity: 0;
			transform: scale(0.2) rotate(-4deg);
		}
		55% {
			opacity: 1;
			transform: scale(1.14) rotate(2deg);
		}
		72% {
			transform: scale(0.95) rotate(-1deg);
		}
		86% {
			opacity: 1 !important;
			transform: scale(1.03);
		}
		100% {
			opacity: 1 !important;
			transform: scale(1) rotate(0deg);
		}
	}
	/* the "+" punches in a beat after the badge — Comeau-style orchestration */
	@keyframes -global-emit-plus {
		0% {
			transform: scale(0);
		}
		60% {
			transform: scale(1.35);
		}
		100% {
			transform: scale(1);
		}
	}
	/* caption rises and fades in last */
	@keyframes -global-emit-caption {
		from {
			opacity: 0;
			transform: translateY(45%);
		}
		to {
			opacity: 0.7;
			transform: translateY(0);
		}
	}
</style>
