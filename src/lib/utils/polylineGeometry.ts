// Projects each stop onto its closest segment. The nearest-vertex shortcut left
// cropped bus polylines off the actual road and sometimes returned the wrong span.

export type LngLat = [number, number];

export function pointDistance(p1: LngLat, p2: LngLat): number {
	const dx = p2[0] - p1[0];
	const dy = p2[1] - p1[1];
	return Math.sqrt(dx * dx + dy * dy);
}

export function closestPointOnSegment(
	point: LngLat,
	segmentStart: LngLat,
	segmentEnd: LngLat
): LngLat {
	const [px, py] = point;
	const [x1, y1] = segmentStart;
	const [x2, y2] = segmentEnd;
	const dx = x2 - x1;
	const dy = y2 - y1;
	const lengthSquared = dx * dx + dy * dy;
	if (lengthSquared === 0) return segmentStart;
	const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared));
	return [x1 + t * dx, y1 + t * dy];
}

export type ClosestOnPolyline = {
	point: LngLat | null;
	segmentIndex: number;
	distance: number;
};

export function findClosestPointOnPolyline(
	point: LngLat,
	coordinates: LngLat[]
): ClosestOnPolyline {
	let minDistance = Infinity;
	let closestPoint: LngLat | null = null;
	let closestSegmentIndex = -1;

	for (let i = 0, len = coordinates.length - 1; i < len; i++) {
		const projected = closestPointOnSegment(point, coordinates[i], coordinates[i + 1]);
		const distance = pointDistance(point, projected);
		if (distance < minDistance) {
			minDistance = distance;
			closestPoint = projected;
			closestSegmentIndex = i;
		}
	}

	return { point: closestPoint, segmentIndex: closestSegmentIndex, distance: minDistance };
}

export function cropPolylineBetweenPoints(
	coordinates: LngLat[],
	startPoint: LngLat,
	endPoint: LngLat
): LngLat[] {
	if (!coordinates || coordinates.length < 2) return coordinates;

	const startClosest = findClosestPointOnPolyline(startPoint, coordinates);
	const endClosest = findClosestPointOnPolyline(endPoint, coordinates);
	if (!startClosest.point || !endClosest.point) return coordinates;

	let actualStart = startClosest;
	let actualEnd = endClosest;

	if (startClosest.segmentIndex > endClosest.segmentIndex) {
		actualStart = endClosest;
		actualEnd = startClosest;
	} else if (startClosest.segmentIndex === endClosest.segmentIndex) {
		const segStart = coordinates[startClosest.segmentIndex];
		const segEnd = coordinates[startClosest.segmentIndex + 1];
		const calcT = (p: LngLat) => {
			const dx = segEnd[0] - segStart[0];
			const dy = segEnd[1] - segStart[1];
			const len2 = dx * dx + dy * dy;
			if (len2 === 0) return 0;
			return Math.max(
				0,
				Math.min(1, ((p[0] - segStart[0]) * dx + (p[1] - segStart[1]) * dy) / len2)
			);
		};
		if (calcT(actualStart.point!) > calcT(actualEnd.point!)) {
			actualStart = endClosest;
			actualEnd = startClosest;
		}
	}

	const cropped: LngLat[] = [actualStart.point!];
	const sIdx = actualStart.segmentIndex;
	const eIdx = actualEnd.segmentIndex;

	if (sIdx < eIdx) {
		for (let i = sIdx + 1; i <= eIdx; i++) {
			const c = coordinates[i];
			if (c && c.length >= 2) cropped.push(c);
		}
	}

	if (
		actualEnd.point &&
		(cropped[cropped.length - 1][0] !== actualEnd.point[0] ||
			cropped[cropped.length - 1][1] !== actualEnd.point[1])
	) {
		cropped.push(actualEnd.point);
	}

	// If the caller passed startPoint==endPoint, or the projection collapsed,
	// fall back to the original — the renderer can deal with a too-long line
	// better than with a zero-length one.
	return cropped.length >= 2 ? cropped : coordinates;
}
