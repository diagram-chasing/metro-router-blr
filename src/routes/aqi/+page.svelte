<script lang="ts">
	// Accumulating emissions raster — a second TouchDesigner input alongside the
	// line map at `/`. Brightness = where the room's real travel choices load the
	// air. Layers are picked via URL params so TD can pull each as its own source:
	//   ?metric=pm25|co2   pollutant
	//   ?grid=raw|diff     raw annual burden vs excess over a metro-clean choice
	//   ?base=0|1          overlay the baked observed PM2.5 backdrop (PM2.5 only)
	//   ?decay=<km>        kernel spread (default 1.2)
	//   ?gamma=<n>         display contrast (default 1)
	//   ?invert=0|1        flip brightness (default bright = dirtier)
	//   ?smooth=0|1        bilinear upscale (default on)
	//   ?bg=<css>  ?poll=<ms>
	import AqiRaster from '$lib/components/AqiRaster.svelte';
</script>

<main class="absolute inset-0">
	<AqiRaster />
</main>
