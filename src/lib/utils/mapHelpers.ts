import maplibre from 'maplibre-gl';
import { stations } from '$lib/config/stations';
import { JourneyCalculator } from './JourneyCalculator';

export const calculateDistance = (point1: [number, number], point2: [number, number]) => {
	const dx = point1[0] - point2[0];
	const dy = point1[1] - point2[1];
	return Math.sqrt(dx * dx + dy * dy);
};

export const findClosestPointOnSegment = (
	p1: [number, number],
	p2: [number, number],
	p: [number, number]
): [number, number] => {
	const x1 = p1[0],
		y1 = p1[1];
	const x2 = p2[0],
		y2 = p2[1];
	const x = p[0],
		y = p[1];

	const dx = x2 - x1;
	const dy = y2 - y1;
	const segmentLengthSq = dx * dx + dy * dy;

	if (segmentLengthSq === 0) return p1;

	const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / segmentLengthSq));
	return [x1 + t * dx, y1 + t * dy];
};

// Find the nearest point on a line to a given coordinate
export const findNearestPointOnLine = (
	lineCoordinates: [number, number][],
	point: [number, number]
) => {
	let minDistance = Infinity;
	let nearestPoint: [number, number] = lineCoordinates[0];
	let nearestSegmentIndex = 0;

	for (let i = 0; i < lineCoordinates.length - 1; i++) {
		const p1 = lineCoordinates[i];
		const p2 = lineCoordinates[i + 1];
		const closestPoint = findClosestPointOnSegment(p1, p2, point);
		const distance = calculateDistance(closestPoint, point);

		if (distance < minDistance) {
			minDistance = distance;
			nearestPoint = closestPoint;
			nearestSegmentIndex = i;
		}
	}

	// Create a new array with the new point inserted at the appropriate position
	const updatedLineCoordinates = [...lineCoordinates];

	// Insert the nearest point into the line coordinates at the appropriate position
	// We insert after the segment index
	updatedLineCoordinates.splice(nearestSegmentIndex + 1, 0, nearestPoint);

	return {
		point: nearestPoint,
		segmentIndex: nearestSegmentIndex,
		distance: minDistance,
		updatedLineCoordinates
	};
};

// Determine which line color to use based on stations
export const determineLineColor = (sourceStation: string, destinationStation: string) => {
	const sourceStationData = stations.find((s) => s.code === sourceStation);
	const destStationData = stations.find((s) => s.code === destinationStation);

	if (sourceStationData && destStationData) {
		if (sourceStationData.color === destStationData.color) {
			return sourceStationData.color === 'purple' ? '#951A74' : '#0F883B';
		}
		if (sourceStationData.color !== destStationData.color) {
			return 'both';
		}
	}
	return '#951A74';
};

// Pure helper: extract the coordinates of a metro line between two stations
const extractSegmentCoordinates = (
	lineFeature: any,
	startStation: { coordinates: [number, number] },
	endStation: { coordinates: [number, number] }
): [number, number][] => {
	let lineCoordinates = lineFeature.geometry.coordinates;
	if (lineCoordinates.length > 0 && Array.isArray(lineCoordinates[0][0])) {
		lineCoordinates = lineCoordinates.flat();
	}

	const startResult = findNearestPointOnLine(lineCoordinates, startStation.coordinates);
	lineCoordinates = startResult.updatedLineCoordinates;
	const endResult = findNearestPointOnLine(lineCoordinates, endStation.coordinates);
	lineCoordinates = endResult.updatedLineCoordinates;

	const startIndex = Math.min(startResult.segmentIndex, endResult.segmentIndex);
	const endIndex = Math.max(startResult.segmentIndex, endResult.segmentIndex) + 1;

	return lineCoordinates.slice(startIndex, endIndex + 2);
};

