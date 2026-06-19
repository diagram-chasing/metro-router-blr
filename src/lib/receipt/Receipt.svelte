<script lang="ts">
	import { browser } from '$app/environment';
	import type { ReceiptView } from './model';
	import RouteStrip from './viz/RouteStrip.svelte';
	import RouteMap from './viz/RouteMap.svelte';
	import Bars from './viz/Bars.svelte';
	import Histogram from './viz/Histogram.svelte';
	import Slab from './viz/Slab.svelte';
	import Pictograph from './viz/Pictograph.svelte';
	import Stamp from './viz/Stamp.svelte';
	import QR from './viz/QR.svelte';
	import Counter from './Counter.svelte';
	import NoParking from '$lib/assets/no-parking.png';

	let { view, node = $bindable(null) }: { view: ReceiptView; node?: HTMLElement | null } = $props();

	const inr = (n: number) => n.toLocaleString('en-IN');

	// Bar length encodes g/km (dirtiness); the headcount rides along as text.
	const corridorRows = $derived(
		view.corridor.rows.map((r: ReceiptView['corridor']['rows'][number]) => ({
			label: r.label,
			value: r.gPerKm,
			right: `${r.gPerKm} g/km · ${inr(r.countPerDay)}/day`,
			mark: r.isYou
		}))
	);
	const co2SwapRows = $derived([
		{ label: 'now', value: view.swap.nowKg, right: `${inr(view.swap.nowKg)} kg` },
		{ label: 'swap', value: view.swap.swapKg, right: `${inr(view.swap.swapKg)} kg` }
	]);

	const hasRouteGeo = $derived(view.route.geo.some((g) => g.coords?.length >= 2));

	// A real, scannable QR back to this receipt.
	const qrData = $derived(
		browser
			? `${location.origin}/receipt?id=${view.finePrint.barcodeSeed}`
			: `https://pollution.receipt/${view.finePrint.barcodeSeed}`
	);
</script>

