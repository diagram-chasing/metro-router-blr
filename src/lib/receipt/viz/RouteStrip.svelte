<script lang="ts">
	// The route as a strip, not a map: origin -> destination with km ticks, drawn in
	// plain ASCII so it reads as part of the printed ledger. Used as the fallback when
	// no traced geometry exists. 'o' is the origin, '*' the destination, '+' the ticks.
	let { distanceKm }: { distanceKm: number } = $props();

	const W = 40; // track width in characters

	const line = $derived.by(() => {
		const arr: string[] = Array(W + 1).fill('-');
		arr[0] = 'o';
		arr[W] = '*';
		const ticks = Math.min(6, Math.max(2, Math.round(distanceKm / 2.5)));
		for (let k = 1; k < ticks; k++) {
			const pos = Math.round((k / ticks) * W);
			if (pos > 0 && pos < W) arr[pos] = '+';
		}
		return arr.join('');
	});
</script>

<div class="font-mono text-r-sm" role="img" aria-label="route, {distanceKm} km">
	<div class="overflow-hidden whitespace-pre">{line}</div>
	<div class="mt-0.5 flex justify-between text-r-2xs uppercase tracking-label">
		<span>origin</span>
		<span>{distanceKm.toFixed(1)} km</span>
		<span>dest</span>
	</div>
</div>
