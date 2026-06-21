<script lang="ts">
	import { onDestroy, onMount } from 'svelte';

	// Accumulating CO₂e emissions field, drawn as a grayscale raster.
	// The grid comes from /api/emissions; brightness = normalised value.
	// Params (read once on mount):
	//   ?grid=raw|diff  ?decay=<km>  ?gamma=<n>  ?invert=0|1  ?smooth=0|1
	//   ?bg=<css>  ?poll=<ms>
	type FieldResp = {
		nLat: number;
		nLon: number;
		values: number[];
		rawMax: number;
	};

	let canvas: HTMLCanvasElement;
	let pollTimer: ReturnType<typeof setInterval> | undefined;
	let field: FieldResp | null = null;

	let grid = 'raw';
	let decay = 1.2;
	let gamma = 1;
	let invert = false;
	let smooth = true;
	let bg = '#000000';
	let pollMs = 4000;

	const flag = (p: URLSearchParams, k: string, d: boolean) => {
		const v = p.get(k);
		return v === null ? d : v === '1' || v === 'true';
	};

	function apiUrl(): string {
		const q = new URLSearchParams({ grid, decay: String(decay) });
		return `/api/emissions?${q}`;
	}

	function draw() {
		if (!canvas || !field) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const w = canvas.width;
		const h = canvas.height;

		ctx.fillStyle = bg;
		ctx.fillRect(0, 0, w, h);

		// Render the grid into an offscreen canvas at native cell resolution, then
		// scale it up to fill the viewport (smoothed or pixelated per ?smooth).
		const { nLat, nLon, values } = field;
		const off = document.createElement('canvas');
		off.width = nLon;
		off.height = nLat;
		const offCtx = off.getContext('2d');
		if (!offCtx) return;
		const img = offCtx.createImageData(nLon, nLat);
		for (let i = 0; i < nLat; i++) {
			for (let j = 0; j < nLon; j++) {
				const v = values[i * nLon + j] ?? 0;
				let b = Math.pow(Math.max(0, Math.min(1, v)), gamma);
				if (invert) b = 1 - b;
				const g = Math.round(b * 255);
				// Flip vertically so north (max latitude) is at the top.
				const px = ((nLat - 1 - i) * nLon + j) * 4;
				img.data[px] = g;
				img.data[px + 1] = g;
				img.data[px + 2] = g;
				img.data[px + 3] = 255;
			}
		}
		offCtx.putImageData(img, 0, 0);

		ctx.imageSmoothingEnabled = smooth;
		ctx.drawImage(off, 0, 0, nLon, nLat, 0, 0, w, h);
	}

	function resize() {
		if (!canvas) return;
		canvas.width = canvas.clientWidth;
		canvas.height = canvas.clientHeight;
		draw();
	}

	async function refresh() {
		try {
			const res = await fetch(apiUrl());
			field = (await res.json()) as FieldResp;
			draw();
		} catch (err) {
			console.warn('emissions raster refresh failed:', err);
		}
	}

	onMount(() => {
		const p = new URLSearchParams(window.location.search);
		grid = p.get('grid') === 'diff' ? 'diff' : 'raw';
		const d = Number(p.get('decay'));
		decay = isFinite(d) && d > 0 ? d : 1.2;
		const g = Number(p.get('gamma'));
		gamma = isFinite(g) && g > 0 ? g : 1;
		invert = flag(p, 'invert', false);
		smooth = flag(p, 'smooth', true);
		bg = p.get('bg') ?? '#000000';
		pollMs = Math.max(1000, Number(p.get('poll') ?? 4000) || 4000);

		resize();
		window.addEventListener('resize', resize);
		void refresh();
		pollTimer = setInterval(() => void refresh(), pollMs);

		return () => {
			window.removeEventListener('resize', resize);
			if (pollTimer) clearInterval(pollTimer);
		};
	});

	onDestroy(() => {
		if (pollTimer) clearInterval(pollTimer);
	});
</script>

<canvas bind:this={canvas} class="raster"></canvas>

<style>
	.raster {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
