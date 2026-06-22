<script lang="ts">
	type Stats = {
		count: number;
		avgCo2PerTripKg: number;
		avgCo2PerKmG: number;
	};

	let {
		stats,
		savedPct = null,
		shiftPct = 50
	}: { stats: Stats; savedPct?: number | null; shiftPct?: number } = $props();
</script>

<div class="hud">
	<div class="title">Bengaluru commutes</div>
	<div class="row"><span class="lbl">trips</span><span class="val">{stats.count}</span></div>
	<div class="row">
		<span class="lbl">avg / trip</span><span class="val">{stats.avgCo2PerTripKg}<i>kg</i></span>
	</div>
	<div class="row">
		<span class="lbl">avg / km</span><span class="val">{stats.avgCo2PerKmG}<i>g</i></span>
	</div>
	{#if savedPct != null}
		<div class="row cf">
			<span class="lbl">if {shiftPct}% shift</span><span class="val">−{savedPct}<i>%&nbsp;CO₂</i></span>
		</div>
	{/if}
</div>

<style>
	.hud {
		position: absolute;
		top: 22px;
		left: 22px;
		z-index: 15;
		display: flex;
		flex-direction: column;
		gap: 7px;
		padding: 14px 18px;
		min-width: 188px;
		background: rgba(6, 10, 16, 0.6);
		border: 1px solid rgba(120, 160, 200, 0.14);
		border-radius: 10px;
		backdrop-filter: blur(8px);
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		color: #eaf2ff;
	}
	.title {
		font-family: 'IBM Plex Sans', system-ui, sans-serif;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.02em;
		color: #cfe0f5;
		margin-bottom: 3px;
	}
	.row {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 20px;
		font-variant-numeric: tabular-nums;
	}
	.lbl {
		font-size: 9px;
		letter-spacing: 0.22em;
		text-transform: uppercase;
		color: #7e90a8;
	}
	.val {
		font-size: 17px;
		font-weight: 500;
	}
	.val i {
		font-style: normal;
		font-size: 10px;
		color: #8aa0bd;
		margin-left: 3px;
	}
	.cf {
		margin-top: 4px;
		padding-top: 8px;
		border-top: 1px solid rgba(120, 220, 210, 0.18);
	}
	.cf .lbl {
		color: #4fd6c4;
	}
	.cf .val {
		color: #7ff0de;
	}
	.cf .val i {
		color: #5fc9bb;
	}
</style>
