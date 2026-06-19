<script lang="ts">
	// A real, scannable QR (error-correction M) drawn as a crisp module grid so it
	// survives the 203-dpi thermal raster. Two-module quiet zone is baked into the
	// viewBox per the QR spec, otherwise scanners choke.
	import qrcode from 'qrcode-generator';

	let { data, size = 132 }: { data: string; size?: number } = $props();

	const grid = $derived.by(() => {
		const qr = qrcode(0, 'M');
		qr.addData(data);
		qr.make();
		const n = qr.getModuleCount();
		const cells: { x: number; y: number }[] = [];
		for (let r = 0; r < n; r++) {
			for (let c = 0; c < n; c++) {
				if (qr.isDark(r, c)) cells.push({ x: c, y: r });
			}
		}
		return { n, cells };
	});

	const QUIET = 2;
</script>

<svg
	width={size}
	height={size}
	viewBox="{-QUIET} {-QUIET} {grid.n + QUIET * 2} {grid.n + QUIET * 2}"
	class="block"
	role="img"
	aria-label="scan to open this receipt"
	shape-rendering="crispEdges"
>
	{#each grid.cells as c (c.y * grid.n + c.x)}
		<rect x={c.x} y={c.y} width="1.02" height="1.02" class="fill-ink" />
	{/each}
</svg>
