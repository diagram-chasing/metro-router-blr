<script lang="ts">
	// PANEL — "Grading a route".
	// How a route earns its shade: each leg is costed at its mode's CO2 per
	// passenger-km (emissions.ts), the legs are length-weighted into one blended
	// intensity (grey.ts blendedCo2PerKm), and that lands in one of five buckets
	// (BUCKET_MAX = 15·45·80·130 g/pkm). We draw a representative auto→metro→auto
	// trip with each leg in its own bucket's shade, plus the scale it maps onto.
	import { onMount } from 'svelte';
	import { MODE_CO2E_G_PER_PKM } from '$lib/exhibit/emissions';
	import { blendedCo2PerKm, greyBucket, legKindToMode } from '$lib/exhibit/grey';
	import type { LegKind } from '$lib/exhibit/routeCandidates';
	import { VIEW_BBOX, isLight, makeProjector, shadesFor } from './project';
	import MetroBase from './MetroBase.svelte';

	let { size = 1400, bg = '#ffffff' }: { size?: number; bg?: string } = $props();

	const margin = $derived(size * 0.05);
	// Leave a band at the bottom for the grade scale.
	const mapSize = $derived(size * 0.74);
	const projector = $derived(makeProjector(VIEW_BBOX, mapSize, margin));
	const shades = $derived(shadesFor(bg));
	const ink = $derived(isLight(bg) ? '#111111' : '#f0f0f0');

	type Seg = { coords: [number, number][]; legKind: LegKind };
	let segments = $state<Seg[]>([]);

	// Prefer the most multimodal real route (most distinct leg kinds, then most
	// segments) so the per-leg grading actually shows — it overlays the metro
	// line exactly. Otherwise synthesize a metro leg from the actual line
	// geometry + short auto access.
	const variety = (segs: Seg[]) => new Set(segs.map((s) => s.legKind)).size;
	onMount(async () => {
		try {
			const res = await fetch('/api/lines');
			const all = ((await res.json()) as { lines: { segments: Seg[] }[] }).lines;
			const best = all
				.filter((l) => l.segments?.length)
				.sort(
					(a, b) => variety(b.segments) - variety(a.segments) || b.segments.length - a.segments.length
				)[0];
			if (best?.segments?.length) {
				segments = best.segments;
				return;
			}
		} catch {
			/* fall through to synthetic */
		}
		try {
			const gj = (await (await fetch('/bmrcl.geojson')).json()) as {
				features: { properties: { colour?: string }; geometry: { coordinates: [number, number][] } }[];
			};
			const purple = gj.features.find((f) => f.properties.colour === 'purple');
			const co = purple?.geometry.coordinates ?? [];
			const metro = co.slice(Math.floor(co.length * 0.45), Math.floor(co.length * 0.62));
			if (metro.length < 2) return;
			const a = metro[0];
			const b = metro[metro.length - 1];
			segments = [
				{ legKind: 'auto', coords: [[a[0] + 0.014, a[1] - 0.012], a] },
				{ legKind: 'metro', coords: metro },
				{ legKind: 'auto', coords: [b, [b[0] - 0.013, b[1] + 0.011]] }
			];
		} catch (err) {
			console.warn('PanelGrade: route load failed', err);
		}
	});

	const points = (coords: [number, number][]) =>
		coords.map(([lng, lat]) => projector.project(lng, lat).join(',')).join(' ');
	const legBucket = (k: LegKind) => greyBucket(MODE_CO2E_G_PER_PKM[legKindToMode(k)]);
	const shadeFor = (k: LegKind) => shades[Math.max(0, Math.min(shades.length - 1, legBucket(k)))];

	const blended = $derived(blendedCo2PerKm(segments));
	const routeBucket = $derived(greyBucket(blended));

	// Five-step scale anchored to the real thresholds.
	const SCALE = [
		{ label: '<15' },
		{ label: '<45' },
		{ label: '<80' },
		{ label: '<130' },
		{ label: '≥130' }
	];
	const sw = $derived(size * 0.13); // swatch size
	const gap = $derived(size * 0.02);
	const scaleW = $derived(SCALE.length * sw + (SCALE.length - 1) * gap);
	const scaleX0 = $derived((size - scaleW) / 2);
	const scaleY = $derived(size - margin - sw);
	const width = $derived(Math.max(3, size / 150));
	const casing = $derived(isLight(bg) ? '#ffffff' : '#000000');
</script>

<svg width={size} height={size} viewBox="0 0 {size} {size}" style="background:{bg}">
	<MetroBase {projector} {bg} />

	<!-- the route, each leg in its own grade -->
	<g>
		{#each segments as seg, i (i)}
			{#if seg.coords.length >= 2}
				<polyline
					points={points(seg.coords)}
					fill="none"
					stroke={casing}
					stroke-width={width + Math.max(2, size / 240)}
					stroke-linejoin="round"
					stroke-linecap="round"
					opacity="0.55"
				/>
			{/if}
		{/each}
		{#each segments as seg, i (i)}
			{#if seg.coords.length >= 2}
				<polyline
					points={points(seg.coords)}
					fill="none"
					stroke={shadeFor(seg.legKind)}
					stroke-width={width}
					stroke-linejoin="round"
					stroke-linecap="round"
				/>
			{/if}
		{/each}
	</g>

	<!-- grade scale -->
	<g
		font-family="'IBM Plex Mono', ui-monospace, monospace"
		font-size={size * 0.024}
		fill={ink}
		text-anchor="middle"
	>
		{#each SCALE as step, i (i)}
			{@const x = scaleX0 + i * (sw + gap)}
			<rect x={x} y={scaleY} width={sw} height={sw} fill={shades[i]} />
			{#if i === routeBucket}
				<rect
					x={x}
					y={scaleY}
					width={sw}
					height={sw}
					fill="none"
					stroke={ink}
					stroke-width={Math.max(2, size / 360)}
				/>
				<polygon
					points="{x + sw / 2},{scaleY - size * 0.012} {x + sw / 2 - size * 0.014},{scaleY - size * 0.04} {x + sw / 2 + size * 0.014},{scaleY - size * 0.04}"
					fill={ink}
				/>
			{/if}
			<text x={x + sw / 2} y={scaleY + sw + size * 0.035}>{step.label}</text>
		{/each}
	</g>
</svg>
