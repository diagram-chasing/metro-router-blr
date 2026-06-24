// deck.gl touches window/document at import time, so importing it anywhere SSR
// evaluates breaks prerender. Every deck import funnels through loadDeck(), which
// is only ever called inside onMount (browser-only) — keeping the heavy bundle
// out of the server shell and code-split from initial load.

export async function loadDeck() {
	const [mapbox, layers, geo] = await Promise.all([
		import('@deck.gl/mapbox'),
		import('@deck.gl/layers'),
		import('@deck.gl/geo-layers')
	]);
	return {
		MapboxOverlay: mapbox.MapboxOverlay,
		GridCellLayer: layers.GridCellLayer,
		PathLayer: layers.PathLayer,
		ScatterplotLayer: layers.ScatterplotLayer,
		TextLayer: layers.TextLayer,
		TripsLayer: geo.TripsLayer
	};
}

export type Deck = Awaited<ReturnType<typeof loadDeck>>;
