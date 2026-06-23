<script lang="ts">
	// The wall as a living pollution map. Each commute route is drawn as a stepped dotted
	// line (the receipt map's pixel language), animated being drawn as it arrives and
	// coloured by its emissions (cool = clean transit → warm = dirty private vehicles).
	// The city's emissions-accumulation raster (/api/emissions) then drives a drifting
	// pollution cloud that pools around the busy corridors and across the map. A brighter
	// dot-matrix context layer labels roads + neighbourhoods on top. Same feed as FlowMap.
	import { onMount } from 'svelte';

	import { createClock, type Clock } from '$lib/viz/clock';
	import { lineToLegPaths, type LegPath, type WireLine } from '$lib/viz/tripsData';
	import { fetchEmissions, fetchLines, type Stats } from '$lib/viz/flow/feed';
	import { makeProjector, BENGALURU_BBOX, type Projector } from '$lib/viz/flow/projection';
	import { FlowFieldModel, DEFAULT_FIELD_PARAMS } from '$lib/viz/flow/field';
	import { ParticleSystem, DEFAULT_PARTICLE_PARAMS, type Emitter } from '$lib/viz/flow/particles';
	import { FlowRenderer, DEFAULT_RENDER_PARAMS } from '$lib/viz/flow/renderer';
	import { drawContext, DEFAULT_CONTEXT_PARAMS } from '$lib/viz/flow/context';
	import { steppedDots } from '$lib/viz/flow/lines';
	import { loadBasemap, type Basemap } from '$lib/receipt/viz/braille';
	import type { RGB } from '$lib/viz/palette';

	import CounterfactualBanner from '$lib/components/wall/CounterfactualBanner.svelte';
	import EmptyState from '$lib/components/wall/EmptyState.svelte';
	import Hud from '$lib/components/wall/Hud.svelte';

	let cfStrength = $state(0);
	let shiftPct = $state(50);
	let stats = $state<Stats | null>(null);
	let savedPct = $state<number | null>(null);

	let wrap: HTMLDivElement;
	let flowCanvas: HTMLCanvasElement;
	let contextCanvas: HTMLCanvasElement;

	const num = (p: URLSearchParams, k: string, d: number) => {
		const v = Number(p.get(k));
		return isFinite(v) && v > 0 ? v : d;
	};
	const numAny = (p: URLSearchParams, k: string, d: number) => {
		const raw = p.get(k);
		const v = Number(raw);
		return raw !== null && isFinite(v) ? v : d;
	};
	const flag = (p: URLSearchParams, k: string, d: boolean) => {
		const v = p.get(k);
		return v === null ? d : v === '1' || v === 'true';
	};

	const strokeFade = (f: number) => (f < 0.12 ? f / 0.12 : (1 - f) / 0.88);
	// emissions colour stop: clean transit (teal) → dirty private vehicles (red)
	const bucketHue = (b: number) => 0.42 + (Math.max(0, Math.min(4, b)) / 4) * 0.5;

	type SrcLine = { coords: [number, number][]; hueT: number; bucket: number; bornAt: number };
	type LinePx = { dots: [number, number][]; pts: [number, number][]; hueT: number; size: number; weight: number; bornAt: number };

	onMount(() => {
		let disposed = false;
		let clock: Clock | undefined;
		let pollTimer: ReturnType<typeof setInterval> | undefined;
		let fieldTimer: ReturnType<typeof setInterval> | undefined;
		let ro: ResizeObserver | undefined;

		const p = new URLSearchParams(window.location.search);
		const dpr = num(p, 'dpr', Math.min(2, window.devicePixelRatio || 1));
		const pollMs = Math.max(1500, num(p, 'poll', 4000));
		const maxTrips = Math.max(200, Math.round(num(p, 'maxTrips', 1200)));

		let cfMode: 'auto' | 'on' | 'off' = 'auto';
		const cfParam = p.get('cf');
		cfMode = cfParam === 'on' || cfParam === 'off' ? cfParam : 'auto';
		const cfEvery = num(p, 'cfEvery', 45);
		const cfHold = Math.min(cfEvery - 1, num(p, 'cfHold', 12));
		const shift = Math.max(0, Math.min(1, num(p, 'shift', 0.5)));
		shiftPct = Math.round(shift * 100);

		// stepped-line styling
		const linePitch = Math.max(3, num(p, 'lp', 6)); // dot pitch (matches context texture)
		const drawDur = num(p, 'draw', 2.4); // seconds a line takes to animate in
		const dotAlpha = num(p, 'dalpha', 0.95);
		const skeletonHue = 0.4; // clean teal for the metro spine

		const fieldParams = {
			...DEFAULT_FIELD_PARAMS,
			noiseScale: num(p, 'noise', DEFAULT_FIELD_PARAMS.noiseScale),
			noiseStrength: numAny(p, 'nstr', DEFAULT_FIELD_PARAMS.noiseStrength),
			drift: numAny(p, 'drift', DEFAULT_FIELD_PARAMS.drift)
		};
		const renderParams = {
			...DEFAULT_RENDER_PARAMS,
			fadeAlpha: num(p, 'fade', DEFAULT_RENDER_PARAMS.fadeAlpha),
			strokeWidth: num(p, 'sw', DEFAULT_RENDER_PARAMS.strokeWidth),
			strokeAlpha: num(p, 'salpha', DEFAULT_RENDER_PARAMS.strokeAlpha),
			bloom: flag(p, 'bloom', DEFAULT_RENDER_PARAMS.bloom)
		};

		// imperative scene state
		let now = 0;
		let transition = 0;
		let manual: boolean | null = null;
		let curW = 1;
		let curH = 1;
		const seen = new Set<number>();
		let lastId = 0;
		let skeleton: SrcLine[] = [];
		let trips: SrcLine[] = [];
		let linesPx: LinePx[] = [];
		let basemap: Basemap | null = null;

		const field = new FlowFieldModel(fieldParams);
		const particles = new ParticleSystem(DEFAULT_PARTICLE_PARAMS);
		let renderer: FlowRenderer;
		let projector: Projector;

		const cssSize = (): [number, number] => {
			const r = wrap.getBoundingClientRect();
			return [Math.max(1, r.width), Math.max(1, r.height)];
		};

		const dotSize = (bucket: number) => linePitch * (0.85 + (bucket / 4) * 0.5);

		const rebuildLines = () => {
			if (!projector) return;
			const out: LinePx[] = [];
			for (const s of [...skeleton, ...trips]) {
				const pts = s.coords.map((c) => projector.project(c[0], c[1]));
				if (pts.length < 2) continue;
				out.push({
					dots: steppedDots(pts, linePitch),
					pts,
					hueT: s.hueT,
					size: dotSize(s.bucket),
					weight: 1 + s.bucket,
					bornAt: s.bornAt
				});
			}
			linesPx = out;
			particles.setEmitters(out.map((l) => ({ pts: l.pts, weight: l.weight }) satisfies Emitter));
		};

		const layout = () => {
			const [w, h] = cssSize();
			curW = w;
			curH = h;
			projector = makeProjector(BENGALURU_BBOX, w, h);
			renderer.resize(w, h, dpr);
			field.setProjector(projector);
			rebuildLines();
			drawContext(contextCanvas, projector, basemap, dpr, {
				...DEFAULT_CONTEXT_PARAMS,
				pitch: Math.max(4, Math.round(num(p, 'pitch', DEFAULT_CONTEXT_PARAMS.pitch))),
				maxLabels: Math.round(num(p, 'labels', DEFAULT_CONTEXT_PARAMS.maxLabels))
			});
		};

		const autoCount = (w: number, h: number) =>
			Math.max(1500, Math.min(6500, Math.round((3500 * (w * h)) / (1920 * 1080))));

		const ingest = (lines: WireLine[]) => {
			let added = false;
			for (const l of lines) {
				if (seen.has(l.id)) continue;
				seen.add(l.id);
				if (l.id > lastId) lastId = l.id;
				const legs: LegPath[] = lineToLegPaths(l);
				for (const leg of legs) {
					if (leg.path.length < 2) continue;
					trips.push({ coords: leg.path, hueT: bucketHue(leg.bucket), bucket: leg.bucket, bornAt: now });
					added = true;
				}
			}
			if (trips.length > maxTrips) trips = trips.slice(trips.length - maxTrips);
			if (added) rebuildLines();
		};

		const poll = async () => {
			try {
				ingest(await fetchLines(lastId));
			} catch (err) {
				console.warn('FlowField lines poll failed:', err);
			}
		};

		const pollField = async () => {
			try {
				const snap = await fetchEmissions(shift);
				field.setEmissions(snap.raw, snap.cf, now);
				stats = snap.stats;
				savedPct = snap.savedPct;
			} catch (err) {
				console.warn('FlowField field poll failed:', err);
			}
		};

		const cfWanted = (): boolean => {
			if (manual !== null) return manual;
			if (cfMode === 'on') return true;
			if (cfMode === 'off') return false;
			return now % cfEvery > cfEvery - cfHold;
		};

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'c' || e.key === 'C') manual = manual === true ? false : true;
			else if (e.key === 'a' || e.key === 'A') manual = null;
		};

		const loadSkeleton = async () => {
			try {
				const res = await fetch('/bmrcl.geojson');
				const gj = (await res.json()) as {
					features: { geometry: { type: string; coordinates: number[][] | number[][][] } }[];
				};
				const lines: SrcLine[] = [];
				for (const f of gj.features) {
					const g = f.geometry;
					const segs = g.type === 'MultiLineString' ? (g.coordinates as number[][][]) : [g.coordinates as number[][]];
					for (const seg of segs) {
						const coords = seg.map((c) => [c[0], c[1]] as [number, number]);
						if (coords.length >= 2) lines.push({ coords, hueT: skeletonHue, bucket: 0, bornAt: 0 });
					}
				}
				skeleton = lines;
				rebuildLines();
			} catch (err) {
				console.warn('FlowField skeleton load failed:', err);
			}
		};

		(async () => {
			const [w, h] = cssSize();
			particles.resize(p.get('count') ? Math.round(num(p, 'count', autoCount(w, h))) : autoCount(w, h));
			particles.params.speed = num(p, 'speed', DEFAULT_PARTICLE_PARAMS.speed);
			renderer = new FlowRenderer(flowCanvas, renderParams);

			basemap = await loadBasemap();
			if (disposed) return;
			layout();
			await loadSkeleton();

			const lineRgb: RGB = [0, 0, 0];
			const puffRgb: RGB = [0, 0, 0];
			clock = createClock((t, dt) => {
				now = t;
				const target = cfWanted() ? 1 : 0;
				transition += (target - transition) * (1 - Math.exp(-dt / 0.6));
				if (Math.abs(transition - target) < 0.004) transition = target;
				if (Math.abs(cfStrength - transition) > 0.01) cfStrength = transition;

				renderer.setTransition(transition);
				field.setFrame(t, transition);
				renderer.fade();

				// pollution clouds from the emissions field (additive glow, drawn under)
				renderer.beginStrokes();
				particles.step(field, dt, curW, curH, (x0, y0, x1, y1, hueT, ageFrac) => {
					renderer.hueColor(hueT, 0, puffRgb);
					renderer.stroke(x0, y0, x1, y1, puffRgb, renderParams.strokeAlpha * strokeFade(ageFrac), renderParams.strokeWidth);
				});

				// stepped route lines, animated being drawn, crisp on top
				renderer.beginLines();
				for (const l of linesPx) {
					renderer.hueColor(l.hueT, 0, lineRgb);
					const reveal = drawDur > 0 ? Math.min(1, (t - l.bornAt) / drawDur) : 1;
					const n = Math.ceil(reveal * l.dots.length);
					for (let i = 0; i < n; i++) renderer.dot(l.dots[i][0], l.dots[i][1], lineRgb, dotAlpha, l.size);
				}

				renderer.endStrokes();
			});

			window.addEventListener('keydown', onKey);
			ro = new ResizeObserver(() => !disposed && layout());
			ro.observe(wrap);

			clock.start();
			void poll();
			void pollField();
			pollTimer = setInterval(() => void poll(), pollMs);
			fieldTimer = setInterval(() => void pollField(), Math.round(pollMs * 1.5));
		})();

		return () => {
			disposed = true;
			window.removeEventListener('keydown', onKey);
			ro?.disconnect();
			clock?.stop();
			if (pollTimer) clearInterval(pollTimer);
			if (fieldTimer) clearInterval(fieldTimer);
		};
	});
</script>

<div class="wrap" bind:this={wrap}>
	<canvas bind:this={flowCanvas} class="layer flow"></canvas>
	<canvas bind:this={contextCanvas} class="layer context"></canvas>
	{#if stats && stats.count > 0}
		<Hud {stats} {savedPct} {shiftPct} />
	{:else if stats}
		<EmptyState />
	{/if}
	<CounterfactualBanner strength={cfStrength} {shiftPct} {savedPct} />
</div>

<style>
	.wrap {
		position: absolute;
		inset: 0;
		background: #04060c;
		overflow: hidden;
	}
	.layer {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
	.flow {
		z-index: 0;
	}
	.context {
		z-index: 1;
		pointer-events: none;
	}
</style>
