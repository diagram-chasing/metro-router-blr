<script lang="ts">
	import { onMount } from 'svelte';

	import maplibre from 'maplibre-gl';
	import 'maplibre-gl/dist/maplibre-gl.css';

	import { createClock, type Clock } from '$lib/viz/clock';
	import { loadDeck, type Deck } from '$lib/viz/deck';
	import { EmissionsField, type Field } from '$lib/viz/emissionsField';
	import {
		buildArrivalLayer,
		buildEmissionsLayer,
		buildTripsLayer,
		PULSE_LIFE,
		type Pulse
	} from '$lib/viz/layers';
	import { darkStyle, WALL_BG } from '$lib/viz/palette';
	import { lineToLegPaths, type LegPath, type WireLine } from '$lib/viz/tripsData';
	import CounterfactualBanner from '$lib/components/wall/CounterfactualBanner.svelte';
	import EmptyState from '$lib/components/wall/EmptyState.svelte';
	import Hud from '$lib/components/wall/Hud.svelte';

	type Stats = { count: number; avgCo2PerTripKg: number; avgCo2PerKmG: number };

	let { variant = 'home' }: { variant?: 'home' | 'wall' } = $props();

	// Reactive bits the overlay UI reads (everything else is imperative for perf).
	let cfStrength = $state(0); // eased counterfactual 0→1, throttled for the banner
	let shiftPct = $state(50);
	let stats = $state<Stats | null>(null);
	let savedPct = $state<number | null>(null);

	let mapContainer: HTMLDivElement;
	let map: maplibre.Map | undefined;
	let overlay: InstanceType<Deck['MapboxOverlay']> | undefined;

	const BENGALURU = { lng: 77.5946, lat: 12.9716, zoom: 11 };

	const num = (p: URLSearchParams, k: string, d: number) => {
		const v = Number(p.get(k));
		return isFinite(v) && v > 0 ? v : d;
	};

	onMount(() => {
		let disposed = false;
		let clock: Clock | undefined;
		let pollTimer: ReturnType<typeof setInterval> | undefined;
		let fieldTimer: ReturnType<typeof setInterval> | undefined;

		// Scene state owned imperatively (not reactive — deck reads it each frame).
		let legPaths: LegPath[] = [];
		let pulses: Pulse[] = [];
		const seen = new Set<number>();
		let lastId = 0;
		let now = 0;

		const field = new EmissionsField();
		let transition = 0; // 0 = actual emissions, 1 = counterfactual

		// Counterfactual control: auto-cycle by default; `c` toggles a manual
		// override, `a` resumes auto.
		let cfMode: 'auto' | 'on' | 'off' = 'auto';
		let cfEvery = 45; // s — cycle period
		let cfHold = 12; // s — seconds of each cycle the counterfactual is shown
		let shift = 0.5;
		let manual: boolean | null = null;

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'c' || e.key === 'C') manual = manual === true ? false : true;
			else if (e.key === 'a' || e.key === 'A') manual = null;
		};

		(async () => {
			const p = new URLSearchParams(window.location.search);
			const bg = p.get('bg') ?? WALL_BG;
			const zoom = num(p, 'zoom', variant === 'wall' ? 12.2 : 11);
			const pollMs = Math.max(1500, num(p, 'poll', 4000));
			const dpr = num(p, 'dpr', Math.min(2, window.devicePixelRatio || 1));
			// Cap live trails so a multi-day exhibit stays bounded; older trips remain
			// represented in the accumulating emissions field. ~4 legs per trip.
			const maxLegs = Math.max(400, Math.round(num(p, 'maxTrips', 4000) * 4));
			const cfParam = p.get('cf');
			cfMode = cfParam === 'on' || cfParam === 'off' ? cfParam : 'auto';
			cfEvery = num(p, 'cfEvery', 45);
			cfHold = Math.min(cfEvery - 1, num(p, 'cfHold', 12));
			shift = Math.max(0, Math.min(1, num(p, 'shift', 0.5)));
			shiftPct = Math.round(shift * 100);

			const deck = await loadDeck();
			if (disposed) return;

			map = new maplibre.Map({
				container: mapContainer,
				style: darkStyle(bg),
				center: [BENGALURU.lng, BENGALURU.lat],
				zoom,
				pixelRatio: dpr,
				interactive: false,
				attributionControl: false
			});

			await new Promise<void>((resolve) => map!.on('load', () => resolve()));
			if (disposed) return;

			overlay = new deck.MapboxOverlay({ interleaved: true, layers: [] });
			map.addControl(overlay as unknown as maplibre.IControl);

			const ingest = (lines: WireLine[]) => {
				const fresh: LegPath[] = [];
				for (const l of lines) {
					if (seen.has(l.id)) continue;
					seen.add(l.id);
					if (l.id > lastId) lastId = l.id;
					const legs = lineToLegPaths(l);
					if (!legs.length) continue;
					fresh.push(...legs);
					pulses.push({ lng: legs[0].origin[0], lat: legs[0].origin[1], bornAt: now });
				}
				// New reference so deck regenerates the trips buffer (cheap; rare).
				if (fresh.length) {
					const next = [...legPaths, ...fresh];
					legPaths = next.length > maxLegs ? next.slice(next.length - maxLegs) : next;
				}
			};

			const poll = async () => {
				try {
					const res = await fetch(`/api/lines?sinceId=${lastId}`);
					const { lines } = (await res.json()) as { lines: WireLine[] };
					ingest(lines);
				} catch (err) {
					console.warn('FlowMap lines poll failed:', err);
				}
			};

			// The emissions cloud polls on its own (slower) cadence — both the actual
			// (raw) and counterfactual (cf) grids. cf is rescaled to raw's peak so the
			// toggle reads as a genuine reduction, not a re-normalised look-alike.
			const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

			const pollField = async () => {
				try {
					const [rawRes, cfRes, statsRes] = await Promise.all([
						fetch('/api/emissions?grid=raw&decay=1.2'),
						fetch(`/api/emissions?grid=cf&shift=${shift}&decay=1.2`),
						fetch('/api/stats')
					]);
					const raw = (await rawRes.json()) as Field;
					const cf = (await cfRes.json()) as Field;
					const scale = raw.rawMax > 0 ? cf.rawMax / raw.rawMax : 1;
					const cfScaled: Field = { ...cf, values: cf.values.map((v) => v * scale) };
					field.setSnapshot(raw, cfScaled, now);

					// Total deposit (normalised value × peak) is a proxy for the whole-
					// city burden; the raw→cf drop is the headline saving.
					const rawTotal = sum(raw.values) * raw.rawMax;
					const cfTotal = sum(cf.values) * cf.rawMax;
					savedPct = rawTotal > 0 ? Math.round((1 - cfTotal / rawTotal) * 100) : null;

					stats = (await statsRes.json()) as Stats;
				} catch (err) {
					console.warn('FlowMap field poll failed:', err);
				}
			};

			const cfWanted = (): boolean => {
				if (manual !== null) return manual;
				if (cfMode === 'on') return true;
				if (cfMode === 'off') return false;
				return now % cfEvery > cfEvery - cfHold;
			};

			clock = createClock((t, dt) => {
				now = t;
				if (pulses.length) pulses = pulses.filter((p) => t - p.bornAt < PULSE_LIFE);

				// Smoothly chase the counterfactual target (~2.5 s settle).
				const target = cfWanted() ? 1 : 0;
				transition += (target - transition) * (1 - Math.exp(-dt / 0.6));
				if (Math.abs(transition - target) < 0.004) transition = target;
				if (Math.abs(cfStrength - transition) > 0.01) cfStrength = transition;

				const img = field.ready ? field.image(t, transition) : null;
				const cloud = img ? [buildEmissionsLayer(deck, img, field.bounds)] : [];
				overlay?.setProps({
					layers: [
						...cloud,
						buildTripsLayer(deck, legPaths, t, transition),
						buildArrivalLayer(deck, pulses, t)
					]
				});
			});

			window.addEventListener('keydown', onKey);

			await Promise.all([poll(), pollField()]);
			clock.start();
			pollTimer = setInterval(() => void poll(), pollMs);
			fieldTimer = setInterval(() => void pollField(), Math.round(pollMs * 1.5));
		})();

		return () => {
			disposed = true;
			window.removeEventListener('keydown', onKey);
			clock?.stop();
			if (pollTimer) clearInterval(pollTimer);
			if (fieldTimer) clearInterval(fieldTimer);
			overlay?.finalize?.();
			map?.remove();
		};
	});
</script>

<div class="wrap" class:wall={variant === 'wall'}>
	<div bind:this={mapContainer} class="map"></div>
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
	}
	.map {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
	}
	:global(.maplibregl-ctrl-logo),
	:global(.maplibregl-ctrl-attrib-button) {
		display: none !important;
	}
</style>
