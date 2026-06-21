<script lang="ts">
	// Accumulation map: every finished visit drops a grey route here, building up
	// over the day. Each layer is controlled by a URL param so the map can be
	// rendered (or captured) one layer at a time:
	//   ?basemap=0|1  ?lines=0|1  ?recent=0|1  ?stations=0|1  ?hud=0|1
	//   ?bg=<css color>  ?poll=<ms>
	import AccumulationMap from '$lib/components/AccumulationMap.svelte';
</script>

<main class="absolute inset-0">
	<AccumulationMap />
</main>
