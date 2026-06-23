<script lang="ts">
	import ReceiptDoc from '$lib/receipt/ReceiptDoc.svelte';

	let { data } = $props();
</script>

<svelte:head><title>dev · receipt gallery</title></svelte:head>

<main>
	<header>
		<h1>Receipt gallery</h1>
		<p>
			{data.cases.length} curated permutations — the canonical divergence cases plus the clean /
			dirty / stranded / no-data extremes. The full matrix lives in
			<code>scripts/out/receipt-matrix.md</code> (<code>pnpm receipts:matrix</code>).
		</p>
	</header>

	<div class="grid">
		{#each data.cases as c (c.label)}
			<section class="card">
				<h2>{c.label}</h2>
				<div class="paper-wrap">
					<ReceiptDoc view={c.view} />
				</div>
			</section>
		{/each}
	</div>
</main>

<style>
	main {
		padding: 2rem;
		background: #e7e5e0;
		min-height: 100vh;
		font-family: ui-sans-serif, system-ui, sans-serif;
		color: #1a1a1a;
	}
	header {
		max-width: 60ch;
		margin: 0 auto 2rem;
	}
	h1 {
		font-size: 1.5rem;
		margin: 0 0 0.5rem;
	}
	header p {
		margin: 0;
		font-size: 0.9rem;
		color: #555;
		line-height: 1.5;
	}
	code {
		background: #d6d3cd;
		padding: 0.05em 0.35em;
		border-radius: 3px;
		font-size: 0.85em;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
		gap: 2rem;
		align-items: start;
	}
	.card {
		background: transparent;
	}
	h2 {
		font-size: 0.85rem;
		font-weight: 600;
		margin: 0 0 0.75rem;
		color: #333;
		font-variant: small-caps;
		letter-spacing: 0.02em;
	}
	.paper-wrap {
		background: #fff;
		box-shadow: 0 2px 12px rgba(0, 0, 0, 0.15);
		display: inline-block;
		padding: 12px;
		max-width: 100%;
		overflow-x: auto;
	}
</style>
