<script lang="ts">
	import auto from '$lib/assets/vehicles/auto.png';
	import bus from '$lib/assets/vehicles/bus.png';
	import walk from '$lib/assets/vehicles/man_walk2.png';
	import metro from '$lib/assets/vehicles/metro.png';
	import roundedRed from '$lib/assets/vehicles/rounded_red.png';
	import scooter from '$lib/assets/vehicles/scooter.png';
	import sedan from '$lib/assets/vehicles/sedan.png';

	import type { JourneyType } from './types';

	let { mode }: { mode: JourneyType } = $props();

	// One sprite per journey, or two joined by "+" for a multimodal trip: the metro
	// options carry a real first/last-mile access leg (auto or walk) to the station.
	const SPRITES: Record<JourneyType, string[]> = {
		two_wheeler: [scooter],
		car: [sedan],
		car_ev: [roundedRed],
		bus: [bus],
		metro_auto: [metro, auto],
		metro_walk: [metro, walk]
	};

	const sprites = $derived(SPRITES[mode] ?? []);
</script>

<!-- 4-way zero-blur black shadows trace the sprite alpha as a crisp XP outline;
     the last soft offset shadow is the XP down-right depth drop. -->
<span
	class="flex h-full w-full items-center justify-center gap-[0.4em] [filter:drop-shadow(1px_0_0_#000)_drop-shadow(-1px_0_0_#000)_drop-shadow(0_1px_0_#000)_drop-shadow(0_-1px_0_#000)_drop-shadow(1px_1px_1px_rgba(0,0,0,0.45))]"
>
	{#each sprites as src, i (i)}
		{#if i > 0}
			<span class="text-[0.85em] font-bold leading-none opacity-60" aria-hidden="true">+</span>
		{/if}
		<img {src} alt="" class="h-full max-h-[3vh] w-auto min-w-0 shrink object-contain" />
	{/each}
</span>
