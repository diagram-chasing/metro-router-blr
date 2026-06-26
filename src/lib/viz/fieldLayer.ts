// A BitmapLayer subclass that renders the health field as a GPU-shaded texture.
//
// The split that makes this fast and extensible: the texture carries slow DATA
// (per-cell hue / intensity / ignite / mask, re-uploaded only when the field
// actually changes) and the fragment shader does all PRESENTATION + ANIMATION
// from uniforms (`time`, `dim`, the recalc pulse, …). Adding an effect — heatwave
// flow, contour glow, grain, ripples — is editing the GLSL below against inputs
// that are already wired (the field texture, `geometry.uv` in [0,1] across the
// bbox, and the `fieldFx` uniform block), not re-plumbing the layer. Modelled on
// the Paper shaders vocabulary: an image/shape input + time + a generous knob set.
//
// deck.gl touches window at import time, so this file only TYPE-imports it; the
// real subclass is built from the runtime BitmapLayer via makeFieldLayer() inside
// loadDeck(), keeping the heavy bundle out of SSR.

import type { BitmapLayer } from '@deck.gl/layers';
import { glslColorRamp } from './palette';

// Field texel channels (rgba8): the shader reads these by name.
//   R = hue        diverging-ramp parameter t (0..1) from months
//   G = intensity  busyness 0..1 (drives opacity / glow; the "shape" for effects)
//   B = ignite     route-reveal bloom 0..1 (transient, sequential)
//   A = mask       1 where the cell carries exposure, 0 = empty (basemap shows)

// std140 uniform block. Order here MUST match `uniformTypes` below — the GLSL
// compiler and luma compute the same std140 offsets from the same declaration
// order, so they stay in agreement. Keep floats grouped, vec2 on an 8-byte slot.
const uniformBlock = /* glsl */ `
layout(std140) uniform fieldFxUniforms {
  float time;          // seconds, monotonic — the animation driver
  float dim;           // submit-animation background dim (0..1)
  float recalcStart;   // recalc start time (s); recalcDur<=0 disables
  float recalcDur;     // recalc duration (s)
  vec2  recalcOrigin;  // recalc origin in uv (fallback when no path)
  float aspect;        // bbox width/height, to keep distances isotropic on screen
  float scale;         // reserved: zoom for procedural effects (default 1)
  vec2  gridSize;      // (cols, rows) — for grid lines and per-cell flicker
  float noise;         // reserved: grain amount 0..1 (default 0)
  // The recalc route, resampled to 8 points (uv), packed 2/vec4 — the ring radiates
  // as an offset curve of THIS path, not a circle from a centroid.
  vec4  pathA;
  vec4  pathB;
  vec4  pathC;
  vec4  pathD;
  float pathCount;     // number of valid points (2..8); <2 → circle fallback
} fieldFx;
`;

export const fieldFxUniforms = {
	name: 'fieldFx',
	vs: uniformBlock,
	fs: uniformBlock,
	uniformTypes: {
		time: 'f32',
		dim: 'f32',
		recalcStart: 'f32',
		recalcDur: 'f32',
		recalcOrigin: 'vec2<f32>',
		aspect: 'f32',
		scale: 'f32',
		gridSize: 'vec2<f32>',
		noise: 'f32',
		pathA: 'vec4<f32>',
		pathB: 'vec4<f32>',
		pathC: 'vec4<f32>',
		pathD: 'vec4<f32>',
		pathCount: 'f32'
	}
} as const;

type V4 = [number, number, number, number];

export type FieldFxProps = {
	time: number;
	dim: number;
	recalcStart: number;
	recalcDur: number;
	recalcOrigin: [number, number];
	aspect: number;
	scale: number;
	gridSize: [number, number];
	noise: number;
	pathA: V4;
	pathB: V4;
	pathC: V4;
	pathD: V4;
	pathCount: number;
};

const FIELDFX_DEFAULTS: FieldFxProps = {
	time: 0,
	dim: 1,
	recalcStart: 0,
	recalcDur: 0,
	recalcOrigin: [0.5, 0.5],
	aspect: 1,
	scale: 1,
	gridSize: [1, 1],
	noise: 0,
	pathA: [0, 0, 0, 0],
	pathB: [0, 0, 0, 0],
	pathC: [0, 0, 0, 0],
	pathD: [0, 0, 0, 0],
	pathCount: 0
};