<!-- Section label: small caps, no number badge — alignment is the structure. -->
{#snippet label(title: string, right = '')}
	<div class="mb-2.5 flex items-baseline justify-between gap-3">
		<span class="text-r-sm font-bold uppercase tracking-label">{title}</span>
		{#if right}<span class="text-r-sm font-bold tabular-nums">{right}</span>{/if}
	</div>
{/snippet}

<!-- A ledger line: name left, value right, optional indented sub-line. -->
{#snippet row(name: string, value: string, bold = false)}
	<div class="flex items-baseline justify-between gap-4 text-r-base {bold ? 'font-bold' : ''}">
		<span class="uppercase tracking-wide">{name}</span>
		<span class="whitespace-nowrap text-right tabular-nums {bold ? '' : 'font-bold'}">{value}</span>
	</div>
{/snippet}

<!-- A headline stat: big mono number + small unit, sharing a baseline. -->
{#snippet stat(value: string, unit: string)}
	<div class="flex items-baseline gap-1.5">
		<span class="text-r-stat font-bold leading-none tabular-nums">{value}</span>
		<span class="text-r-base font-bold">{unit}</span>
	</div>
{/snippet}

<article
	bind:this={node}
	class="box-border w-[576px] bg-paper px-10 pb-12 pt-10 font-mono text-r-base text-ink [-webkit-font-smoothing:none] [font-smooth:never]"
>
	<!-- ───────────── masthead ───────────── -->
	<header class="text-center">
		<img src={NoParking} alt="" class="mx-auto mb-3 h-16 w-16" />
		<h1 class="font-display text-r-title font-black uppercase">
			The Pollution<br />That Wasn't
		</h1>
		<p class="mx-auto mt-3 max-w-[16rem] text-r-2xs uppercase tracking-label">
			— a commute emissions receipt —
		</p>
		<div class="mt-3 border-t-2 border-ink pt-2 text-r-xs uppercase tracking-wide">
			<p>{view.meta.dateLabel} · {view.meta.timeLabel}</p>
			<p>Order no. {view.meta.visitorNo}</p>
		</div>
	</header>

	<div class="my-4 border-t-2 border-dashed border-ink"></div>

	<!-- ───────────── where you go ───────────── -->
	<section>
		{@render label('Where you go')}
		<div class="mb-3 flex items-baseline justify-between gap-3 text-r-base font-bold uppercase">
			<span class="truncate">{view.item.origin}</span>
			<span aria-hidden="true">→</span>
			<span class="truncate text-right">{view.item.dest}</span>
		</div>

		{#if hasRouteGeo}
			<RouteMap segments={view.route.geo} height={210} />
			<div class="mt-1 flex justify-between text-r-2xs uppercase tracking-label">
				<span>┈┈ cleaner leg</span>
				<span>━━ dirtier leg</span>
			</div>
		{:else}
			<RouteStrip distanceKm={view.route.distanceKm} />
		{/if}

		<div class="mt-3 space-y-1">
			{@render row('Distance', `${view.item.distanceKm.toFixed(1)} km each way`)}
			{@render row('Frequency', `${inr(view.item.tripsPerYear)} trips / yr`)}
			{@render row('Mode', `${view.item.modeLabel}, ${view.item.freqLabel}`)}
		</div>
	</section>

	<div class="my-4 border-t border-dashed border-ink"></div>

	<!-- ───────────── today's commuters ───────────── -->
	<section>
		{@render label('Your mode', view.modeRank.histogram ? "today's commuters" : '')}
		<p class="mb-3 text-r-base">{view.modeRank.copy}</p>
		{#if view.modeRank.histogram}
			<Histogram values={view.modeRank.histogram.values} mine={view.modeRank.histogram.mine} />
		{/if}
		{#if view.modeRank.cleanerNote}
			<p class="mt-1.5 text-r-xs">{view.modeRank.cleanerNote}</p>
		{/if}
	</section>

	<div class="my-4 border-t border-dashed border-ink"></div>

	<!-- ───────────── your corridor ───────────── -->
	<section>
		{@render label('Your corridor', `~${inr(view.corridor.totalPerDay)}/day`)}
		<p class="mb-3 text-r-base">{view.corridor.copy}</p>
		<Bars rows={corridorRows} rightW={210} />
	</section>

	<div class="my-4 border-t-2 border-dashed border-ink"></div>

	<!-- ───────────── the ledger: one trip → the year (the total) ───────────── -->
	<section>
		{@render label('The damage', 'per trip')}
		<div class="grid grid-cols-2 gap-4">
			{@render stat(inr(view.oneTrip.co2G), 'g CO₂')}
			{@render stat(inr(view.oneTrip.pm25Mg), 'mg PM2.5')}
		</div>
		<p class="mt-2 text-r-sm uppercase tracking-wide">
			× {inr(view.item.tripsPerYear)} trips / year
		</p>

		<div class="my-3 border-t-2 border-ink"></div>

		<div class="mb-3 flex items-baseline justify-between">
			<span class="text-r-sm font-bold uppercase tracking-label">Total · one year</span>
			<span class="text-r-sm font-bold uppercase tracking-label"
				>1 block ≈ {view.year.kgPerBlock} kg</span
			>
		</div>
		<div class="grid grid-cols-2 gap-4">
			{@render stat(inr(view.year.co2Kg), 'kg CO₂')}
			{@render stat(inr(view.year.pm25G), 'g PM2.5')}
		</div>
		<div class="mt-3">
			<Slab co2Kg={view.year.co2Kg} kgPerBlock={view.year.kgPerBlock} isClean={view.year.isClean} />
		</div>
		{#if view.year.copy}<p class="mt-2 text-r-sm">{view.year.copy}</p>{/if}
	</section>

	<div class="my-4 border-t border-dashed border-ink"></div>

	<!-- ───────────── that year, in things ───────────── -->
	<section>
		{@render label('That much, in things', `${inr(view.year.co2Kg)} kg =`)}
		{#if view.units.isClean}
			<p class="text-r-base">{view.units.copy}</p>
		{:else}
			<div class="grid grid-cols-2 gap-4">
				<Pictograph count={view.units.cylinders} kind="cylinder" caption="gas cylinders" />
				<Pictograph count={view.units.trees} kind="tree" caption="trees, full-time" />
			</div>
		{/if}
	</section>

	<div class="my-4 border-t border-dashed border-ink"></div>

	<!-- ───────────── the swap (checkbox idiom) ───────────── -->
	<section>
		{@render label('Suggested swap')}
		<p class="mb-3 text-r-base">{view.swap.copy}</p>
		{#if view.swap.show}
			<ul class="mb-3 space-y-1.5 text-r-base uppercase tracking-wide">
				<li>[ ] Shift half your trips to metro</li>
				<li>[ ] Walk the first & last mile</li>
				<li>[ ] Keep ~{inr(view.swap.savedKg)} kg CO₂ out of the air</li>
			</ul>
			<Bars rows={co2SwapRows} labelW={48} rightW={96} />
			<div class="mt-3 grid grid-cols-2 gap-4">
				{@render stat(`−${inr(view.swap.savedKg)}`, 'kg / yr')}
				{@render stat(`~${view.swap.treesSaved}`, "trees' worth")}
			</div>
			<p class="mt-1.5 text-r-xs">
				PM2.5 {inr(view.swap.nowPm25G)} → {inr(view.swap.swapPm25G)} g/yr
			</p>
		{/if}
	</section>

	<div class="my-4 border-t border-dashed border-ink"></div>

	<!-- ───────────── profile ───────────── -->
	<section class="text-center">
		<p class="text-r-sm font-bold uppercase tracking-label">Emissions resonance</p>
		<div class="my-3 flex justify-center">
			<Stamp n={view.archetype.figure.n} m={view.archetype.figure.m} seed={view.archetype.stampSeed} />
		</div>
		<p class="text-r-xs uppercase tracking-label">
			Figure {view.archetype.figure.n}×{view.archetype.figure.m}
		</p>
		<p class="text-r-lg mt-2 font-bold uppercase tracking-tight">{view.archetype.name}</p>
		{#if view.archetype.subtitle}
			<p class="text-r-sm italic">{view.archetype.subtitle}</p>
		{/if}
		<p class="mx-auto mt-2 max-w-[22rem] text-r-xs leading-relaxed">
			Your commute drawn as a Chladni resonance — the cleaner you travel, the calmer the figure
			rings. {view.archetype.basis}
		</p>
	</section>

	<div class="my-4 border-t border-dashed border-ink"></div>

	<!-- ───────────── while you read ───────────── -->
	<section>
		{@render label('While you read')}
		<Counter cityCount={view.counter.cityCount} />
	</section>

	<div class="my-4 border-t border-dashed border-ink"></div>

	<!-- ───────────── fine print ───────────── -->
	<section>
		{@render label('The fine print')}
		<p class="mb-2 text-r-sm">{view.finePrint.psCopy}</p>
		<p class="text-r-2xs leading-relaxed">{view.finePrint.disclaimer}</p>
	</section>

	<!-- ───────────── QR + footer ───────────── -->
	<div class="mt-6 flex flex-col items-center gap-2 border-t-2 border-dashed border-ink pt-5 text-center">
		<p class="text-r-xs uppercase tracking-label">Scan to keep this receipt</p>
		<QR data={qrData} size={132} />
		<p class="text-r-2xs uppercase tracking-label">No. {view.meta.visitorNo}</p>
	</div>

	<p class="mt-5 text-center text-r-sm font-bold uppercase tracking-footer">
		&laquo; Retain for your records &raquo;
	</p>
</article>
