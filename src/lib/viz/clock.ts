// One requestAnimationFrame loop drives the whole scene. Animation is a function
// of `t` (seconds), so per-frame work is just feeding uniforms — buffers only
// rebuild when data actually changes.

export type Clock = {
	start: () => void;
	stop: () => void;
};

export function createClock(onFrame: (t: number, dt: number) => void): Clock {
	let raf = 0;
	let startMs = 0;
	let lastMs = 0;
	let running = false;

	const loop = (now: number) => {
		if (!running) return;
		if (!startMs) {
			startMs = now;
			lastMs = now;
		}
		const t = (now - startMs) / 1000;
		const dt = (now - lastMs) / 1000;
		lastMs = now;
		onFrame(t, dt);
		raf = requestAnimationFrame(loop);
	};

	return {
		start() {
			if (running) return;
			running = true;
			raf = requestAnimationFrame(loop);
		},
		stop() {
			running = false;
			if (raf) cancelAnimationFrame(raf);
		}
	};
}