// ── GLSL library (injected once, at fs:#decl) ──
// Everything an effect needs lives here. `bitmapTexture` (the field) and
// `geometry.uv` are in scope inside the colour hook, so helpers can re-sample
// neighbours (contour / gradient / flow) — not just the current texel.
const FIELD_LIB = /* glsl */ `
${glslColorRamp('fieldRamp')}

// Opacity follows busyness: a soft floor so faint cells still read, ramping to full.
float fieldOpacity(float intensity) {
  return (54.0 + 192.0 * pow(clamp(intensity, 0.0, 1.0), 0.6)) / 255.0;
}

// Cheap hash + value noise — for the recalc flicker now, grain/flow effects later.
float fieldHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// 4x4 ordered (Bayer) dither in [0,1) — breaks the ramp into a blocky stipple.
float fieldBayer(vec2 px) {
  float m[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
  int i = int(mod(px.x, 4.0)) + int(mod(px.y, 4.0)) * 4;
  return m[i] / 16.0;
}

// Grid-line mask: ~1 on cell borders, 0 inside — AA'd against cell size so it
// stays a crisp one-pixel lattice at any zoom. Sells the "grid" read.
float fieldGrid(vec2 uv) {
  vec2 c = uv * fieldFx.gridSize;
  vec2 g = abs(fract(c) - 0.5);
  vec2 w = fwidth(c);
  vec2 line = smoothstep(vec2(0.5), 0.5 - w, g);
  return max(line.x, line.y);
}

// Distance from p to segment a–b (all in aspect-corrected uv).
float fieldSegDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

// Distance from uv to the recalc ROUTE polyline (aspect-corrected so it's isotropic on
// screen). Falls back to distance-from-origin (a circle) when no path was supplied.
float fieldDistToPath(vec2 uv) {
  vec2 asp = vec2(fieldFx.aspect, 1.0);
  vec2 q = uv * asp;
  int n = int(fieldFx.pathCount + 0.5);
  if (n < 2) return length(q - fieldFx.recalcOrigin * asp);
  vec2 pts[8] = vec2[8](
    fieldFx.pathA.xy, fieldFx.pathA.zw, fieldFx.pathB.xy, fieldFx.pathB.zw,
    fieldFx.pathC.xy, fieldFx.pathC.zw, fieldFx.pathD.xy, fieldFx.pathD.zw);
  float best = 1e9;
  for (int i = 0; i < 7; i++) {
    if (i + 1 >= n) break;
    best = min(best, fieldSegDist(q, pts[i] * asp, pts[i + 1] * asp));
  }
  return best;
}

// Radius of the route (max distance of its points from their centroid, aspect-uv) —
// the natural scale at which an offset of the path still reads AS the path before it
// rounds off into a circle.
float fieldPathRadius() {
  int n = int(fieldFx.pathCount + 0.5);
  if (n < 2) return 0.3;
  vec2 asp = vec2(fieldFx.aspect, 1.0);
  vec2 pts[8] = vec2[8](
    fieldFx.pathA.xy, fieldFx.pathA.zw, fieldFx.pathB.xy, fieldFx.pathB.zw,
    fieldFx.pathC.xy, fieldFx.pathC.zw, fieldFx.pathD.xy, fieldFx.pathD.zw);
  vec2 c = vec2(0.0);
  for (int i = 0; i < 8; i++) { if (i >= n) break; c += pts[i] * asp; }
  c /= float(n);
  float r = 0.0;
  for (int i = 0; i < 8; i++) { if (i >= n) break; r = max(r, length(pts[i] * asp - c)); }
  return r;
}

// The recalc effect, as (ring, region) both eased over the recalc window:
//   x = ring   — a path-shaped pulse radiating outward (the white moment). Travel is
//                scaled to the route's own size and damped as it expands, so it keeps
//                the path's shape instead of rounding into a circle.
//   y = region — a soft mask over the area around the route. The compose step churns
//                this per-cell (a "recalculating" dither) rather than whitening it.
vec2 fieldRecalc(vec2 uv) {
  float dur = fieldFx.recalcDur;
  if (dur <= 0.0) return vec2(0.0);
  float p = (fieldFx.time - fieldFx.recalcStart) / dur;
  if (p < 0.0 || p > 1.6) return vec2(0.0);                 // lingers a beat past the sweep
  // Evaluate at the CELL CENTRE so the effect is gridded, not smooth.
  vec2 cuv = (floor(uv * fieldFx.gridSize) + 0.5) / fieldFx.gridSize;
  float d = fieldDistToPath(cuv);
  float R = fieldPathRadius();
  float env = smoothstep(0.0, 0.22, p) * (1.0 - smoothstep(0.82, 1.6, p)); // eased in/out
  float front = p * R * 0.9;                                // radiate ~ to the path's own size
  float ringAmp = 1.0 - smoothstep(0.0, 1.0, p);           // fade before it rounds to a circle
  float ring = exp(-pow((d - front) / 0.05, 2.0)) * ringAmp * env;
  float region = exp(-pow(d / (R * 0.5 + 0.01), 2.0)) * env;
  return vec2(ring, region);
}
`;

