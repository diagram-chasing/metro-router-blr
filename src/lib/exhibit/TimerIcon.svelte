<script lang="ts">
	import timer100 from '$lib/assets/vehicles/timer_100.png';
	import timer25 from '$lib/assets/vehicles/timer_CW_25.png';
	import timer50 from '$lib/assets/vehicles/timer_CW_50.png';
	import timer75 from '$lib/assets/vehicles/timer_CW_75.png';

	import type { Frequency } from './types';

	let { frequency }: { frequency: Frequency } = $props();

	// A fuller gauge means a more frequent trip: most days fills it, now & then barely.
	const TIMERS: Record<Frequency, string> = {
		daily: timer100,
		few_weekly: timer75,
		weekly: timer50,
		occasional: timer25
	};

	const src = $derived(TIMERS[frequency]);
</script>

<span class="flex h-full w-full items-center justify-center">
	<img
		{src}
		alt=""
		class="h-full max-h-[3vh] w-auto min-w-0 shrink object-contain [filter:brightness(0)]"
	/>
</span>
