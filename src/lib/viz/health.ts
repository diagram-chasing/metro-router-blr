// Concentration → months of life lost: a tunable *communicative* model (NOT an
// epidemiological prediction). Per cell:
//   concentration_µg = base_scale·baseline(ACAG PM2.5) + our_gain_per_year·years·ourIntensity
//   months_lost      = max(0, concentration_µg − clean_µg) · 0.098 · 12
// `baseline` is the ACAG annual-mean PM2.5 surface (µg/m³, total ambient — traffic included),
// baked to the wall grid; `ourIntensity` (0..1) is the accumulating commute field laid on top.
// Every constant below is a knob.

export const Params = {
	clean_ug: 5, // AQLI reference concentration (WHO guideline), µg/m³
	base_scale: 1, // unit calibration trim on the ACAG PM2.5 baseline (already µg/m³)
	our_gain_per_year: 1.5, // commute increment → µg/m³ per year at the busiest cell; a defensible
	// fraction of a ~31 µg/m³ real ambient baseline (+15 µg/m³ over the decade). Tunable knob.
	years: 10, // our data is presented compounded over this many years
	aqli_coeff: 0.098, // AQLI: years of life lost per 1 µg/m³ sustained PM2.5
	clamp_ceiling: 600 // months — safety cap only; real values sit well below
} as const;

// months of life lost for a resident breathing `ug` µg/m³ (annual average).
export function monthsFromConcentration(ug: number): number {
	const yearsLost = Math.max(0, ug - Params.clean_ug) * Params.aqli_coeff;
	return Math.min(Params.clamp_ceiling, yearsLost * 12);
}
