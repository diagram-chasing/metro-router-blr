// Concentration → months of life lost: a tunable *communicative* model (NOT an
// epidemiological prediction). Per cell:
//   concentration_µg = base_scale·baseline(ACAG PM2.5) + commute increment (see choroplethField)
//   months_lost      = max(0, concentration_µg − clean_µg) · aqli_coeff · 12
// `baseline` is the ACAG annual-mean PM2.5 surface (µg/m³, total ambient — traffic included),
// baked to the wall grid. The commute layer's scale (gain/years/saturation) lives in config/wall.ts.

export const Params = {
	clean_ug: 5, // AQLI reference concentration (WHO guideline), µg/m³
	base_scale: 1, // unit calibration trim on the ACAG PM2.5 baseline (already µg/m³)
	aqli_coeff: 0.098, // AQLI: years of life lost per 1 µg/m³ sustained PM2.5
	clamp_ceiling: 600 // months — safety cap only; real values sit well below
} as const;

// months of life lost for a resident breathing `ug` µg/m³ (annual average).
export function monthsFromConcentration(ug: number): number {
	const yearsLost = Math.max(0, ug - Params.clean_ug) * Params.aqli_coeff;
	return Math.min(Params.clamp_ceiling, yearsLost * 12);
}

// ── Attribution headline ───────────────────────────────────────────────────────
// The wall headline is NOT an addition on top of ambient (ambient already includes traffic — that
// would double-count). It is the SHARE of the city's transport-attributable years of life lost that
// the commutes logged so far reveal. Two real measurements combine: a per-capita ceiling (the
// transport slice of the ambient AQLI burden) × `coverage` (the fraction of the city's measured
// vehicular PM2.5 the logged corridors represent, deduped — see emissionsGrid). It grows with
// coverage and saturates at the ceiling, so it can never claim to have mapped more traffic than exists.
export const Attribution = {
	// Share of AMBIENT PM2.5 CONCENTRATION attributable to road transport (source-apportionment).
	// NOT the 68% PM10 *emission* share (a different quantity). Indian-metro PM2.5 apportionment for
	// transport ≈ 30–45%; 0.40 is the single tunable scientific input here and sets the ceiling linearly.
	transport_pm25_share: 0.4,
	// Bengaluru measured annual vehicular PM2.5 inventory (CSTEP 2023, Table 7) — the saturation
	// denominator: when the logged corridors' represented PM2.5 equals this, coverage = 1.
	city_vehicular_pm25_tpa: 4152,
	// ACAG annual-mean PM2.5 over the city grid (static/baseline-grid.json mean) — the ambient level
	// whose transport slice we apportion. Stable city figure, not corridor-dependent.
	ref_ambient_ug: 30.96,
	// People breathing the modelled airshed (CSTEP 2023: "the city's population has burgeoned to more
	// than 12 million"). Same study/region as the emission factors and the vehicular PM2.5 inventory,
	// so the person-years figure is internally consistent. Conservative — the cited floor, not a 2024
	// estimate. (Future upgrade: a gridded population raster summed over the bbox, for per-cell weighting.)
	city_population: 12_000_000
} as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// PER-CAPITA years of life lost attributable to the represented commute traffic = the transport slice
// of the ambient AQLI burden, scaled by how much of the city's vehicular PM2.5 the logged corridors
// cover. Bounded by φ·AQLI(ambient) ≈ 1 yr (the transport share of one resident's burden).
export function attributableYears(coverage: number, ambientUg = Attribution.ref_ambient_ug): number {
	const ambientYears = Math.max(0, ambientUg - Params.clean_ug) * Params.aqli_coeff;
	return Attribution.transport_pm25_share * ambientYears * clamp01(coverage);
}

// AGGREGATE person-years of life lost across the airshed population that the logged corridors reveal
// = per-capita attributable years × city population. A share of an EXISTING citywide burden made
// visible as more of the city's travel is mapped — not harm the journeys themselves add. This is the
// wall's headline; it grows with coverage and saturates at the city's full transport-attributable total.
export function personYearsLost(coverage: number, ambientUg = Attribution.ref_ambient_ug): number {
	return attributableYears(coverage, ambientUg) * Attribution.city_population;
}
