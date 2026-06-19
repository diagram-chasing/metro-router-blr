<script lang="ts">
	// Faint metro outline shared by every panel — the two BMRCL LineStrings from
	// static/bmrcl.geojson, drawn through the panel's projector. Renders an SVG
	// <g> meant to sit inside the parent panel's <svg>.
	import { onMount } from 'svelte';
	import { isLight, type Projector } from './project';

	let { projector, bg }: { projector: Projector; bg: string } = $props();

	type Line = { coordinates: [number, number][] };
	let lines = $state<Line[]>([]);

	onMount(async () => {
		try {
			const res = await fetch('/bmrcl.geojson');
			const gj = (await res.json()) as {
				features: { geometry: { type: string; coordinates: [number, number][] } }[];
			};
			lines = gj.features
				.filter((f) => f.geometry.type === 'LineString')
				.map((f) => ({ coordinates: f.geometry.coordinates }));
		} catch (err) {
			console.warn('MetroBase: failed to load bmrcl.geojson', err);
		}
	});

	const stroke = $derived(isLight(bg) ? '#000000' : '#ffffff');
	const width = $derived(Math.max(1.5, projector.size / 430));
	const points = (coords: [number, number][]) =>
		coords.map(([lng, lat]) => projector.project(lng, lat).join(',')).join(' ');
</script>

<g opacity="0.16">
	{#each lines as line, i (i)}
		<polyline
			points={points(line.coordinates)}
			fill="none"
			{stroke}
			stroke-width={width}
			stroke-linejoin="round"
			stroke-linecap="round"
		/>
	{/each}
</g>
