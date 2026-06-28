// ── Bangalore car-registration rate ──
// Baked from vehicle-statistics.parquet (RTO data): the 9 Bangalore urban RTOs
// (Bengaluru Central/East/West/North/South, Electronic City, Krishnarajapuram,
// Yelahanka, Jnanabharathi), registration classes Motor Car + Motor Cab + Maxi Cab,
// averaged over full years 2022–2025. Re-derive with scripts/deriveCarsPerYear.py
// if the dataset is refreshed — we never read the parquet at runtime.
const CARS_PER_YEAR = 361606;
const DAILY = CARS_PER_YEAR / 365;

// RTOs only register vehicles during office hours, so spread the day's average
// across this window: the odometer reads 0 before opening, climbs through the day
// and holds the full daily total overnight.
const OPEN_HOUR = 10;
const CLOSE_HOUR = 18;

/** Estimated cars registered across Bangalore so far on `at`'s day, by `at`'s local time. */
export function carsAddedToday(at: Date | number): number {
	const d = typeof at === 'number' ? new Date(at) : at;
	const h = d.getHours() + d.getMinutes() / 60; // local time — matches the receipt's timeLabel
	const frac =
		h <= OPEN_HOUR ? 0 : h >= CLOSE_HOUR ? 1 : (h - OPEN_HOUR) / (CLOSE_HOUR - OPEN_HOUR);
	return Math.round(DAILY * frac);
}
