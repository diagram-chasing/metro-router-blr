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
export const GLYPHS_URL =
	env.PUBLIC_GLYPHS_URL || 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