// ── GLSL composition (injected at fs:DECKGL_FILTER_COLOR) ──
// `color` arrives as the raw field texel (tint/desaturate are left default, so rgb
// passes through untouched); we decode the channels and rebuild the pixel.
const FIELD_COMPOSE = /* glsl */ `
  float fHue = color.r;
  float fInt = color.g;
  float fIgnite = color.b;
  float fMask = color.a;

  vec3 rgb = fieldRamp(fHue);
  float a = fieldOpacity(fInt);

  // Empty cell: a barely-there fill so the dotted basemap reads through, while the
  // grid lines below still draw the lattice across the bbox.
  if (fMask < 0.5 && fInt < 0.004) {
    rgb = vec3(40.0, 48.0, 64.0) / 255.0;
    a = 8.0 / 255.0;
  }

  // Neutral luminance dither — a blocky stipple. (Alpha-dither would stipple the
  // cool/navy underlayer in and out and read as blue speckle.)
  rgb *= 1.0 + (fieldBayer(gl_FragCoord.xy) - 0.5) * 0.12;

  // Dim the background field during a submit — the pulse and route ride over it.
  a *= fieldFx.dim;

  // Recalc moment. The AREA around the route "recalculates": each cell flips through
  // heat VALUES (a value scramble), then settles as the region fades — not a white wash.
  // Only the radiating ring goes whitish, and faintly.
  vec2 rc = fieldRecalc(geometry.uv);
  if (rc.y > 0.0 && fMask > 0.5) {
    vec2 cell = floor(geometry.uv * fieldFx.gridSize);
    float step = mod(floor(fieldFx.time * 11.0), 97.0);      // discrete churn steps
    // Jitter the cell's OWN value, not a random one — warm stays warm, cool stays cool.
    float jitter = (fieldHash(cell + step) - 0.5) * 0.18;
    vec3 scrambled = fieldRamp(clamp(fHue + jitter, 0.0, 1.0));
    rgb = mix(rgb, scrambled, clamp(rc.y * 0.8, 0.0, 1.0));
    a = max(a, clamp(rc.y * 0.4, 0.0, 1.0));                  // bring churning cells up to read
  }
  if (rc.x > 0.0) {
    rgb = mix(rgb, vec3(244.0, 248.0, 255.0) / 255.0, clamp(0.42 * rc.x, 0.0, 1.0));
    a = max(a, clamp(0.34 * rc.x, 0.0, 1.0));
  }

  // Route ignite: a bright, blocky line travelling cell by cell.
  if (fIgnite > 0.0) {
    rgb = mix(rgb, vec3(255.0, 247.0, 228.0) / 255.0, clamp(fIgnite * 1.2, 0.0, 1.0));
    a = max(a, clamp(fIgnite * 1.15, 0.0, 1.0));
  }

  // Grid lines LAST, so the dark lattice reads across the field, the pulse and the route.
  rgb *= 1.0 - 0.30 * fieldGrid(geometry.uv);

  color = vec4(rgb, clamp(a, 0.0, 1.0));
`;

// The field data the layer turns into its texture. A new object ref signals a change
// (deck diffs props by reference), so passing the same ref means "no re-upload".
export type FieldImage = { width: number; height: number; data: Uint8Array };

type LumaTexture = {
	width: number;
	height: number;
	destroy(): void;
	copyImageData(opts: { data: Uint8Array }): void;
	setSampler(s: Record<string, unknown>): void;
};