// Render full metro line as a faint grey reference
const renderFullLine = (map: maplibre.Map, lineFeature: any, colorName: string) => {
	if (!map) return;

	const layerId = `route-full-${colorName}`;
	const sourceId = `${layerId}-source`;

	if (map.getSource(sourceId)) {
		if (map.getLayer(layerId)) {
			map.removeLayer(layerId);
		}
		map.removeSource(sourceId);
	}

	map.addSource(sourceId, {
		type: 'geojson',
		data: lineFeature
	});

	map.addLayer({
		id: layerId,
		type: 'line',
		source: sourceId,
		layout: {
			'line-join': 'round',
			'line-cap': 'round'
		},
		paint: {
			'line-color': '#D8D8D8',
			'line-width': 1.5
		}
	});
};

// Pure: compute the metro segment(s) between two arbitrary coordinates as GeoJSON.
// Returns null if the nearest stations can't be determined.
export const computeMetroSegments = async (
	origin: { coordinates: [number, number] },
	destination: { coordinates: [number, number] },
	fetcher: typeof fetch = fetch
): Promise<GeoJSON.FeatureCollection | null> => {
	const journeyCalculator = new JourneyCalculator(true, fetcher);
	await journeyCalculator.loadVoronoiData();

	const [sourceStation] = journeyCalculator.findNearestStation(origin.coordinates) || ['', ''];
	const [destinationStation] = journeyCalculator.findNearestStation(destination.coordinates) || [
		'',
		''
	];

	if (!sourceStation || !destinationStation) return null;

	const sourceStationData = stations.find((s) => s.code === sourceStation);
	const destStationData = stations.find((s) => s.code === destinationStation);
	if (!sourceStationData?.coordinates || !destStationData?.coordinates) return null;

	const lineColor = determineLineColor(sourceStation, destinationStation);
	const interchangeStation = stations.find(
		(s) => s.name === 'Nadaprabhu Kempegowda Station, Majestic'
	);

	try {
		const data = await fetcher('/bmrcl.geojson').then((r) => r.json());
		const purpleLineFeatures = data.features.filter(
			(f: any) => f.properties.colour === 'purple'
		);
		const greenLineFeatures = data.features.filter((f: any) => f.properties.colour === 'green');

		const segments: [number, number][][] = [];

		if (lineColor === 'both' && interchangeStation) {
			// Build legs in journey order so animation reads start → interchange → end.
			const legs: Array<{
				start: typeof sourceStationData;
				end: typeof sourceStationData;
				color: string;
			}> = [
				{ start: sourceStationData, end: interchangeStation, color: sourceStationData.color },
				{ start: interchangeStation, end: destStationData, color: destStationData.color }
			];
			for (const leg of legs) {
				const features = leg.color === 'purple' ? purpleLineFeatures : greenLineFeatures;
				if (features.length > 0) {
					segments.push(extractSegmentCoordinates(features[0], leg.start, leg.end));
				}
			}
		} else {
			const colorName = sourceStationData.color;
			const lineFeatures = data.features.filter(
				(f: any) => f.properties.colour === colorName
			);
			if (lineFeatures.length > 0) {
				segments.push(
					extractSegmentCoordinates(lineFeatures[0], sourceStationData, destStationData)
				);
			}
		}

		return {
			type: 'FeatureCollection',
			features: segments.map((coords) => ({
				type: 'Feature',
				properties: {},
				geometry: { type: 'LineString', coordinates: coords }
			}))
		};
	} catch (error) {
		console.error('Error computing metro segments:', error);
		return null;
	}
};

export const renderAllStationsAndLines = async (map: maplibre.Map) => {
	if (!map) return;

	// Fetch the GeoJSON data
	try {
		const response = await fetch('/bmrcl.geojson');
		const data = await response.json();

		// Render both full lines
		const purpleLineFeatures = data.features.filter(
			(feature: any) => feature.properties.colour === 'purple'
		);

		const greenLineFeatures = data.features.filter(
			(feature: any) => feature.properties.colour === 'green'
		);

		if (purpleLineFeatures.length > 0) {
			renderFullLine(map, purpleLineFeatures[0], 'purple');
		}

		if (greenLineFeatures.length > 0) {
			renderFullLine(map, greenLineFeatures[0], 'green');
		}
	} catch (error) {
		console.error('Error fetching or processing GeoJSON:', error);
	}
};
