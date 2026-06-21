<script lang="ts">
	// Per-leg [lng,lat] polylines (Q3), projected with a d3 Mercator fitExtent so any
	// route — short hop or cross-city haul — lands centred at the same scale, shape kept.
	// Intensity is encoded by line WEIGHT, not colour: every leg is the same dotted
	// hairline; a dirtier leg gets fatter, bolder dots so it pops without flooding the head.
	import { geoMercator, geoPath } from 'd3-geo';
	import type { Feature, LineString } from 'geojson';

	type Leg = { coords: [number, number][]; gPerKm: number };
	let { segments, width = 540, height = 150 }: { segments: Leg[]; width?: number; height?: number } =
		$props();

	const PAD = 14;

	// Legs with real geometry, in draw order.
	const legs = $derived(segments.filter((s) => s.coords && s.coords.length >= 2));

	const features = $derived(
		legs.map(
			(l): Feature<LineString> => ({
				type: 'Feature',
				geometry: { type: 'LineString', coordinates: l.coords },
				properties: {}
			})
		)
	);

	const projection = $derived.by(() => {
		if (!features.length) return null;
		const collection = { type: 'FeatureCollection' as const, features };
		return geoMercator().fitExtent(
			[
				[PAD, PAD],
				[width - PAD, height - PAD]
			],
			collection
		);
	});

	const path = $derived(projection ? geoPath(projection) : null);

	// Endpoints: first point of the first leg, last point of the last leg.
	const ends = $derived.by(() => {
		if (!projection || !legs.length) return null;
		const first = legs[0].coords[0];
		const lastLeg = legs[legs.length - 1].coords;
		const last = lastLeg[lastLeg.length - 1];
		const a = projection(first);
		const b = projection(last);
		return a && b ? { a, b } : null;
	});

	// Dotted everywhere; weight ramps gently with g/km so dirtier legs read heavier
	// without becoming fat circles. Scale tracks the emissions table (walk 0 / bus 18 /
	// metro 40 / auto 74 / car 120 / cab 172). Keep dots small (max ~3px) and the gap
	// tight (~1.6x the dot) so every leg reads as a dotted LINE, just bolder when dirty.
	function legStyle(gPerKm: number): { width: number; dash: string } {
		const t = Math.min(Math.max(gPerKm, 0) / 170, 1); // 0 clean .. 1 dirtiest
		const width = 1.4 + t * 1.6; // 1.4 .. 3
		return { width, dash: `0.1 ${(width * 1.6).toFixed(1)}` };
	}
</script>

<svg viewBox="0 0 {width} {height}" {width} class="block w-full" role="img" aria-label="your route">
	{#if path && ends}
		<!-- dotted stroke for every leg; weight ∝ emissions -->
		{#each legs as leg, i (i)}
			{@const s = legStyle(leg.gPerKm)}
			<path
				d={path(features[i]) ?? ''}
				fill="none"
				stroke="#000"
				stroke-width={s.width}
				stroke-dasharray={s.dash}
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		{/each}
		<!-- origin (hollow) -> destination (filled) -->
		<circle cx={ends.a[0]} cy={ends.a[1]} r="4" fill="#fff" stroke="#000" stroke-width="2" />
		<circle cx={ends.b[0]} cy={ends.b[1]} r="4" fill="#000" stroke="#000" stroke-width="2" />
	{/if}
</svg>
