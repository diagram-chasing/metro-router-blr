// Pure deck.gl layer builders. Each is called from the FlowMap frame loop; the
// animation lives in cheap uniforms (currentTime, t) while geometry buffers only
// regenerate when their `data` reference changes (i.e. on a new arrival).

import type { Deck } from './deck';
import { easeOutCubic } from './palette';
import { LOOP_PERIOD, TRAIL_LENGTH, type LegPath } from './tripsData';

export type Pulse = { lng: number; lat: number; bornAt: number };
export const PULSE_LIFE = 3; // s — arrival ring lifetime

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

// The emissions cloud: a small grid canvas, GPU-upscaled and additively blended
// into a soft glow. Rendered beneath the trails.
export function buildEmissionsLayer(
	deck: Deck,
	image: HTMLCanvasElement,
	bounds: [number, number, number, number]
) {
	return new deck.BitmapLayer({
		id: 'emissions',
		image,
		// BitmapLayer wants [west, south, east, north]; the field bbox already is.
		bounds,
		opacity: 1,
		textureParameters: { minFilter: 'linear', magFilter: 'linear' },
		parameters: {
			blend: true,
			blendColorOperation: 'add',
			blendColorSrcFactor: 'src-alpha',
			blendColorDstFactor: 'one',
			blendAlphaOperation: 'add',
			blendAlphaSrcFactor: 'one',
			blendAlphaDstFactor: 'one'
		}
	});
}

// The colour a dirty trail is pulled toward as the counterfactual engages.
const COOL: [number, number, number] = [60, 206, 210];

// As `transition` rises (0→1), dirty trails (bucket ≥ 2) cool toward teal and
// fade — the visible half of "what if these trips moved to transit".
function tripColor(d: LegPath, transition: number): [number, number, number, number] {
	if (transition < 0.001 || d.bucket < 2) return d.color;
	const k = transition;
	return [
		Math.round(d.color[0] + (COOL[0] - d.color[0]) * 0.6 * k),
		Math.round(d.color[1] + (COOL[1] - d.color[1]) * 0.6 * k),
		Math.round(d.color[2] + (COOL[2] - d.color[2]) * 0.6 * k),
		Math.round(d.color[3] * (1 - 0.55 * k))
	];
}

// The hero: animated comet trails along real route geometry, coloured per leg.
export function buildTripsLayer(deck: Deck, data: LegPath[], t: number, transition = 0) {
	return new deck.TripsLayer({
		id: 'trips',
		data,
		getPath: (d: LegPath) => d.path,
		getTimestamps: (d: LegPath) => d.timestamps,
		getColor: (d: LegPath) => tripColor(d, transition),
		getWidth: (d: LegPath) => d.width,
		widthUnits: 'pixels',
		widthMinPixels: 1.5,
		capRounded: true,
		jointRounded: true,
		fadeTrail: true,
		trailLength: TRAIL_LENGTH,
		currentTime: t % LOOP_PERIOD,
		opacity: 0.92,
		// Quantised so the colour buffer regenerates a handful of times across a
		// toggle, not every frame.
		updateTriggers: { getColor: Math.round(transition * 10) }
	});
}

// A radiating white ring at the origin of each newly-arrived trip.
export function buildArrivalLayer(deck: Deck, pulses: Pulse[], t: number) {
	return new deck.ScatterplotLayer({
		id: 'arrivals',
		data: pulses,
		getPosition: (d: Pulse) => [d.lng, d.lat],
		stroked: true,
		filled: false,
		radiusUnits: 'pixels',
		lineWidthUnits: 'pixels',
		getRadius: (d: Pulse) => 6 + easeOutCubic(clamp01((t - d.bornAt) / PULSE_LIFE)) * 70,
		getLineWidth: 2,
		getLineColor: (d: Pulse) => {
			const a = 1 - clamp01((t - d.bornAt) / PULSE_LIFE);
			return [235, 245, 255, Math.round(210 * a)];
		},
		updateTriggers: { getRadius: t, getLineColor: t }
	});
}
