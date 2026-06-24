<script lang="ts">
	// The wall projection: a 500 m health choropleth of the city's commute emissions,
	// with per-neighbourhood "months of life" numbers and a submit animation.
	import CollectiveMap from '$lib/components/CollectiveMap.svelte';
</script>

<main class="absolute inset-0">
	<CollectiveMap variant="wall" />
</main>
