// Turn the rendered receipt DOM into a raster bitmap for the thermal printer.
//
// The <article> is laid out at exactly 576 px (80 mm / 3-inch head at 203 dpi),
// so we capture at scale 1 to get a 576-px-wide PNG. Fonts must be loaded before
// capture or the first print comes out in a fallback face — hence fonts.ready.

import { domToBlob, domToPng } from 'modern-screenshot';

const THERMAL_WIDTH = 576;

async function options(node: HTMLElement) {
	if (typeof document !== 'undefined' && document.fonts?.ready) {
		await document.fonts.ready;
	}
	return {
		scale: 1,
		width: THERMAL_WIDTH,
		height: node.scrollHeight,
		backgroundColor: '#ffffff'
	};
}

export async function renderReceiptToBlob(node: HTMLElement): Promise<Blob> {
	return domToBlob(node, await options(node));
}

export async function renderReceiptToDataUrl(node: HTMLElement): Promise<string> {
	return domToPng(node, await options(node));
}

export async function downloadReceipt(node: HTMLElement, filename = 'commute-receipt.png') {
	const blob = await renderReceiptToBlob(node);
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

export async function openReceipt(node: HTMLElement) {
	const url = await renderReceiptToDataUrl(node);
	const w = window.open('', '_blank');
	if (w) w.document.write(`<img src="${url}" style="width:${THERMAL_WIDTH}px" alt="receipt" />`);
}
