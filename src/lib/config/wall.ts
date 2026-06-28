import { WALL_BG } from '$lib/viz/palette';

// The wall's one control panel. Everything tunable lives here — nothing is read from the URL.
export const WALL = {
	// Display — title + number + subtitle read as one sentence: "BENGALURU LOSES <9L YEARS> TO TRAFFIC LIKE THESE".
	// ("9L YEARS" is the hero figure; the L/cr + YEARS are rendered as a small suffix.) The figure is the
	// aggregate life-years across the city's ~12M residents the logged commutes' corridors reveal (a
	// share of an existing burden, not harm they add); see health.ts / emissionsGrid.ts.
	title: 'BANGALORE LOSES',
	subtitle: 'TO TRAFFIC LIKE THIS',
	scale: 1, // type size for viewing distance
	bg: WALL_BG,
	dpr: 0, // 0 = auto-detect
	demo: false, // synthetic attract loop

	// Motion / feel
	idle: 3, // ambient field shimmer
	drift: 1, // camera wander
	titleEvery: 40, // s between hero appearances
	load: 20, // s pre-reveal dwell

	// Colour scale (PM2.5 → hue only). The HEADLINE no longer uses these — it's the attribution model
	// in $lib/viz/health.ts (transport share φ × ambient AQLI × coverage). These three set where the
	// heat hits its red point on the map; the reported years are independent of them.
	gainPerYear: 1.5, // µg/m³ a saturated corridor adds per year (colour ramp top)
	years: 10, // decade window (also the per-route card's g PM2.5 / 10yr figure)
	saturationRoutes: 60, // represented-corridor overlap that brings a corridor to the red point

	// Labels
	maxLabels: 15, // hard cap on simultaneous neighbourhood figures (thinned worst-first + spread)

	// Field / technical
	cell: 0.003, // grid resolution (deg)
	blocky: 3, // heat super-cell size in data cells (1 = native ~330m cells; >1 chunks the field)
	poll: 4000, // ms between server polls
	decayKm: 1.2, // spatial smear radius

	// Show pacing (s)
	dur: { dim: 0.6, reveal: 1.8, hold: 4.6, recalc: 2.4, zoomBack: 1.4, settle: 1.1 },
	dimMin: 0.3,
	idleRest: 1.4,
	hero: { rise: 0.8, hold: 4, fall: 1.2 },
	ambient: { glide: 22, hold: 4 }
};
