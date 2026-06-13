<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	import TactileButton from '$lib/exhibit/TactileButton.svelte';
	import type { StoredReceipt } from '$lib/server/receiptStore';
	import AsciiBlock from '$lib/receipt/AsciiBlock.svelte';

	// The receipt endpoint augments the stored receipt with a live distribution of
	// everyone in the same distance band so far (absent until enough data exists).
	type ReceiptResponse = StoredReceipt & {
		distribution?: { percentile: number; n: number; values: number[] };
	};
	import {
		routeStripSegments,
		routeCaption,
		routeBlurb,
		scaleStack,
		scaleBlurb,
		distributionBell,
		distributionFromData,
		distributionBlurb,
		switchBars,
		switchBlurb,
		pm25Blurb,
		fingerprintPatch,
		fingerprintBlurb
	} from '$lib/receipt/ascii';

	let loading = $state(true);
	let error = $state<string | null>(null);
	let receipt = $state<ReceiptResponse | null>(null);

	$effect(() => {
		const id = $page.url.searchParams.get('id');
		if (!id) {
			error = 'no receipt id in url';
			loading = false;
			return;
		}
		void load(id);
	});

	async function load(id: string) {
		loading = true;
		error = null;
		try {
			const res = await fetch(`/api/receipt?id=${encodeURIComponent(id)}`);
			if (!res.ok) throw new Error(`status ${res.status}`);
			receipt = (await res.json()) as ReceiptResponse;
		} catch (e) {
			error = e instanceof Error ? e.message : 'fetch failed';
		} finally {
			loading = false;
		}
	}

	function startOver() {
		goto('/exhibit');
	}

	function fmtDate(ts: number): string {
		const d = new Date(ts);
		const opts: Intl.DateTimeFormatOptions = {
			weekday: 'short',
			day: '2-digit',
			month: 'short'
		};
		return d.toLocaleDateString('en-IN', opts).toUpperCase();
	}

	function fmtTime(ts: number): string {
		const d = new Date(ts);
		return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
	}

	function shortVisitor(id: string): string {
		const tail = id.split('-')[1] ?? id;
		return tail.padStart(4, '0').slice(-4).toUpperCase();
	}

	function barcodeBars(seed: string, count = 44): number[] {
		let h = 2166136261 >>> 0;
		for (let i = 0; i < seed.length; i++) {
			h ^= seed.charCodeAt(i);
			h = Math.imul(h, 16777619) >>> 0;
		}
		const out: number[] = [];
		for (let i = 0; i < count; i++) {
			h = Math.imul(h, 1664525) + 1013904223;
			h >>>= 0;
			out.push(((h >>> 16) % 4) + 1);
		}
		return out;
	}

	const bars = $derived(receipt ? barcodeBars(receipt.id) : []);
</script>

