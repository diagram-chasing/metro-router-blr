<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		icon,
		children
	}: { title: string; icon?: string; children: Snippet } = $props();
</script>

<div
	class="font-xp fixed inset-0 flex bg-[#3a6ea5] bg-cover bg-center p-2 selection:bg-[#000080] selection:text-white sm:p-4"
	style="background-image:url(/xp/bliss.jpg)"
>
	<div
		class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-t-lg border-[3px] border-[#0054e3] bg-[#ece9d8] shadow-2xl"
	>
		<!-- ── Title bar ── -->
		<div
			class="flex shrink-0 items-center gap-2 rounded-t-[5px] border-b border-[#003ad6] bg-gradient-to-b from-[#0e6fff] via-[#1f60e5] to-[#0a53d6] px-2 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
		>
			{#if icon}
				<img
					src={icon}
					alt=""
					class="hidden h-4 w-4 shrink-0 drop-shadow-[0_1px_1px_rgba(0,0,0,0.4)] sm:block"
				/>
			{:else}
				<span
					class="hidden h-4 w-4 shrink-0 rounded-[2px] bg-gradient-to-br from-[#ffd966] to-[#e6960f] shadow-[inset_0_1px_0_rgba(255,255,255,0.6)] sm:block"
					aria-hidden="true"
				></span>
			{/if}
			<span
				class="flex-1 truncate text-[14px] font-bold tracking-[0.01em] text-white drop-shadow-[1px_1px_1px_rgba(0,0,0,0.55)] sm:text-[16px]"
			>
				{title}
			</span>

			<!-- Decorative window controls (non-functional on the kiosk). -->
			<div class="flex items-center gap-1" aria-hidden="true">
				<span
					class="grid h-[22px] w-[22px] place-items-center rounded-[3px] border border-white/40 bg-[#2c6af7] text-[12px] font-bold leading-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
					>_</span
				>
				<span
					class="grid h-[22px] w-[22px] place-items-center rounded-[3px] border border-white/40 bg-[#2c6af7] text-[11px] font-bold leading-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
					>▢</span
				>
				<span
					class="grid h-[22px] w-[22px] place-items-center rounded-[3px] border border-white/40 bg-[#e94d3d] text-[14px] font-bold leading-none text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.4)]"
					>×</span
				>
			</div>
		</div>

		<!-- ── Body ── -->
		<div class="flex min-h-0 flex-1 flex-col p-4 sm:p-6">
			{@render children()}
		</div>
	</div>
</div>
