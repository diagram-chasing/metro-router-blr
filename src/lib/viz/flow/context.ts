// The dot-matrix context layer: faint roads + water + place labels drawn in the
// receipt's own braille/DotGrid language so the wall and the printed receipt read as
// one product. Reuses loadBasemap()/DotGrid from $lib/receipt/viz/braille verbatim;
// only the colour changes (cool + faint over the dark art instead of 1-bit black).
// Drawn once after the basemap loads and again on resize — it's a static frame.

import { DotGrid, type Basemap, type Place } from '$lib/receipt/viz/braille';
import type { Projector } from './projection';

export type ContextParams = {
	pitch: number; // dot grid pitch in css px
	dotColor: string; // roads/water dots
	labelColor: string; // place-name text
	haloColor: string; // text halo (sits over the dot field)
	maxLabels: number;
};

export const DEFAULT_CONTEXT_PARAMS: ContextParams = {
	pitch: 5,
	dotColor: 'rgba(150,196,214,0.5)',
	labelColor: 'rgba(224,240,247,0.86)',
	haloColor: 'rgba(4,6,12,0.9)',
	maxLabels: 44
};

const PLACE_ORDER: Record<string, number> = {
	city: 0,
	town: 1,
	suburb: 2,
	neighbourhood: 3,
	quarter: 4
};

type Rect = { x: number; y: number; w: number; h: number };
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function drawContext(
	canvas: HTMLCanvasElement,
	proj: Projector,
	basemap: Basemap | null,
	dpr: number,
	params: ContextParams = DEFAULT_CONTEXT_PARAMS
): void {
	const cssW = proj.width;
	const cssH = proj.height;
	canvas.width = Math.round(cssW * dpr);
	canvas.height = Math.round(cssH * dpr);
	const ctx = canvas.getContext('2d');
	if (!ctx) return;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
	ctx.clearRect(0, 0, cssW, cssH);
	if (!basemap) return;

	const project = (c: number[]): [number, number] => proj.project(c[0], c[1]);

	const grid = new DotGrid(cssW, cssH, params.pitch);
	grid.fillStipple(basemap.water.map((ring) => ring.map(project)), 5); // faint water
	for (const road of basemap.roads) {
		if (road.length < 2) continue;
		grid.stroke(road.map(project), { spacing: params.pitch * 2 });
	}
	grid.flush(ctx, 1, params.dotColor);

	drawLabels(ctx, basemap.places, proj, params);
}

function drawLabels(ctx: CanvasRenderingContext2D, places: Place[], proj: Projector, params: ContextParams): void {
	const ordered = [...places].sort(
		(a, b) => (PLACE_ORDER[a.kind] ?? 9) - (PLACE_ORDER[b.kind] ?? 9) || a.rank - b.rank
	);
	const placed: Rect[] = [];
	ctx.font = '700 12px ui-monospace, "SF Mono", Menlo, monospace';
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	ctx.lineJoin = 'round';
	let n = 0;
	for (const p of ordered) {
		if (n >= params.maxLabels) break;
		const [x, y] = proj.project(p.c[0], p.c[1]);
		if (x < 4 || y < 4 || x > proj.width - 4 || y > proj.height - 4) continue;
		const text = p.name.toUpperCase();
		const tw = ctx.measureText(text).width;
		const rx = x - tw / 2;
		const ry = y - 6;
		const rect: Rect = { x: rx - 3, y: ry - 2, w: tw + 6, h: 16 };
		if (placed.some((q) => overlaps(rect, q))) continue;
		ctx.strokeStyle = params.haloColor;
		ctx.lineWidth = 3;
		ctx.strokeText(text, rx, ry);
		ctx.fillStyle = params.labelColor;
		ctx.fillText(text, rx, ry);
		placed.push(rect);
		n++;
	}
}
