import { WALL_BG } from '$lib/viz/palette';

// The wall's one control panel. Everything tunable lives here — nothing is read from the URL.
export const WALL = {
	// Display
	title: 'YEARS OF LIFE LOST',
	subtitle: 'FROM THESE COMMUTES',
	scale: 1, // type size for viewing distance
	bg: WALL_BG,
	dpr: 0, // 0 = auto-detect
	demo: false, // synthetic attract loop

	// Motion / feel
	idle: 3, // ambient field shimmer
	drift: 1, // camera wander
	titleEvery: 40, // s between hero appearances
	load: 20, // s pre-reveal dwell

	// Model (PM2.5 → health)
	gainPerYear: 1.5, // µg/m³ a saturated corridor adds per year
	years: 10, // decade window
	saturationRoutes: 60, // commutes that bring a corridor to the red point

	// Field / technical
	cell: 0.003, // grid resolution (deg)
	poll: 4000, // ms between server polls
	decayKm: 1.2, // spatial smear radius

	// Show pacing (s)
	dur: { dim: 0.6, reveal: 1.8, hold: 4.6, recalc: 2.4, zoomBack: 1.4, settle: 1.1 },
	dimMin: 0.3,
	idleRest: 1.4,
	hero: { rise: 0.8, hold: 4, fall: 1.2 },
	ambient: { glide: 22, hold: 4 }
};
