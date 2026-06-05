// Server-side Nominatim reverse geocoder. Used by the receipt POST to turn
// raw map coords into a Bangalore-area name (Indiranagar, Lalbagh, etc.)
// when the user didn't pick a metro station.

const CACHE = new Map<string, string | null>();
const TIMEOUT_MS = 2500;
const USER_AGENT = 'bmrcl-commute-receipt/1.0 (exhibit)';

function roundKey(lat: number, lng: number): string {
	// ~11 m precision is plenty for an area name lookup.
	return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

type NominatimResponse = {
	address?: {
		suburb?: string;
		neighbourhood?: string;
		quarter?: string;
		city_district?: string;
		locality?: string;
		residential?: string;
		hamlet?: string;
		village?: string;
	};
	name?: string;
};

export async function reverseGeocodeArea(lat: number, lng: number): Promise<string | null> {
	const key = roundKey(lat, lng);
	if (CACHE.has(key)) return CACHE.get(key) ?? null;

	const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=16&addressdetails=1`;
	const ac = new AbortController();
	const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
	try {
		const res = await fetch(url, {
			headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
			signal: ac.signal
		});
		if (!res.ok) {
			CACHE.set(key, null);
			return null;
		}
		const data = (await res.json()) as NominatimResponse;
		const a = data.address ?? {};
		const area =
			a.suburb ||
			a.neighbourhood ||
			a.quarter ||
			a.residential ||
			a.city_district ||
			a.locality ||
			a.hamlet ||
			a.village ||
			null;
		CACHE.set(key, area);
		return area;
	} catch {
		// Network/timeout/abort: cache the miss for this kiosk session so we
		// don't keep retrying a flaky upstream during a single receipt POST.
		CACHE.set(key, null);
		return null;
	} finally {
		clearTimeout(t);
	}
}
