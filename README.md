# Commute Emissions Exhibit

An interactive exhibit for Bengaluru. A visitor answers a few questions about
their regular trip; we route it, estimate its CO₂e and PM2.5, and print a
receipt. Every visit also accumulates onto two live maps that TouchDesigner
captures as visual inputs.

Built with SvelteKit, MapLibre, OpenTripPlanner (routing) and SQLite.

## Run

Runs as a single local server (the exhibit machine).

```bash
pnpm install   # builds the better-sqlite3 native binding
pnpm dev
```

Data accumulates in `data/exhibit.db` (gitignored). Reset it from `/admin`.

## Pages

| Path | What |
|---|---|
| `/exhibit` | The visitor flow: 6 questions → `PRINT RECEIPT` |
| `/receipt?id=…` | The printed receipt (emissions, distribution, archetype) |
| `/` | **Line map** — each chosen route as a grey line, shaded by emissions |
| `/aqi` | **AQI raster** — accumulating emissions field over the city |
| `/admin` | Live counts, purge lines / reset everything |

`/` and `/aqi` are the TouchDesigner inputs. Convention: black background,
brightness rises with emissions (TD can invert via its LUT).

## TouchDesigner layers (URL params)

**Line map `/`** — `basemap` `lines` `recent` `stations` `hud` (0/1), `bg`, `poll` (ms).
Set `basemap=0` for the clean grey-on-black input.

**AQI raster `/aqi`:**

| Param | Default | Meaning |
|---|---|---|
| `metric` | `pm25` | `pm25` or `co2` |
| `grid` | `raw` | `raw` (annual burden) or `diff` (excess vs a metro-clean choice) |
| `base` | `0` | `1` overlays real observed PM2.5 (PM2.5 only) |
| `decay` | `1.2` | kernel spread (km) |
| `gamma` `invert` `smooth` `bg` `poll` | | display + refresh |

e.g. `/aqi?metric=pm25&grid=diff` shows only the dirty legs glowing.

## Layout

- `src/routes/` — pages + API (`/api/receipt`, `/api/lines`, `/api/aqi`, `/api/stats`, `/api/admin`)
- `src/lib/exhibit/` — questions, routing, emission factors (`emissions.ts`), grey buckets (`grey.ts`)
- `src/lib/server/` — `db.ts` (SQLite), `computeReceipt.ts`, `aqiGrid.ts`, baked `aqiBase.json`
- `src/lib/components/` — `Map`, `AccumulationMap`, `AqiRaster`
- `static/*.geojson` — metro network geometry

Emissions methodology and sources: [`docs/emissions-methodology.md`](docs/emissions-methodology.md).

## AI Declaration

Code and documentation in this repository were written with assistance from Claude.
