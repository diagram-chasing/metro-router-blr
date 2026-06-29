#!/usr/bin/env bash
# Bake the offline vector basemap the wall reads via PUBLIC_TILES_URL=pmtiles:///tiles/bengaluru.pmtiles
# (.env). Downloads the Karnataka OSM extract and renders an OpenMapTiles-schema pmtiles clipped to
# the Bengaluru bbox with tilemaker (Docker). One-time bake; the .pbf and .pmtiles are gitignored.
# Run: pnpm tiles:build   (needs Docker running). See INSTALL.md §2a.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
pbf="$here/karnataka.osm.pbf"
bbox="77.2,12.6,77.9,13.4" # keep in sync with config-openmaptiles.json bounding_box

mkdir -p "$root/static/tiles"

# 1. Karnataka OSM extract (covers the Bengaluru bbox). Skip the ~hundreds-of-MB re-download if
#    already present — wget -nc exits 1 when the file exists, which set -e would treat as failure.
if [ ! -f "$pbf" ]; then
	wget -O "$pbf" https://download.openstreetmap.fr/extracts/asia/india/karnataka.osm.pbf
fi

# 2. Render → pmtiles, clipped to the bbox, with the OpenMapTiles lua + config. Repo root is mounted
#    at /data so the .pbf, lua, config (scripts/tiles/) and output (static/tiles/) all address it.
docker run -it --rm --pull always -v "$root:/data" \
	ghcr.io/systemed/tilemaker:master \
	/data/scripts/tiles/karnataka.osm.pbf \
	--output /data/static/tiles/bengaluru.pmtiles \
	--bbox "$bbox" \
	--process /data/scripts/tiles/process-openmaptiles.lua \
	--config /data/scripts/tiles/config-openmaptiles.json \
	--skip-integrity

echo "✓ static/tiles/bengaluru.pmtiles built — pnpm dev / pnpm serve now render offline."
