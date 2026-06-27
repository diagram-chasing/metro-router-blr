import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import maplibre from 'maplibre-gl';
import { Protocol } from 'pmtiles';

// Register the pmtiles:// protocol once (browser only) so a self-hosted local tile bundle
// (PUBLIC_TILES_URL=pmtiles:///tiles/…) can be served offline. No-op for remote http tiles.
if (typeof window !== 'undefined') {
	maplibre.addProtocol('pmtiles', new Protocol().tile);
}

// Basemap vector tiles + glyph fonts for every maplibre map in the app. Defaults to the
// public OpenFreeMap host so nothing changes for cloud/dev. For the unattended offline
// wall, point these at a locally-served pmtiles bundle + glyph PBFs (see INSTALL.md) so a
// venue network blip can never blank the map — set in the wall machine's .env:
//
//   PUBLIC_TILES_URL=pmtiles:///tiles/bengaluru.pmtiles
//   PUBLIC_GLYPHS_URL=/fonts/{fontstack}/{range}.pbf
export const TILES_URL = env.PUBLIC_TILES_URL || 'https://tiles.openfreemap.org/planet';

// Glyphs: an explicit PUBLIC_GLYPHS_URL always wins (the offline wall points it at its local
// stack). Otherwise pick by environment — in dev, serve the committed stack from static/fonts
// so the label font (IBM Plex Mono Medium, which only exists locally — openfreemap has Noto
// only) renders with zero config; in prod, default to the remote endpoint. NB: because the
// label font is local-only, a prod deploy must set PUBLIC_GLYPHS_URL=/fonts/{fontstack}/{range}.pbf
// (the wall's .env does) or the labels fall back/blank — swap this prod default to the local
// path if you'd rather lean on the committed stack everywhere.
export const GLYPHS_URL =
	env.PUBLIC_GLYPHS_URL ||
	(dev
		? '/fonts/{fontstack}/{range}.pbf'
		: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf');
