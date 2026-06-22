# Domain glossary — bmrcl-station-app

The shared language of the exhibit. Names here are load-bearing: a "good seam"
falls on one of these concepts. When a module is named after a concept, the
concept belongs in this file.

## The exhibit

The touchscreen kiosk interaction. A visitor answers a few questions, picks an
origin and destination on a map, compares **route candidates**, and is printed a
**receipt**. Their chosen route also accumulates onto the home-page
**accumulation map**.

## Journey & routing

- **Route candidate** — one ranked way to make the trip (metro / bus / car /
  walk), with its **legs**, geometry, cost and ETA. Built from an OTP itinerary.
- **Leg / segment** — one contiguous stretch of a route in a single mode, as a
  `[lng,lat]` polyline plus a `legKind` (`walk` · `bus` · `metro` · `auto` ·
  `cab`). The atom the carbon model blends over.
- **Journey** — the trip a visitor actually commits to: an origin, a
  destination, and the chosen route's legs.

## The carbon model  *(`$lib/emissions` — Candidate A, shipped)*

The single authority that turns a journey into carbon. **Canonical rule: blend
over the actual legs.** A journey's intensity and per-trip kg are computed from
its real legs (a walk-access leg counts as 0 g/pkm), not from one mode applied to
the whole distance.

- **Blended intensity** — length-weighted g CO₂e per passenger-km across a
  journey's legs (`routeEmissions(legs)`). The honest figure for a multimodal trip.
- **Grey bucket** — blended intensity binned to 0–4; sets the grey a route is
  drawn in on the accumulation map (brighter grey = dirtier, on black). One home
  owns the thresholds (`BUCKET_MAX`); the receipt's dirtiness-band labels derive
  from them, and `$lib/exhibit/grey` keeps only the palette.
- One home owns `haversineKm`/`lengthKm` (the single great-circle math), the
  per-mode factor tables, `legKindToMode`, blended intensity, the bucket, and
  per-trip kg.
- The **counterfactual field** (what-if "shift trips to transit") is a *separate*
  intent that reuses the same primitives — it is not the carbon model's job.

### The receipt follows the route

Both the printed **receipt** and the wall-map **line** describe the route the
visitor planned (Q3), so they read the same `routeEmissions`. The receipt is
characterised by a **trip mode** = the route's primary mode (`chosenKind`); when
no route geometry exists it falls back to the stated mode (Q1) via
`tripEmissions(mode, km)`.

> Caveat: `chosenKind` is coarse (`cab/auto/metro/bus/walk`), so a stated
> `car`/`two_wheeler`/`cab_shared` (Q1) is represented by the route's kind once a
> route is chosen. That is the intended "follow the route" behaviour.

## Receipt

The printed artifact. An ordered op-list rendered two ways from one source:
HTML on screen and ESC/POS bytes on the thermal printer.

- **Beat** — one section of the receipt (mode-rank, corridor, swap, parking,
  archetype…). Each beat has a computation, copy, and a pool of copy variants.
- **Swap** — the best realistic cleaner alternative offered for the same trip.

## The Store  *(deepening target — Candidate B)*

The single seam in front of persistence. One `Store` interface with two
adapters — a SQLite adapter for the running exhibit and an in-memory adapter for
tests. It persists two things that accumulate over a day and survive restarts:

- **submissions** — every visitor's answers + computed receipt + geo snapshot.
- **lines** — the one drawable grey route each visitor chose, for the
  accumulation map.

Writing a submission and its line is one atomic operation (`recordSubmission`).
Nothing else opens the database directly.

## Accumulation map

The home-page map onto which every committed journey is drawn as a grey **line**,
shaded by its grey bucket. The **emissions field** (`buildField`) is a spatial
grid derived from the accumulated lines.
