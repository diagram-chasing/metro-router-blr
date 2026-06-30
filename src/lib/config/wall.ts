import { WALL_BG, divergingAt, legColor, muteToNeutral, rgbToHex } from '$lib/viz/palette';

// The wall's one control panel. Everything tunable lives here — nothing is read from the URL.
export const WALL = {

	scale: 1, // type size for viewing distance
	bg: WALL_BG,
	dpr: 0, // 0 = auto-detect
	demo: false, // synthetic attract loop

	// Motion / feel
	idle: 3, // ambient field shimmer
	drift: 1, // camera wander
	titleEvery: 28, // s between banner appearances (now alternates two messages: spread ↔ AQI sentence)
	load: 10, // s pre-reveal dwell (the teaser slip + camera lean fill it now)


	gainPerYear: 1.5, // µg/m³ a saturated corridor adds per year (colour ramp top)
	years: 10, // decade window (also the per-route card's g PM2.5 / 10yr figure)
	saturationRoutes: 60, // represented-corridor overlap that brings a corridor to the red point


	basemap: {
		includeFaint: false, // secondary-and-above only — no minor/service tier (faint bake is empty)
		fillRatio: 0.12, // dot radius as a fraction of cell; ≥0.5 makes roads continuous, lower = dottier
		minPx: 2, // floor so dots never vanish at the wide resting frame
		maxPx: 400, // cap so deep zoom-ins don't blow the dots up into blobs
		color: '#000000', // dot colour — black stencils the roads over the glowing heat below
		major: { cellM: 90, restOpacity: 0.14, zoomOpacity: 0.95 }, // arteries: tighter grid, bolder
		faint: { cellM: 70, restOpacity: 0.005, zoomOpacity: 0.1 }, // minor/service: coarser, lighter

		water: { cellM: 60, color: rgbToHex(muteToNeutral(divergingAt(0.2), 0.5)), restOpacity: 0.2, zoomOpacity: 0.8 },
		green: { cellM: 75, color: rgbToHex(muteToNeutral(legColor('metro'), 0.6)), restOpacity: 0.37, zoomOpacity: 0.64 }
	},

	// Labels
	maxLabels: 15, // hard cap on simultaneous neighbourhood figures (thinned worst-first + spread)

	// Field / technical
	cell: 0.003, // grid resolution (deg)
	blocky: 1, // heat super-cell size in data cells (1 = native ~330m cells; >1 chunks the field)
	steps: 25, // posterize the heat into N discrete colour/opacity bands (0/<2 = continuous ramp)
	poll: 4000, // ms between server polls
	decayKm: 1.2, // spatial smear radius

	// Route spotlight camera: fit the route to the screen with generous padding so the endpoint name
	// chips (which extend out past the route, mostly horizontally) never run off the screen edge.
	// maxZoom caps tiny trips from over-zooming, which also keeps their chips well inside the frame.
	focus: { padding: { top: 260, bottom: 260, left: 340, right: 340 }, maxZoom: 12.5 },

	// Show pacing (s). hold = the soot number's window; recalc = the distribution chart's window.
	dur: { dim: 0.6, reveal: 1.8, hold: 7, recalc: 8, zoomBack: 1.4, settle: 1.1 },
	dimMin: 0.3,
	idleRest: 1.4,
	hero: { rise: 0.8, hold: 4, fall: 1.2 },
	ambient: { glide: 22, hold: 4 },

	// Rising soot number emitted from the route's centre during a spotlight (replaces the old card).
	emit: { rise: 2.0, risePx: 130 }, // s for the rise+fade; px it floats up (×--wall-scale)
	// Soot-spread banner band draw-in (L→R growth on each appearance).
	spread: { drawIn: 0.9, stagger: 0.06 }, // s per band, s between bands
	// Load-phase anticipation: gentle camera lean toward the incoming route's region.
	loadLean: { zoom: 0.4, frac: 0.45 } // extra zoom levels, fraction of the way to the route centre
};