const samplerFor = (smooth: boolean) => {
	const f = smooth ? 'linear' : 'nearest';
	return { minFilter: f, magFilter: f, addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' };
};

// Build the FieldLayer class from the runtime BitmapLayer (passed in by loadDeck
// so the static deck import stays out of this module / out of SSR).
//
// We own the texture rather than going through BitmapLayer's async `image` prop:
// that path silently produced an empty (all-zero) texture, so the field never
// rendered. Instead `fieldData` (raw rgba8) is uploaded straight to a device
// texture and bound as `bitmapTexture` in draw(); the inherited bitmap fragment
// shader samples it and our injected hooks colour it.
export function makeFieldLayer(Base: typeof BitmapLayer) {
	class FieldLayer extends (Base as new (...args: unknown[]) => BitmapLayer) {
		static layerName = 'FieldLayer';
		static defaultProps = {
			...(Base as unknown as { defaultProps: object }).defaultProps,
			fieldData: { type: 'object', value: null, compare: true },
			smooth: true,
			...FIELDFX_DEFAULTS
		};

		getShaders() {
			const s = (super.getShaders as () => Record<string, unknown>)();
			const inject = (s.inject ?? {}) as Record<string, string>;
			return {
				...s,
				modules: [...((s.modules as unknown[]) ?? []), fieldFxUniforms],
				inject: {
					...inject,
					'fs:#decl': (inject['fs:#decl'] ?? '') + FIELD_LIB,
					'fs:DECKGL_FILTER_COLOR': (inject['fs:DECKGL_FILTER_COLOR'] ?? '') + FIELD_COMPOSE
				}
			};
		}

		updateState(params: { props: Record<string, unknown>; oldProps: Record<string, unknown> }) {
			(super.updateState as (p: unknown) => void)(params); // builds the quad mesh from `bounds`
			const { props, oldProps } = params;
			if (props.fieldData && props.fieldData !== oldProps.fieldData) {
				this._updateFieldTexture(props.fieldData as FieldImage);
			}
		}

		_updateFieldTexture(img: FieldImage) {
			const ctx = this.context as { device: { createTexture(o: Record<string, unknown>): LumaTexture } };
			const st = this.state as { fieldTexture?: LumaTexture };
			const smooth = (this.props as unknown as { smooth: boolean }).smooth !== false;
			let tex = st.fieldTexture;
			if (!tex || tex.width !== img.width || tex.height !== img.height) {
				tex?.destroy();
				tex = ctx.device.createTexture({
					width: img.width,
					height: img.height,
					format: 'rgba8unorm',
					data: img.data,
					mipmaps: false,
					sampler: samplerFor(smooth)
				});
				this.setState({ fieldTexture: tex });
			} else {
				tex.copyImageData({ data: img.data });
				tex.setSampler(samplerFor(smooth));
			}
		}

		draw(opts: { shaderModuleProps?: { picking?: { isActive?: boolean } } }) {
			const st = this.state as {
				model?: { shaderInputs: { setProps: (p: object) => void }; draw: (rp: unknown) => void };
				fieldTexture?: LumaTexture;
				coordinateConversion?: number;
				bounds?: number[];
				disablePicking?: boolean;
			};
			const model = st.model;
			const tex = st.fieldTexture;
			if (!model || !tex) return;
			if (opts.shaderModuleProps?.picking?.isActive && st.disablePicking) return;

			const p = this.props as unknown as FieldFxProps & {
				desaturate: number;
				transparentColor: number[];
				tintColor: number[];
			};
			model.shaderInputs.setProps({
				bitmap: {
					bitmapTexture: tex,
					bounds: st.bounds ?? [0, 0, 0, 0],
					coordinateConversion: st.coordinateConversion ?? 0,
					desaturate: p.desaturate,
					tintColor: p.tintColor.slice(0, 3).map((x) => x / 255),
					transparentColor: p.transparentColor.map((x) => x / 255)
				},
				fieldFx: {
					time: p.time,
					dim: p.dim,
					recalcStart: p.recalcStart,
					recalcDur: p.recalcDur,
					recalcOrigin: p.recalcOrigin,
					aspect: p.aspect,
					scale: p.scale,
					gridSize: p.gridSize,
					noise: p.noise,
					pathA: p.pathA,
					pathB: p.pathB,
					pathC: p.pathC,
					pathD: p.pathD,
					pathCount: p.pathCount
				}
			});
			model.draw((this.context as { renderPass: unknown }).renderPass);
		}

		finalizeState(context: unknown) {
			(super.finalizeState as (c: unknown) => void)(context);
			(this.state as { fieldTexture?: LumaTexture }).fieldTexture?.destroy();
		}
	}
	return FieldLayer;
}

export type FieldLayerClass = ReturnType<typeof makeFieldLayer>;
