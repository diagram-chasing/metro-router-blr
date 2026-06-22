<script lang="ts">
	// The grey accumulation map: every finished visit drops a grey route here. This
	// rendered page is the visual input TouchDesigner captures and recolours by AQI
	// / emissions. Layers are controlled by URL params so TD can pull each as a
	// separate source:
	//   ?basemap=0|1  ?lines=0|1  ?recent=0|1  ?stations=0|1  ?hud=0|1
	//   ?bg=<css color>  ?poll=<ms>
	// (Moved off `/`, which is now the full-colour FlowMap wall piece.)
	import AccumulationMap from '$lib/components/AccumulationMap.svelte';
</script>

<main class="absolute inset-0">
	<AccumulationMap />
</main>
