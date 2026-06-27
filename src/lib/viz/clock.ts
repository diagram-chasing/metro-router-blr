// One rAF loop drives the whole scene; animation is a function of `t` (seconds), so
// per-frame work is just feeding uniforms — buffers rebuild only when data changes.

export type Clock = {
	start: () => void;
	stop: () => void;
};

export type ClockOpts = {
	// Wall watchdog: an independent interval polls the last frame time (a rAF can't detect its
	// own stall) and fires onStall if the loop hasn't advanced in stallMs. Off by default; the
	// unattended wall sets onStall = () => location.reload().
	onStall?: () => void;
	stallMs?: number;
};

export function createClock(onFrame: (t: number, dt: number) => void, opts: ClockOpts = {}): Clock {
	let raf = 0;
	let startMs = 0;
	let lastMs = 0;
	let running = false;

	// ── Watchdog ──
	const stallMs = opts.stallMs ?? 5000;
	let lastFrameWall = 0; // performance.now() of the last delivered frame
	let watch = 0;
	let stalled = false;

	const loop = (now: number) => {
		if (!running) return;
		if (!startMs) {
			startMs = now;
			lastMs = now;
		}
		const t = (now - startMs) / 1000;
		const dt = (now - lastMs) / 1000;
		lastMs = now;
		lastFrameWall = performance.now();
		onFrame(t, dt);
		raf = requestAnimationFrame(loop);
	};

	return {
		start() {
			if (running) return;
			running = true;
			lastFrameWall = performance.now();
			raf = requestAnimationFrame(loop);
			if (opts.onStall) {
				watch = setInterval(() => {
					if (!running || stalled) return;
					if (performance.now() - lastFrameWall > stallMs) {
						stalled = true; // fire once; onStall typically reloads the page
						opts.onStall?.();
					}
				}, Math.max(1000, stallMs / 2)) as unknown as number;
			}
		},
		stop() {
			running = false;
			if (raf) cancelAnimationFrame(raf);
			if (watch) clearInterval(watch);
		}
	};
}
