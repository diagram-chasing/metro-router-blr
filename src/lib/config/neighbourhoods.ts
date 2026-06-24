// The legible layer of the health map: a hand-picked set of well-known Bengaluru
// neighbourhoods, each anchoring one aggregated ±months number on the wall. These
// are curated (not derived from the metro stations in stations.ts) so the labels
// read as places, not station codes, and stay sparse enough to never clutter.
//
// `c` is the [lng, lat] label anchor; `r` is the aggregation radius in km — every
// grid cell whose centre falls within r of c contributes to that zone's number.
// All anchors sit inside the emissions grid bbox [77.4499,12.8235 → 77.7899,13.1535].

export type Neighbourhood = {
	name: string;
	c: [number, number]; // [lng, lat]
	r: number; // km
};

export const NEIGHBOURHOODS: Neighbourhood[] = [
	{ name: 'Hebbal', c: [77.597, 13.0358], r: 2.0 },
	{ name: 'Yelahanka', c: [77.596, 13.1007], r: 2.4 },
	{ name: 'Yeshwanthpur', c: [77.55, 13.028], r: 2.0 },
	{ name: 'Malleshwaram', c: [77.57, 13.0035], r: 1.8 },
	{ name: 'Rajajinagar', c: [77.555, 12.991], r: 1.8 },
	{ name: 'MG Road', c: [77.609, 12.975], r: 1.6 },
	{ name: 'Indiranagar', c: [77.6408, 12.9719], r: 1.8 },
	{ name: 'KR Puram', c: [77.701, 12.996], r: 2.2 },
	{ name: 'Whitefield', c: [77.75, 12.9698], r: 2.6 },
	{ name: 'Marathahalli', c: [77.697, 12.956], r: 2.0 },
	{ name: 'Koramangala', c: [77.6245, 12.9352], r: 1.8 },
	{ name: 'BTM Layout', c: [77.61, 12.9165], r: 1.8 },
	{ name: 'Jayanagar', c: [77.5833, 12.925], r: 1.8 },
	{ name: 'Banashankari', c: [77.546, 12.918], r: 2.0 },
	{ name: 'JP Nagar', c: [77.585, 12.908], r: 1.8 },
	{ name: 'Electronic City', c: [77.677, 12.8452], r: 2.6 }
];
