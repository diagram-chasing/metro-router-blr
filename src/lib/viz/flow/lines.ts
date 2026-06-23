// Route → stepped dot geometry, in the receipt map's pixelated language: walk the
// projected polyline and snap to a pitch grid, emitting one ordered dot per cell. The
// ordering lets the line animate being "drawn" (reveal dots head-first over time), and
// the grid-snapping gives the same stepped look as the dot-matrix context layer.

export function steppedDots(pts: [number, number][], pitch: number): [number, number][] {
	const out: [number, number][] = [];
	if (pts.length < 2) return out;
	const half = pitch / 2;
	const step = pitch * 0.5;
	let lastKey = NaN;
	for (let i = 1; i < pts.length; i++) {
		const [x0, y0] = pts[i - 1];
		const [x1, y1] = pts[i];
		const len = Math.hypot(x1 - x0, y1 - y0);
		if (len === 0) continue;
		const ux = (x1 - x0) / len;
		const uy = (y1 - y0) / len;
		for (let s = 0; s <= len; s += step) {
			const c = Math.round((x0 + ux * s - half) / pitch);
			const r = Math.round((y0 + uy * s - half) / pitch);
			const key = r * 100000 + c;
			if (key !== lastKey) {
				lastKey = key;
				out.push([c * pitch + half, r * pitch + half]);
			}
		}
	}
	return out;
}
