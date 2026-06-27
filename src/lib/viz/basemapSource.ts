import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import maplibre from 'maplibre-gl';
import { Protocol } from 'pmtiles';

// Register pmtiles:// once (browser only) so an offline local tile bundle
// (PUBLIC_TILES_URL=pmtiles:///tiles/…) works. No-op for remote http tiles.
if (typeof window !== 'undefined') {
	maplibre.addProtocol('pmtiles', new Protocol().tile);
}

// Basemap tiles + glyphs for every maplibre map. Defaults to OpenFreeMap; the offline wall
// overrides via .env (PUBLIC_TILES_URL=pmtiles:///tiles/bengaluru.pmtiles, see INSTALL.md).
export const TILES_URL = env.PUBLIC_TILES_URL || 'https://tiles.openfreemap.org/planet';

// Glyphs: explicit PUBLIC_GLYPHS_URL wins. Else dev serves the committed local stack (the label
// font IBM Plex Mono Medium only exists in static/fonts — openfreemap has Noto only); prod
// defaults remote, so a prod deploy must point PUBLIC_GLYPHS_URL at the local path or labels blank.
export const GLYPHS_URL =
	env.PUBLIC_GLYPHS_URL ||
	(dev
		? '/fonts/{fontstack}/{range}.pbf'
		: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
