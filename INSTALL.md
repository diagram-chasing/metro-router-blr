# Exhibition wall — installation runbook

The wall + kiosk run as a **single local node box, fully offline**. Nothing depends on
venue internet: the app server, SQLite DB, basemap tiles, glyphs, and UI fonts are all
served from the same machine. This document is the on-site setup + operation guide.

> Architecture: one machine runs the SvelteKit node server (`adapter-node`). The kiosk
> tablet/screen and the projector wall are browsers pointing at it over the local network
> (or the same machine). The accumulating field lives in `data/exhibit.db` (better-sqlite3).

---

## 1. Build target — adapter-node (replaces Netlify)

The repo currently ships `@sveltejs/adapter-netlify`, which is serverless and **cannot**
host the stateful SQLite field. For the installation, switch to the node adapter:

```bash
pnpm remove @sveltejs/adapter-netlify
pnpm add -D @sveltejs/adapter-node
```

`svelte.config.js` — swap the adapter import:

```js
// import adapter from '@sveltejs/adapter-netlify';
import adapter from '@sveltejs/adapter-node';
```

`package.json` — add a start script:

```json
"start": "node build"
```

Then:

```bash
pnpm build
node build        # serves on PORT (default 3000); the DB is created at ./data/exhibit.db
```

`netlify.toml` is unused on-site (leave it for any cloud preview, or delete it).

---

## 2. Self-host the basemap, glyphs, and UI fonts (kills the last network deps)

The tile/glyph/UI-font sources are already **configurable** in code
(`src/lib/viz/basemapSource.ts`, `src/app.css`); they default to the public OpenFreeMap /
Google Fonts hosts. To go offline, stage local copies and add these to the box's `.env`
(both are `PUBLIC_`-prefixed runtime vars, read by `basemapSource.ts`):

```bash
PUBLIC_TILES_URL=pmtiles:///tiles/bengaluru.pmtiles
PUBLIC_GLYPHS_URL=/fonts/{fontstack}/{range}.pbf
```

### 2a. Vector tiles — the one asset to stage on-site

This app's maplibre style uses the **OpenMapTiles schema** (layer names `water`, `road` with
`class`, `place`…). So the offline tile source must be OpenMapTiles-schema, not Protomaps.
The pmtiles `pmtiles://` protocol is already registered (`basemapSource.ts`) and the source
is env-driven, so once you have a local source it's a one-line flip. Two schema-correct paths:

**Option 1 — run OpenFreeMap locally (recommended, style needs no changes).** OpenFreeMap
publishes a self-host setup; run it on the Mac mini and it serves the same `/planet`
TileJSON + glyph endpoints this app already targets. Then set in `.env`:

```bash
PUBLIC_TILES_URL=http://localhost:8080/planet      # local OpenFreeMap
# PUBLIC_GLYPHS_URL can then also point at the local server's /fonts endpoint
```

**Option 2 — build an OpenMapTiles-schema pmtiles for the bbox** (e.g. with planetiler's
`--download` OpenMapTiles profile, clipped to ~`77.30,12.75,77.90,13.25`), drop it at
`static/tiles/bengaluru.pmtiles`, then:

```bash
PUBLIC_TILES_URL=pmtiles:///tiles/bengaluru.pmtiles
```

> Note: a plain `pmtiles extract` of a Protomaps planet would NOT work — different schema.
> The glyphs and UI fonts below are already staged in the repo.

### 2b. Glyph fonts (map labels) — staged in repo

The map labels use **IBM Plex Mono Medium** (the receipt/legend monospace language;
`LABEL_FONT` in `src/lib/viz/palette.ts`). The openfreemap glyph endpoint only serves
**Noto**, so this stack is baked into a local MapLibre glyph stack at
`static/fonts/IBM Plex Mono Medium/{range}.pbf`. Because it's self-hosted, point glyphs at the
local stack — **needed in dev too**, since the remote default 404s on Plex:

```bash
PUBLIC_GLYPHS_URL=/fonts/{fontstack}/{range}.pbf
```

To re-bake or swap the face, use **MapLibre Font Maker** (https://maplibre.org/font-maker/ —
runs client-side, no upload, no native build): feed it the OFL TTF (`github.com/IBM/plex` or
`fonts.google.com`; `@fontsource` ships only woff2), unzip into `static/fonts/`, and make the
folder name match `LABEL_FONT` **exactly**. The Latin Noto Sans Regular ranges remain staged
at `static/fonts/Noto Sans Regular/{range}.pbf` as a fallback — revert `LABEL_FONT` to
`'Noto Sans Regular'` to use them.

### 2c. UI fonts (headline/legend — IBM Plex) — DONE

