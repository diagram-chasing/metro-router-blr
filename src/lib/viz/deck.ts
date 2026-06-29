// deck.gl touches window at import time, so it's never imported at module scope — every use
// funnels through loadDeck() (called only inside onMount), keeping it out of SSR + code-split.

import { makeFieldLayer } from './fieldLayer';

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
		SolidPolygonLayer: layers.SolidPolygonLayer,
		TextLayer: layers.TextLayer,
		TripsLayer: geo.TripsLayer,
		FieldLayer: makeFieldLayer(layers.BitmapLayer) // single-texture choropleth (fieldLayer.ts)
	};
}

export type Deck = Awaited<ReturnType<typeof loadDeck>>;
