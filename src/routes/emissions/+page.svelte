<script lang="ts">
	// Accumulating CO₂e emissions raster — a companion to the line map at `/`.
	// Brightness = where the room's real travel choices load the air. Each layer is
	// picked via URL params so it can be rendered one at a time:
	//   ?grid=raw|diff     raw annual burden vs excess over a metro-clean choice
	//   ?decay=<km>        kernel spread (default 1.2)
	//   ?gamma=<n>         display contrast (default 1)
	//   ?invert=0|1        flip brightness (default bright = dirtier)
	//   ?smooth=0|1        bilinear upscale (default on)
	//   ?bg=<css>  ?poll=<ms>
	import EmissionsRaster from '$lib/components/EmissionsRaster.svelte';
</script>

<main class="absolute inset-0">
	<EmissionsRaster />
</main>
