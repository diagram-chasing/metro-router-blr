// Data feed for the wall: the same endpoints and cadence FlowMap polls, factored out
// so the flow field and (later) FlowMap can share them. The component keeps the
// stateful bookkeeping (seen ids, lastId, buffers); these are pure fetches.

import type { Field } from '$lib/viz/emissionsField';
import type { WireLine } from '$lib/viz/tripsData';

export type Stats = { count: number; avgCo2PerTripKg: number; avgCo2PerKmG: number };

export async function fetchLines(sinceId: number): Promise<WireLine[]> {
	const res = await fetch(`/api/lines?sinceId=${sinceId}`);
	const { lines } = (await res.json()) as { lines: WireLine[] };
	return lines;
}

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);

export type EmissionsSnapshot = { raw: Field; cf: Field; stats: Stats; savedPct: number | null };

export async function fetchEmissions(shift: number, decay = 1.2): Promise<EmissionsSnapshot> {
	const [rawRes, cfRes, statsRes] = await Promise.all([
		fetch(`/api/emissions?grid=raw&decay=${decay}`),
		fetch(`/api/emissions?grid=cf&shift=${shift}&decay=${decay}`),
		fetch('/api/stats')
	]);
	const raw = (await rawRes.json()) as Field;
	const cf = (await cfRes.json()) as Field;
	const stats = (await statsRes.json()) as Stats;
	const rawTotal = sum(raw.values) * raw.rawMax;
	const cfTotal = sum(cf.values) * cf.rawMax;
	const savedPct = rawTotal > 0 ? Math.round((1 - cfTotal / rawTotal) * 100) : null;
	return { raw, cf, stats, savedPct };
}
