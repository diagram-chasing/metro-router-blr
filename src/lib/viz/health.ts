// Concentration → months of life lost. A deliberately simple, tunable *communicative*
// model — NOT an epidemiological prediction. We build a pollution concentration per
// cell from two layers and read months off it via the AQLI coefficient:
//
//   concentration_µg = base_scale · baseline(ACAG PM2.5)            // resting city air
//                     + our_gain_per_year · years · ourIntensity     // a decade of the
//                                                                    //   submitted commutes
//   months_lost      = max(0, concentration_µg − clean_µg) · 0.098 · 12
//
// `baseline` is the ACAG satellite-derived annual-mean PM2.5 surface (µg/m³, 2023 —
// the same product AQLI is built on), baked to the wall grid (static/baseline-grid.json).
// It is *total* ambient PM2.5: it already includes the city's existing traffic. base_scale
// is just a unit calibration trim (≈1) now that the values are real µg/m³, not a fudge.
// `ourIntensity` is the normalised (0..1) accumulating commute field from /api/emissions —
// the *additional* journeys these visitors draw, sitting on the air the city already breathes.
//
// Every constant is a knob. base_scale and our_gain_per_year set the relative weight of
// "the city you already breathe" vs "what these extra commutes add over ten years".

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
