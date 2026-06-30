<script lang="ts">
	// The "can you do better / what if" comparison as a slopegraph: an ordered set of
	// labelled annual-kg points joined by a single line. A downward slope (to the right)
	// reads "cleaner"; an upward one "heavier the way you drew it". Drawn in pure black on
	// white so it survives the 1-bit print threshold (lum<128) when ReceiptDoc rasterizes
	// it — same capture path as the route map and the Chladni stamp.
	import { scaleLinear, scalePoint } from 'd3-scale';
	import { line as d3line } from 'd3-shape';

	type Pt = { label: string; value: number };
	let {
		points,
		width = 576,
		height = 210,
		unit = 'kg/yr'
	}: { points: Pt[]; width?: number; height?: number; unit?: string } = $props();

	const M = { top: 40, right: 150, bottom: 52, left: 150 };
	const innerW = $derived(width - M.left - M.right);
	const innerH = $derived(height - M.top - M.bottom);

	const x = $derived(
		scalePoint<number>()
			.domain(points.map((_, i) => i))
			.range([0, innerW])
			.padding(0)
	);
	const maxV = $derived(Math.max(1, ...points.map((p) => p.value)));
	const y = $derived(scaleLinear().domain([0, maxV * 1.12]).range([innerH, 0]));

	const path = $derived(
		d3line<Pt>()
			.x((_, i) => x(i) ?? 0)
			.y((p) => y(p.value))(points) ?? ''
	);

	// Each end's text block sits OUTSIDE the plot (left block right-aligned, right block
	// left-aligned) so the two never collide and the line between reads as the slope.
	const anchorOf = (i: number) => (i === 0 ? 'end' : i === points.length - 1 ? 'start' : 'middle');
	const dxOf = (i: number) => (i === 0 ? -20 : i === points.length - 1 ? 20 : 0);
</script>

{#if points.length >= 2}
	<svg
		viewBox="0 0 {width} {height}"
		{width}
		role="img"
		aria-label="what-if comparison"
		font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
		fill="#000"
	>
		<g transform="translate({M.left},{M.top})">
			<path
				d={path}
				fill="none"
				stroke="#000"
				stroke-width="4"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			{#each points as p, i (i)}
				{@const px = x(i) ?? 0}
				{@const py = y(p.value)}
				{@const a = anchorOf(i)}
				{@const dx = dxOf(i)}
				<!-- vertex: filled dot with a white halo so the line crossing stays legible -->
				<circle cx={px} cy={py} r="7" fill="#000" />
				<circle cx={px} cy={py} r="7" fill="none" stroke="#fff" stroke-width="2.5" />
				<text x={px + dx} y={py - 10} text-anchor={a} font-size="32" font-weight="800">{p.value}</text>
				<text x={px + dx} y={py + 12} text-anchor={a} font-size="15" font-weight="700">{unit}</text>
				<text x={px + dx} y={py + 34} text-anchor={a} font-size="18" font-weight="700"
					>{p.label.toUpperCase()}</text
				>
			{/each}
		</g>
	</svg>
{/if}
