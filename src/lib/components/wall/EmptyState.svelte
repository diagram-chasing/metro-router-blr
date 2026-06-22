<script lang="ts">
	// Shown on a fresh / reset database so the wall reads as "ready and waiting"
	// rather than broken. The dark basemap + ambient field still render behind it.
</script>

<div class="empty">
	<div class="dot"></div>
	<div class="title">Bengaluru commutes</div>
	<div class="sub">Waiting for the first journey…</div>
</div>

<style>
	.empty {
		position: absolute;
		inset: 0;
		z-index: 18;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		text-align: center;
		pointer-events: none;
	}
	.dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		background: #4fd6c4;
		box-shadow: 0 0 24px 6px rgba(79, 214, 196, 0.5);
		animation: pulse 2.6s ease-in-out infinite;
	}
	.title {
		font-family: 'IBM Plex Sans', system-ui, sans-serif;
		font-size: clamp(22px, 3vw, 44px);
		font-weight: 600;
		letter-spacing: 0.01em;
		color: #eaf2ff;
	}
	.sub {
		font-family: 'IBM Plex Mono', ui-monospace, monospace;
		font-size: clamp(11px, 1.2vw, 15px);
		letter-spacing: 0.18em;
		text-transform: uppercase;
		color: #7e90a8;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 0.35;
			transform: scale(0.85);
		}
		50% {
			opacity: 1;
			transform: scale(1.15);
		}
	}
</style>