<main class="page">
	<div class="restart-wrap">
		<TactileButton label="NEW VISITOR →" size="md" glow="amber" onclick={startOver} />
	</div>

	{#if loading}
		<p class="status">Printing your year…</p>
	{:else if error}
		<p class="status err">Failed to load: {error}</p>
	{:else if receipt}
		{@const r = receipt.computed}
		{@const a = receipt.answers}
		{@const originLabel = receipt.geo?.originLabel ?? r.trip.originStation ?? 'Origin'}
		{@const destLabel = receipt.geo?.destinationLabel ?? r.trip.destinationStation ?? 'Destination'}
		{@const segs = receipt.geo?.segments ?? [
			{ mode: r.trip.mode, lengthM: r.trip.distanceKm * 1000 }
		]}
		{@const route = routeStripSegments(segs)}
		{@const stack = scaleStack(r.annualCommuteKg, r.annualAllInKg)}
		{@const dist = receipt.distribution
			? distributionFromData(receipt.distribution.values, r.perTripKg)
			: distributionBell(r.multiplier)}
		{@const sw = switchBars(r.annualCommuteKg, r.annualSwitchedKg)}
			{@const pm = switchBars(r.annualCommutePm25G, r.annualSwitchedPm25G)}
		{@const patch = fingerprintPatch(a)}

		<article class="receipt">
			<header class="brandhead">
				<div class="brand">
					<span>YOUR COMMUTE</span>
					<span>RECEIPT</span>
				</div>
				<p class="branch">Diagram Chasing</p>
				<p class="meta">
					{fmtDate(receipt.createdAt)} · {fmtTime(receipt.createdAt)} · VISITOR #{shortVisitor(
						receipt.id
					)}
				</p>
			</header>

			<hr />

			<section>
				<h3>YOUR ROUTE</h3>
				<p class="end-label">[{originLabel}]</p>
				<AsciiBlock text={route} align="left" emphasis="bold" />
				<p class="meta-line">
					{r.trip.distanceKm} km · {routeCaption(r.trip.mode, r.trip.frequency)}
				</p>
				<p class="end-label right">[{destLabel}]</p>
				{#if segs.length > 1}
					<p class="tiny">
						{#each segs as s, i (i)}{#if i > 0}
								·
							{/if}{Math.round(s.lengthM / 100) / 10} km
							{s.mode === 'active' ? 'walk' : s.mode}{/each}
					</p>
				{/if}
				<p class="blurb">{routeBlurb(r.trip.mode, r.trip.frequency, r.trip.distanceKm)}</p>
			</section>

			<hr />

			<section>
				<h3>THIS YEAR, YOUR COMMUTE ALONE</h3>
				<AsciiBlock text={stack.full} align="left" emphasis="bold" />
				<p class="big-num">~{r.annualCommuteKg} kg CO₂e</p>
				{#if stack.ghost}
					<AsciiBlock text={stack.ghost} align="left" />
					<p class="meta-line">+ {r.annualAllInKg - r.annualCommuteKg} kg from everything else</p>
				{/if}
				<p class="blurb">
					{scaleBlurb(r.annualCommuteKg, r.annualAllInKg, r.trip.lifestyle)}
				</p>
				<p class="tiny">
					each block ≈ {stack.kgPerCell} kg · about {stack.cylinders} LPG cylinders worth
				</p>
			</section>

			<hr />

			<section>
				<h3>AMONG {r.distanceBand.toUpperCase()} COMMUTERS</h3>
				<AsciiBlock text={`${dist.marker} you\n${dist.bell}`} align="left" emphasis="bold" />
				<p class="axis">
					<span>LIGHTER ◀</span><span>▶ HEAVIER</span>
				</p>
				<p class="blurb">
					{distributionBlurb(r.multiplier, r.distanceBand, r.trip.decider)}
				</p>
				{#if receipt.distribution}
					<p class="tiny">
						Lighter than {receipt.distribution.percentile}% of {receipt.distribution.n}
						{r.distanceBand} commuters here so far.
					</p>
				{/if}
			</section>

			<hr />

			<section>
				<h3>IF YOU SWAPPED IT — CO₂</h3>
				{#if r.annualSavingKg > 0}
					<p class="meta-line">vs {r.comboLabel}</p>
					<p class="bar-cap">
						<span class="bar-tag">NOW</span><span class="bar-num">{r.annualCommuteKg} kg</span>
					</p>
					<AsciiBlock text={sw.now} align="left" emphasis="bold" />
					<p class="bar-cap">
						<span class="bar-tag">SWAP</span><span class="bar-num">{r.annualSwitchedKg} kg</span>
					</p>
					<AsciiBlock text={sw.switched} align="left" emphasis="bold" />
					<p class="blurb">
						{switchBlurb(r.annualSavingKg, r.treeYearsEquivalent)}
					</p>
					{#if r.twoYearSavingKg > 0}
						<p class="tiny">Over two years that's about {r.twoYearSavingKg} kg.</p>
					{/if}
				{:else}
					<p class="blurb">
						You're already at or below a metro-led trip on CO₂. Little to swap — this is one of the cleaner ways to move.
					</p>
				{/if}
			</section>

			<hr />

			<section>
				<h3>THE AIR YOU BREATHE OUT — PM2.5</h3>
				<p class="big-num">~{r.annualCommutePm25G} g / year</p>
				{#if r.annualSavingPm25G > 1}
					<p class="bar-cap">
						<span class="bar-tag">NOW</span><span class="bar-num">{r.annualCommutePm25G} g</span>
					</p>
					<AsciiBlock text={pm.now} align="left" emphasis="bold" />
					<p class="bar-cap">
						<span class="bar-tag">SWAP</span><span class="bar-num">{r.annualSwitchedPm25G} g</span>
					</p>
					<AsciiBlock text={pm.switched} align="left" emphasis="bold" />
				{/if}
				<p class="blurb">
					{pm25Blurb(r.annualCommutePm25G, r.annualSavingPm25G, r.trip.mode)}
				</p>
				<p class="tiny">Fine particulate (PM2.5) — the pollutant most tied to lung and heart disease.</p>
			</section>

			<hr />

			<section>
				<h3>YOUR COMMUTE FINGERPRINT</h3>
				<AsciiBlock text={patch.join('\n')} align="center" />
				<p class="archetype-name">{r.archetype.name}</p>
				{#if r.archetype.subtitle}
					<p class="archetype-sub">{r.archetype.subtitle}</p>
				{/if}
				<p class="blurb">
					{fingerprintBlurb(r.archetype.name, a.funQuestionId, a.funAnswer)}
				</p>
			</section>

			<hr />

			<footer class="footer">
				<div class="barcode" aria-hidden="true">
					{#each bars as w, i (i)}
						<span style="width: {w}px"></span>
					{/each}
				</div>
				<p class="code">BLR-RECEIPT-{shortVisitor(receipt.id)}</p>
				<p class="discl">{r.disclaimer}</p>
			</footer>
		</article>
	{/if}
</main>

<style>
	.page {
		min-height: 100vh;
		background: #0c0c0c;
		padding: 40px 20px 80px;
		display: flex;
		flex-direction: column;
		align-items: center;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
	}

	.restart-wrap {
		width: 240px;
		height: 60px;
		margin: 0 auto 28px;
		display: flex;
	}

	.status {
		color: #ededed;
		font-size: 16px;
		padding: 60px 0;
		letter-spacing: 0.12em;
	}
	.status.err {
		color: #ff7058;
	}

	.receipt {
		width: 100%;
		max-width: 420px;
		background: #ebd884;
		color: #14110d;
		padding: 36px 30px 32px;
		position: relative;
		box-shadow:
			0 30px 80px rgba(0, 0, 0, 0.55),
			0 8px 24px rgba(0, 0, 0, 0.35);
		font-size: 13px;
		line-height: 1.55;
		container-type: inline-size;
	}
	.receipt::before,
	.receipt::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 12px;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' preserveAspectRatio='none'><polygon points='0,12 6,0 12,12' fill='%23ebd884'/></svg>");
		background-size: 12px 12px;
		background-repeat: repeat-x;
	}
	.receipt::before {
		top: -12px;
	}
	.receipt::after {
		bottom: -12px;
		transform: scaleY(-1);
	}

	.receipt hr {
		border: none;
		border-top: 1px dashed #14110d;
		margin: 14px 0;
	}

	.brandhead {
		text-align: center;
	}
	.brand {
		font-family: 'IBM Plex Sans', ui-sans-serif, sans-serif;
		font-weight: 800;
		font-size: 34px;
		line-height: 0.95;
		letter-spacing: -0.015em;
		display: flex;
		flex-direction: column;
		gap: 2px;
		margin-bottom: 16px;
	}
	.branch {
		margin: 0;
		font-size: 12px;
		letter-spacing: 0.1em;
	}
	.meta {
		margin: 4px 0 0;
		font-size: 11px;
		letter-spacing: 0.12em;
		opacity: 0.78;
	}

	section {
		margin: 6px 0;
	}
	section h3 {
		margin: 0 0 8px;
		font-size: 11px;
		letter-spacing: 0.22em;
		font-weight: 700;
	}
	section p {
		margin: 4px 0;
	}

	.meta-line {
		font-size: 12px;
		opacity: 0.85;
		margin-top: 2px !important;
	}
	.tiny {
		font-size: 10.5px;
		opacity: 0.55;
		letter-spacing: 0.02em;
		margin-top: 4px !important;
	}
	.blurb {
		font-size: 12.5px;
		margin-top: 8px !important;
		line-height: 1.45;
	}

	.end-label {
		font-size: 11px;
		letter-spacing: 0.08em;
		margin: 0 0 2px !important;
		opacity: 0.85;
	}
	.end-label.right {
		text-align: right;
	}

	.big-num {
		font-weight: 800;
		font-size: 22px;
		letter-spacing: -0.01em;
		margin: 2px 0 6px !important;
	}

	.axis {
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		letter-spacing: 0.12em;
		opacity: 0.7;
		margin: 2px 0 !important;
	}

	.bar-cap {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin: 6px 0 0 !important;
	}
	.bar-tag {
		font-size: 10px;
		letter-spacing: 0.16em;
		font-weight: 700;
	}
	.bar-num {
		font-size: 12px;
		font-weight: 700;
	}

	.archetype-name {
		text-align: center;
		margin: 8px 0 0 !important;
		font-weight: 800;
		font-size: 16px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}
	.archetype-sub {
		text-align: center;
		margin: 4px 0 0 !important;
		font-size: 11px;
		font-style: italic;
		opacity: 0.78;
	}

	.footer {
		text-align: center;
	}
	.barcode {
		display: flex;
		gap: 2px;
		justify-content: center;
		align-items: stretch;
		height: 44px;
		margin: 8px 0 10px;
	}
	.barcode span {
		display: block;
		background: #14110d;
		height: 100%;
	}
	.code {
		margin: 4px 0 8px;
		font-size: 11px;
		letter-spacing: 0.18em;
	}
	.discl {
		margin: 2px 0;
		font-size: 10px;
		font-style: italic;
		opacity: 0.6;
		letter-spacing: 0.04em;
	}
</style>
