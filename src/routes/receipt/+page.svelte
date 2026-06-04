<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';

	import TactileButton from '$lib/exhibit/TactileButton.svelte';
	import type { StoredReceipt } from '$lib/server/receiptStore';

	let loading = $state(true);
	let error = $state<string | null>(null);
	let receipt = $state<StoredReceipt | null>(null);

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
			receipt = (await res.json()) as StoredReceipt;
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
		// Last 4 chars of the rand suffix — stable & readable on a thermal-print line.
		const tail = id.split('-')[1] ?? id;
		return tail.padStart(4, '0').slice(-4).toUpperCase();
	}

	const PRESET_LABELS: Record<string, string> = {
		private: 'Private all the way',
		metro_mixed: 'Metro + short auto',
		metro_walk: 'Metro + walk'
	};

	// Deterministic pseudo-random barcode bar widths from the id.
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
			out.push(((h >>> 16) % 4) + 1); // 1..4 px wide
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

		<article class="receipt">
			<header class="brandhead">
				<div class="brand">
					<span>THE COMMUTE</span>
					<span>RECEIPT</span>
				</div>
				<p class="branch">Namma Bengaluru Branch</p>
				<p class="meta">
					{fmtDate(receipt.createdAt)} · {fmtTime(receipt.createdAt)} · VISITOR #{shortVisitor(
						receipt.id
					)}
				</p>
			</header>

			<hr />

			<p class="tagline">YOUR YEAR, ONE TRIP AT A TIME</p>

			<hr />

			<section>
				<h3>TRIP</h3>
				{#if r.trip.originStation && r.trip.destinationStation}
					<p class="route">
						{r.trip.originStation}<br />→ {r.trip.destinationStation}
					</p>
				{/if}
				<p class="trip-line">
					{r.trip.modeLabel} · {r.trip.distanceKm} km · {r.trip.frequencyLabel}
				</p>
				{#if a.chosenPreset}
					<p class="you-said">
						You said you'd take it as: <b>{PRESET_LABELS[a.chosenPreset] ?? a.chosenPreset}</b>
					</p>
				{/if}
			</section>

			<hr />

			<section>
				<div class="line big">
					<span>THIS YEAR</span>
					<span class="leader"></span>
					<span class="num">~{r.annualCommuteKg} kg CO₂</span>
				</div>
				<p class="sublabel">(your commute alone)</p>
				<div class="line">
					<span>ALL TRIPS, SCALED</span>
					<span class="leader"></span>
					<span class="num">~{(r.annualAllInKg / 1000).toFixed(1)} tonnes</span>
				</div>
			</section>

			<hr />

			<section>
				<h3>THE DAMAGE, IN CONTEXT</h3>
				{#if r.multiplier > 1}
					<p>
						Your trips emit <strong>≈ {Math.round(r.multiplier)}×</strong> the
						{r.recommendation.recommendedCombo} version of this exact route.
					</p>
				{:else}
					<p>You're already on the lean side of this route.</p>
				{/if}
				<p class="muted">
					Among {r.distanceBand} commuters, your trips sit in the heavier-emitting bracket.
				</p>
			</section>

			<hr />

			<section>
				<h3>YOUR TYPE</h3>
				<div class="boxed">
					<p class="archetype-name">{r.archetype.name}</p>
					{#if r.archetype.subtitle}
						<p class="archetype-sub">{r.archetype.subtitle}</p>
					{/if}
				</div>
			</section>

			<hr />

			<section>
				<h3>IF YOU'D SWITCHED</h3>
				<p class="sublabel">({r.recommendation.recommendedCombo})</p>

				<div class="line">
					<span>Annual footprint</span>
					<span class="leader"></span>
					<span class="num">~{r.annualSwitchedKg} kg</span>
				</div>
				<div class="line">
					<span>You'd save</span>
					<span class="leader"></span>
					<span class="num">~{r.annualSavingKg} kg / yr</span>
				</div>
				<div class="line">
					<span>Over two years</span>
					<span class="leader"></span>
					<span class="num">~{(r.twoYearSavingKg / 1000).toFixed(1)} tonnes</span>
				</div>
				<div class="line">
					<span>≈ trees working</span>
					<span class="leader"></span>
					<span class="num">{r.treeYearsEquivalent} / year</span>
				</div>
			</section>

			<hr />

			<section>
				<h3>ONE THING</h3>
				<p>{r.personalNudge}</p>
			</section>

			<hr />

			<p class="headline">"{r.recommendation.deciderHeadline}"</p>

			<hr />

			<footer class="footer">
				<div class="barcode" aria-hidden="true">
					{#each bars as w, i (i)}
						<span style="width: {w}px"></span>
					{/each}
				</div>
				<p class="code">BLR-RECEIPT-{shortVisitor(receipt.id)}</p>
				<p class="discl">{r.disclaimer}</p>
				<p class="discl">keep · or recycle :)</p>
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

	/* The paper. */
	.receipt {
		width: 100%;
		max-width: 420px;
		background: #f4f1eb;
		color: #14110d;
		padding: 36px 30px 32px;
		position: relative;
		box-shadow: 0 30px 80px rgba(0, 0, 0, 0.55), 0 8px 24px rgba(0, 0, 0, 0.35);
		font-size: 13px;
		line-height: 1.55;
	}
	/* Zigzag torn edges. */
	.receipt::before,
	.receipt::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 12px;
		background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12' preserveAspectRatio='none'><polygon points='0,12 6,0 12,12' fill='%23f4f1eb'/></svg>");
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

	/* Brand block */
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

	.tagline {
		text-align: center;
		margin: 4px 0;
		font-size: 11px;
		letter-spacing: 0.22em;
		font-weight: 700;
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
	.muted {
		opacity: 0.72;
	}
	.sublabel {
		font-size: 11px;
		opacity: 0.7;
		margin-top: -2px !important;
	}

	.route {
		font-weight: 700;
		line-height: 1.35;
	}
	.trip-line {
		font-size: 12px;
		opacity: 0.85;
	}
	.you-said {
		font-size: 12px;
		margin-top: 6px;
	}
	.you-said b {
		font-weight: 700;
	}

	strong {
		font-size: 1.35em;
		font-weight: 800;
		letter-spacing: -0.01em;
	}

	/* Leader-dotted two-column lines */
	.line {
		display: flex;
		align-items: baseline;
		gap: 6px;
		margin: 3px 0;
		font-size: 13px;
	}
	.line .leader {
		flex: 1;
		border-bottom: 1px dotted #14110d;
		transform: translateY(-3px);
		min-width: 18px;
	}
	.line .num {
		font-weight: 700;
		white-space: nowrap;
	}
	.line.big {
		font-size: 14px;
	}
	.line.big .num {
		font-size: 17px;
	}

	.boxed {
		border: 2px solid #14110d;
		padding: 14px 12px;
		text-align: center;
		margin-top: 6px;
	}
	.archetype-name {
		margin: 0;
		font-weight: 800;
		font-size: 17px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}
	.archetype-sub {
		margin: 4px 0 0;
		font-size: 11px;
		font-style: italic;
		opacity: 0.78;
	}

	.headline {
		text-align: center;
		font-style: italic;
		font-size: 13px;
		max-width: 28ch;
		margin: 8px auto;
		text-wrap: balance;
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
