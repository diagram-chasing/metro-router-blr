// Concentration → months of life lost. A deliberately simple, tunable *communicative*
// model — NOT an epidemiological prediction. We build a pollution concentration per
// cell from two layers and read months off it via the AQLI coefficient:
//
//   concentration_µg = base_scale · baseline(CHETNA CO₂)            // resting city air
//                     + our_gain_per_year · years · ourIntensity     // a decade of the
//                                                                    //   submitted commutes
//   months_lost      = max(0, concentration_µg − clean_µg) · 0.098 · 12
//
// `baseline` is the avg CO₂ grid in src/lib/assets (co02.tif), baked to the wall grid
// (static/baseline-grid.json), used here as a PM2.5-equivalent proxy for resting air —
// a deliberate simplification for the installation, not a literal CO₂→health claim.
// `ourIntensity` is the normalised (0..1) accumulating commute field from /api/emissions.
//
// Every constant is a knob. base_scale and our_gain_per_year set the relative weight of
// "the city you already breathe" vs "what these commutes add over ten years".

export const Params = {
	clean_ug: 5, // AQLI reference concentration (WHO guideline), µg/m³
	base_scale: 22, // CHETNA CO₂ value → µg/m³ PM2.5-equivalent (resting baseline)
	our_gain_per_year: 9, // our normalised commute increment → µg/m³ per year, at the busiest cell
	years: 10, // our data is presented compounded over this many years
	aqli_coeff: 0.098, // AQLI: years of life lost per 1 µg/m³ sustained PM2.5
	clamp_ceiling: 600 // months — safety cap only; real values sit well below
} as const;

// months of life lost for a resident breathing `ug` µg/m³ (annual average).
export function monthsFromConcentration(ug: number): number {
	const yearsLost = Math.max(0, ug - Params.clean_ug) * Params.aqli_coeff;
	return Math.min(Params.clamp_ceiling, yearsLost * 12);
}
