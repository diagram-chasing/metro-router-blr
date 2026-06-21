<script lang="ts">
	// The route as it was actually drawn — a "route signature", not a basemap.
	//
	// Geometry is the per-leg [lng,lat] polyline the visitor traced at Q3. We use a
	// d3 Mercator projection with fitExtent() so any route — a 1 km hop or a 30 km
	// cross-city haul — lands centered and uniformly scaled inside the same box,
	// shape preserved. Emission intensity is encoded in PRINT, not colour: a clean
	// leg prints as a faint dotted hairline, a dirty leg as a heavy solid stroke.
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

	// Intensity is encoded by PRINT STYLE, not colour (thresholds track the emissions
	// table: walk 0 / bus 18 / metro 40 / auto 74 / car 120 / cab 172). A clean leg is
	// a faint dotted hairline (....); a dirty leg is a DOUBLE line (====) — two thin
	// parallel rules with a white gap, so it reads heavy without flooding the head.
	function legStyle(gPerKm: number): { double: boolean; width: number; dash: string } {
		if (gPerKm < 50) return { double: false, width: 1.8, dash: '1 5' }; // walk/metro/bus — dotted
		return { double: true, width: gPerKm < 100 ? 8 : 10, dash: 'none' }; // auto/car/cab — double line
	}

	// White carve width for a double leg: leaves ~2px black rails with a clear gap.
	const carveWidth = (w: number) => w - 4;
</script>

<svg viewBox="0 0 {width} {height}" {width} class="block w-full" role="img" aria-label="your route">
	{#if path && ends}
		<!-- outer black stroke for every leg -->
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
		<!-- carve the centre of dirty legs with white, leaving a double line (====) -->
		{#each legs as leg, i (i)}
			{@const s = legStyle(leg.gPerKm)}
			{#if s.double}
				<path
					d={path(features[i]) ?? ''}
					fill="none"
					stroke="#fff"
					stroke-width={carveWidth(s.width)}
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			{/if}
		{/each}
		<!-- origin (hollow) -> destination (filled) -->
		<circle cx={ends.a[0]} cy={ends.a[1]} r="4" fill="#fff" stroke="#000" stroke-width="2" />
		<circle cx={ends.b[0]} cy={ends.b[1]} r="4" fill="#000" stroke="#000" stroke-width="2" />
	{/if}
</svg>
