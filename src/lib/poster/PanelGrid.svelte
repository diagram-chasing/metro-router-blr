<script lang="ts">
	// PANEL — "Gridding the AQ field".
	// The output of aqiGrid.ts: every accumulated route is sampled along its
	// polyline, smeared by a decay kernel and stamped into a 0.01° lattice, then
	// normalised. We render that field as a smooth grayscale cloud (bilinear, like
	// the live AqiRaster) rather than hard cells.
	//
	// variant:
	//   'actual'         — emissions as travelled (grid=raw)
	//   'counterfactual' — the same trips by public transport (grid=cf)
	// Both are normalised to the ACTUAL peak so the counterfactual reads visibly
	// lighter — that gap is the avoidable pollution.
	import { onMount } from 'svelte';
	import { BENGALURU_BBOX, VIEW_BBOX, isLight, makeProjector } from './project';
	import MetroBase from './MetroBase.svelte';

	let {
		size = 1400,
		bg = '#ffffff',
		metric = 'pm25',
		variant = 'actual',
		gamma = 0.8
	}: {
		size?: number;
		bg?: string;
		metric?: 'pm25' | 'co2';
		variant?: 'actual' | 'counterfactual';
		gamma?: number;
	} = $props();

	const margin = $derived(size * 0.03);
	const projector = $derived(makeProjector(VIEW_BBOX, size, margin));
	const [lonMin, latMin, lonMax, latMax] = BENGALURU_BBOX;

	type Field = { nLat: number; nLon: number; values: number[]; rawMax: number };
	let canvas = $state<HTMLCanvasElement | null>(null);
	let raw = $state<Field | null>(null);
	let cf = $state<Field | null>(null);

	onMount(async () => {
		try {
			[raw, cf] = await Promise.all([
				fetch(`/api/aqi?metric=${metric}&grid=raw`).then((r) => r.json()),
				fetch(`/api/aqi?metric=${metric}&grid=cf`).then((r) => r.json())
			]);
		} catch (err) {
			console.warn('PanelGrid: /api/aqi failed', err);
		}
	});

	function draw() {
		if (!canvas || !raw || !cf) return;
		const ctx = canvas.getContext('2d');
		if (!ctx) return;
		const light = isLight(bg);
		canvas.width = size;
		canvas.height = size;
		ctx.clearRect(0, 0, size, size);

		const field = variant === 'counterfactual' ? cf : raw;
		const scaleMax = raw.rawMax > 0 ? raw.rawMax : 1;
		const rescale = field.rawMax / scaleMax; // field.values are /field.rawMax → /actual peak
		const { nLat, nLon, values } = field;

		// Native-resolution image (row 0 = north), then smooth-upscale into place.
		const off = document.createElement('canvas');
		off.width = nLon;
		off.height = nLat;
		const octx = off.getContext('2d');
		if (!octx) return;
		const img = octx.createImageData(nLon, nLat);
		for (let r = 0; r < nLat; r++) {
			const i = nLat - 1 - r; // values are lat-ascending; flip so north is on top
			for (let j = 0; j < nLon; j++) {
				const v = (values[i * nLon + j] ?? 0) * rescale;
				const b = Math.pow(Math.max(0, Math.min(1, v)), gamma);
				const g = Math.round((light ? 1 - b : b) * 255); // low value fades to bg
				const px = (r * nLon + j) * 4;
				img.data[px] = img.data[px + 1] = img.data[px + 2] = g;
				img.data[px + 3] = 255;
			}
		}
		octx.putImageData(img, 0, 0);

		const [dx0, dy0] = projector.project(lonMin, latMax);
		const [dx1, dy1] = projector.project(lonMax, latMin);
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';
		ctx.drawImage(off, 0, 0, nLon, nLat, dx0, dy0, dx1 - dx0, dy1 - dy0);
	}

	$effect(() => {
		// redraw when data or any display input changes
		void [raw, cf, variant, bg, size, gamma, canvas];
		draw();
	});
</script>

<div class="panel" style="width:{size}px;height:{size}px;background:{bg}">
	<canvas bind:this={canvas} class="field"></canvas>
	<svg width={size} height={size} viewBox="0 0 {size} {size}" class="overlay">
		<MetroBase {projector} {bg} />
	</svg>
</div>

<style>
	.panel {
		position: relative;
		overflow: hidden;
	}
	.field,
	.overlay {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		display: block;
	}
</style>
