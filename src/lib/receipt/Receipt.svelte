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

	let { view, node = $bindable(null) }: { view: ReceiptView; node?: HTMLElement | null } = $props();

	const inr = (n: number) => n.toLocaleString('en-IN');

	// Bar length encodes g/km (dirtiness); the headcount rides along as text. ASCII
	// throughout — no middots, no arrows — so it prints clean in the pixel face.
	const corridorRows = $derived(
		view.corridor.rows.map((r: ReceiptView['corridor']['rows'][number]) => ({
			label: r.label,
			value: r.gPerKm,
			right: `${r.gPerKm} g/km / ${inr(r.countPerDay)}/day`,
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

<!-- Section heading: the pixel display face does the shouting; alignment is the
     structure. No number badge, no heavy rule. -->
{#snippet label(title: string, right = '')}
	<div class="mb-3 flex items-baseline justify-between gap-3">
		<span class="font-display text-r-lg uppercase tracking-label">{title}</span>
		{#if right}<span class="font-mono text-r-xs uppercase tracking-wide">{right}</span>{/if}
	</div>
{/snippet}

<!-- A ledger line: name left, value right. Real bold lives here (Space Mono 700). -->
{#snippet row(name: string, value: string, bold = false)}
	<div class="flex items-baseline justify-between gap-4 text-r-base {bold ? 'font-bold' : ''}">
		<span class="uppercase tracking-wide">{name}</span>
		<span class="whitespace-nowrap text-right tabular-nums {bold ? '' : 'font-bold'}">{value}</span>
	</div>
{/snippet}

<!-- A headline stat: big pixel number + small unit, sharing a baseline. -->
{#snippet stat(value: string, unit: string)}
	<div class="flex items-baseline gap-2">
		<span class="font-display text-r-stat leading-none">{value}</span>
		<span class="font-mono text-r-base font-bold">{unit}</span>
	</div>
{/snippet}

<article
	bind:this={node}
	class="box-border w-[576px] bg-paper px-10 pb-12 pt-10 font-mono text-r-base text-ink [-webkit-font-smoothing:none] [font-smooth:never]"
>
	<!-- ───────────── masthead ───────────── -->
	<header class="text-center">
		<h1 class="font-display text-r-title uppercase leading-none">
			The Pollution<br />That Wasn't
		</h1>
		<p class="mx-auto mt-4 max-w-[18rem] font-mono text-r-2xs uppercase tracking-label">
			- a commute emissions receipt -
		</p>
		<div class="mt-4 border-t border-ink pt-2 text-r-xs uppercase tracking-wide">
			<p>{view.meta.dateLabel} / {view.meta.timeLabel}</p>
			<p>Order no. {view.meta.visitorNo}</p>
		</div>
	</header>

	<div class="my-6 border-t border-dashed border-ink"></div>

	<!-- ───────────── where you go ───────────── -->
	<section>
		{@render label('Where you go')}
		<div class="mb-3 flex items-baseline justify-between gap-3 font-display text-r-base uppercase">
			<span class="min-w-0 truncate">{view.item.origin}</span>
			<span class="shrink-0" aria-hidden="true">-&gt;</span>
			<span class="min-w-0 truncate text-right">{view.item.dest}</span>
		</div>

		{#if hasRouteGeo}
			<div data-print="map"><RouteMap segments={view.route.geo} height={210} /></div>
			<div class="mt-1.5 flex justify-between text-r-2xs uppercase tracking-label">
				<span>.... cleaner leg</span>
				<span>==== dirtier leg</span>
			</div>
		{:else}
			<RouteStrip distanceKm={view.route.distanceKm} />
		{/if}

		<div class="mt-4 space-y-1.5">
			{@render row('Distance', `${view.item.distanceKm.toFixed(1)} km each way`)}
			{@render row('Frequency', `${inr(view.item.tripsPerYear)} trips / yr`)}
			{@render row('Mode', `${view.item.modeLabel}, ${view.item.freqLabel}`)}
		</div>
	</section>

	<div class="my-6 border-t border-dashed border-ink"></div>

	<!-- ───────────── today's commuters ───────────── -->
	<section>
		{@render label('Your mode', view.modeRank.histogram ? "today's commuters" : '')}
		<p class="mb-4 text-r-base leading-relaxed">{view.modeRank.copy}</p>
		{#if view.modeRank.histogram}
			<Histogram values={view.modeRank.histogram.values} mine={view.modeRank.histogram.mine} />
		{/if}
		{#if view.modeRank.cleanerNote}
			<p class="mt-3 text-r-sm italic">{view.modeRank.cleanerNote}</p>
		{/if}
	</section>

	<div class="my-6 border-t border-dashed border-ink"></div>

	<!-- ───────────── your corridor ───────────── -->
	<section>
		{@render label('Your corridor', `~${inr(view.corridor.totalPerDay)}/day`)}
		<p class="mb-4 text-r-base leading-relaxed">{view.corridor.copy}</p>
		<Bars rows={corridorRows} />
	</section>

	<div class="my-6 border-t border-dashed border-ink"></div>

	<!-- ───────────── the ledger: one trip → the year (the total) ───────────── -->
	<section>
		{@render label('The damage', 'per trip')}
		<div class="grid grid-cols-2 gap-4">
			{@render stat(inr(view.oneTrip.co2G), 'g CO2')}
			{@render stat(inr(view.oneTrip.pm25Mg), 'mg PM2.5')}
		</div>
		<p class="mt-3 text-r-sm uppercase tracking-wide">
			x {inr(view.item.tripsPerYear)} trips / year
		</p>

		<div class="my-4 border-t border-dashed border-ink"></div>

		<div class="mb-3 flex items-baseline justify-between gap-3">
			<span class="font-display text-r-base uppercase tracking-label">Total / one year</span>
			<span class="font-mono text-r-xs uppercase tracking-wide">each o ~ {view.year.kgPerBlock} kg</span>
		</div>
		<div class="grid grid-cols-2 gap-4">
			{@render stat(inr(view.year.co2Kg), 'kg CO2')}
			{@render stat(inr(view.year.pm25G), 'g PM2.5')}
		</div>
		<div class="mt-4">
			<Slab co2Kg={view.year.co2Kg} kgPerBlock={view.year.kgPerBlock} isClean={view.year.isClean} />
		</div>
		{#if view.year.copy}<p class="mt-3 text-r-sm leading-relaxed">{view.year.copy}</p>{/if}
	</section>

	<div class="my-6 border-t border-dashed border-ink"></div>

	<!-- ───────────── that year, in things ───────────── -->
	<section>
		{@render label('That much, in things', `${inr(view.year.co2Kg)} kg =`)}
		{#if view.units.isClean}
			<p class="text-r-base leading-relaxed">{view.units.copy}</p>
		{:else}
			<div class="grid grid-cols-2 gap-4">
				<Pictograph count={view.units.cylinders} kind="cylinder" caption="gas cylinders" />
				<Pictograph count={view.units.trees} kind="tree" caption="trees, full-time" />
			</div>
		{/if}
	</section>

	<div class="my-6 border-t border-dashed border-ink"></div>

	<!-- ───────────── the swap (checkbox idiom) ───────────── -->
	<section>
		{@render label('Suggested swap')}
		<p class="mb-4 text-r-base leading-relaxed">{view.swap.copy}</p>
		{#if view.swap.show}
			<ul class="mb-4 space-y-2 text-r-base uppercase tracking-wide">
				<li>[ ] Shift half your trips to metro</li>
				<li>[ ] Walk the first &amp; last mile</li>
				<li>[ ] Keep ~{inr(view.swap.savedKg)} kg CO2 out of the air</li>
			</ul>
			<Bars rows={co2SwapRows} />
			<div class="mt-4 grid grid-cols-2 gap-4">
				{@render stat(`-${inr(view.swap.savedKg)}`, 'kg / yr')}
				{@render stat(`~${view.swap.treesSaved}`, "trees' worth")}
			</div>
			<p class="mt-2 text-r-sm">
				PM2.5 {inr(view.swap.nowPm25G)} -&gt; {inr(view.swap.swapPm25G)} g/yr
			</p>
		{/if}
	</section>

	<div class="my-6 border-t border-dashed border-ink"></div>

	<!-- ───────────── profile ───────────── -->
	<section class="text-center">
		<p class="font-display text-r-lg uppercase tracking-label">Emissions resonance</p>
		<div class="my-4 flex justify-center" data-print="stamp">
			<Stamp n={view.archetype.figure.n} m={view.archetype.figure.m} seed={view.archetype.stampSeed} />
		</div>
		<p class="text-r-xs uppercase tracking-label">
			Figure {view.archetype.figure.n}x{view.archetype.figure.m}
		</p>
		<p class="mt-2 font-display text-r-lg uppercase">{view.archetype.name}</p>
		{#if view.archetype.subtitle}
			<p class="text-r-sm italic">{view.archetype.subtitle}</p>
		{/if}
		<p class="mx-auto mt-3 max-w-[24rem] text-r-sm leading-relaxed">
			Your commute drawn as a Chladni resonance -- the cleaner you travel, the calmer the figure
			rings. {view.archetype.basis}
		</p>
	</section>

	<div class="my-6 border-t border-dashed border-ink"></div>

	<!-- ───────────── while you read ───────────── -->
	<section>
		{@render label('While you read')}
		<Counter cityCount={view.counter.cityCount} />
	</section>

	<div class="my-6 border-t border-dashed border-ink"></div>

	<!-- ───────────── fine print ───────────── -->
	<section>
		{@render label('The fine print')}
		<p class="mb-2 text-r-sm leading-relaxed">{view.finePrint.psCopy}</p>
		<p class="text-r-2xs leading-relaxed">{view.finePrint.disclaimer}</p>
	</section>

	<!-- ───────────── QR + footer ───────────── -->
	<div class="mt-8 flex flex-col items-center gap-2 border-t border-dashed border-ink pt-6 text-center">
		<p class="text-r-xs uppercase tracking-label">Scan to keep this receipt</p>
		<QR data={qrData} size={132} />
		<p class="text-r-2xs uppercase tracking-label">No. {view.meta.visitorNo}</p>
	</div>

	<p class="mt-6 text-center font-display text-r-sm uppercase tracking-footer">
		&gt;&gt; Retain for your records &lt;&lt;
	</p>
</article>
