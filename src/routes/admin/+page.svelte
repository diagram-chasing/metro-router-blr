<script lang="ts">
	import { onMount } from 'svelte';

	type Stats = { count: number; avgCo2PerTripKg: number; avgCo2PerKmG: number };

	let stats = $state<Stats | null>(null);
	let busy = $state(false);
	let note = $state<string | null>(null);

	async function loadStats() {
		try {
			const res = await fetch('/api/stats');
			stats = (await res.json()) as Stats;
		} catch {
			stats = null;
		}
	}

	async function purge(action: 'purge-lines' | 'purge-all') {
		const label = action === 'purge-all' ? 'lines AND every stored response' : 'all map lines';
		if (!confirm(`Permanently delete ${label}? This cannot be undone.`)) return;
		busy = true;
		note = null;
		try {
			const res = await fetch('/api/admin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action })
			});
			if (!res.ok) throw new Error(`server returned ${res.status}`);
			note = action === 'purge-all' ? 'Everything reset.' : 'Map lines cleared.';
			await loadStats();
		} catch (e) {
			note = e instanceof Error ? e.message : 'failed';
		} finally {
			busy = false;
		}
	}

	onMount(loadStats);
</script>

<main class="wrap">
	<h1>Exhibit controls</h1>

	<section class="stats">
		<div class="stat"><span class="lbl">routes on map</span><span class="val">{stats?.count ?? '—'}</span></div>
		<div class="stat"><span class="lbl">avg CO₂ / trip</span><span class="val">{stats?.avgCo2PerTripKg ?? '—'} kg</span></div>
		<div class="stat"><span class="lbl">avg CO₂ / km</span><span class="val">{stats?.avgCo2PerKmG ?? '—'} g</span></div>
	</section>

	<section class="actions">
		<button type="button" onclick={() => purge('purge-lines')} disabled={busy}>Purge map lines</button>
		<button type="button" class="danger" onclick={() => purge('purge-all')} disabled={busy}>
			Reset everything
		</button>
		<button type="button" class="ghost" onclick={loadStats} disabled={busy}>Refresh</button>
	</section>

	{#if note}<p class="note">{note}</p>{/if}

	<p class="hint">
		Line map: <a href="/">/</a> · layer toggles via params, e.g. <code>/?basemap=0</code>,
		<code>/?recent=1</code>, <code>/?stations=1&hud=1</code>.
	</p>
	<p class="hint">
		Emissions raster: <a href="/emissions">/emissions</a> ·
		<a href="/emissions?grid=raw">raw</a> ·
		<a href="/emissions?grid=diff">diff</a> ·
		<a href="/emissions?grid=cf">cf</a>
	</p>
</main>

<style>
	.wrap {
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		gap: 24px;
		padding: 48px;
		background: #0e0e0e;
		color: #ededed;
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
	}
	h1 {
		margin: 0;
		font-size: 20px;
		letter-spacing: 0.04em;
	}
	.stats {
		display: flex;
		gap: 16px;
		flex-wrap: wrap;
	}
	.stat {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px 20px;
		min-width: 140px;
		background: #161616;
		border: 1px solid #2a2a2a;
		border-radius: 8px;
	}
	.lbl {
		font-size: 9px;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: #8a8a8a;
	}
	.val {
		font-size: 24px;
		font-variant-numeric: tabular-nums;
	}
	.actions {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}
	button {
		padding: 10px 18px;
		font: inherit;
		font-size: 13px;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #ededed;
		background: #1c1c1c;
		border: 1px solid #3a3a3a;
		border-radius: 6px;
		cursor: pointer;
	}
	button:hover:not(:disabled) {
		background: #262626;
	}
	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
	.danger {
		border-color: #6a1f17;
		color: #ffb098;
	}
	.danger:hover:not(:disabled) {
		background: #2a1310;
	}
	.ghost {
		background: transparent;
	}
	.note {
		margin: 0;
		color: #8fd19e;
		font-size: 13px;
	}
	.hint {
		margin-top: auto;
		font-size: 12px;
		color: #7a7a7a;
	}
	a,
	code {
		color: #cacaca;
	}
</style>