`src/app.css` now imports IBM Plex Sans/Mono from `@fontsource` (bundled locally by Vite);
the Google Fonts `@import` is gone. No network dependency, no fallback-font flash.

**Verify offline:** with the box on its own network, pull the internet uplink — the wall
must keep rendering tiles, labels, and type with zero blank tiles or fallback-font flash.

---

## 3. Wall display — URL params

Open the wall at `/` (the CollectiveMap). Tunable via query string:

| Param      | Default | Meaning                                                        |
| ---------- | ------- | ------------------------------------------------------------- |
| `scale`    | `1`     | **Wall type scale** — set on-site from viewing distance (below). |
| `poll`     | `4000`  | ms between line/stats polls.                                   |
| `cell`     | `0.005` | grid cell size (deg). Re-bake the baseline if you change this. |
| `gain`     | `1.5`   | µg/m³·yr the commute layer adds at the busiest corridor.       |
| `years`    | `10`    | decade the commute layer is compounded over.                  |
| `demo`     | —       | `1` injects synthetic routes every 14 s (attract / testing).  |
| `dpr`      | auto    | device pixel ratio.                                            |

`halfLife` (days, default 7; `0` = no decay) is an `/api/emissions` param — set it in the
field URL inside `CollectiveMap.svelte` if you want a different rolling window.

### Sizing `scale` to viewing distance

The smallest number a viewer must read (a neighbourhood value) should subtend
~12–15 arcminutes. At ~5 m that's ~25–40 mm tall on the wall. Project the wall, stand at
the **typical** viewing distance, and raise `?scale=` until the neighbourhood numbers are
comfortably readable; the headline auto-scales 3–5× from there. Re-check the legend and
caveat are legible too. (Also confirm the safe-area inset clears any keystone/vignette.)

---

## 4. OS kiosk hardening — macOS (Mac mini)

Two pieces: the node **server** (LaunchAgent, always up) and the **kiosk browser**
(`scripts/wall-kiosk-macos.sh`, Chrome `--kiosk` + `caffeinate`).

**Server LaunchAgent** — `~/Library/LaunchAgents/com.exhibit.wall-server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.exhibit.wall-server</string>
  <key>ProgramArguments</key>
    <array><string>/usr/bin/env</string><string>node</string><string>build</string></array>
  <key>WorkingDirectory</key><string>/Users/USERNAME/app</string>
  <key>EnvironmentVariables</key><dict><key>PORT</key><string>3000</string></dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
</dict></plist>
```

```bash
launchctl load -w ~/Library/LaunchAgents/com.exhibit.wall-server.plist
```

**Kiosk browser** — autostart `scripts/wall-kiosk-macos.sh` either via a second LaunchAgent
(`KeepAlive=true`, so a Chrome crash relaunches) or System Settings → General → Login Items.
The script runs `caffeinate -dimsu` to block display/system sleep for the run. Also set
System Settings → Lock Screen → "Start Screen Saver" = Never, and Displays → never sleep.

Hide the cursor: the wall already applies `cursor:none` in-app; for the menu-bar/edge cases
add `Cursorcerer` (or move the pointer to a corner). The in-app **watchdog** reloads the
page if the rAF loop stalls (GPU context loss), so a hung frame self-recovers untouched.

> A Linux box is also supported — `scripts/wall-kiosk.sh` (Chromium) + a systemd-user
> service with `Restart=always` and `loginctl enable-linger`.

---

## 5. Operate

- **Reset the field:** the admin page (`/admin`) → purge lines (keeps submissions) or purge
  all. With the 7-day rolling decay you generally don't need to reset; old routes fade on
  their own and the map stays legible.
- **Data lifecycle:** decay is on by default (`halfLife=7`). For a hard daily reset instead,
  cron a `DELETE /api/lines` overnight. For pure cumulative, set `halfLife=0`.
- **Calibration screen:** project the legend ramp + neighbourhood numbers and re-tune
  `scale` and (if the projector shifts hue) the palette saturation in `palette.ts` on the
  real surface, not a laptop.

## 6. Pre-open checklist

- [ ] Offline test: pull the uplink — tiles, labels, fonts, API all still work.
- [ ] Watchdog: throttle/kill the tab's GPU — page reloads to last-good.
- [ ] Soak 6–12 h: memory flat, GPU thermals stable, map doesn't drift to all-red.
- [ ] Burst test: submit several routes fast — every one gets its spotlight (compressed
      under load), "+N joining" shows, nobody is dropped.
- [ ] Legibility: neighbourhood numbers + legend + caveat readable at typical distance.
- [ ] Framing: no cell reads "clean"; caveat always visible; headline = marginal months.
