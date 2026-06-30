
import type { BitmapLayer } from '@deck.gl/layers';
import { glslColorRamp } from './palette';

// Texel channels (rgba8): R=hue t (0..1 from months), G=intensity, B=ignite, A=mask (0=empty).

// std140 block — field order MUST match `uniformTypes` below (offsets are derived from each).
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
  float idle;          // master idle-motion amount 0..1 (0 disables); from ?idle=
  vec4  pathA;         // recalc route, 8 uv points packed 2/vec4
  vec4  pathB;
  vec4  pathC;
  vec4  pathD;
  float pathCount;     // valid points (2..8); <2 → circle fallback
  float blocky;        // heat super-cell size in grid cells (1 = native; >1 chunks the field)
  float steps;         // posterize the heat into N discrete bands (<2 = continuous ramp)
  float dither;        // ordered-dither amount 0..1 (0 = smooth heat; 1 = full 1-bit stipple)
  float ditherType;    // Bayer matrix size: 2 | 4 | 8
  float ditherPx;      // dither grid cell size in device pixels
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
    idle: 'f32',
    pathA: 'vec4<f32>',
    pathB: 'vec4<f32>',
    pathC: 'vec4<f32>',
    pathD: 'vec4<f32>',
    pathCount: 'f32',
    blocky: 'f32',
    steps: 'f32',
    dither: 'f32',
    ditherType: 'f32',
    ditherPx: 'f32'
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
  idle: number;
  pathA: V4;
  pathB: V4;
  pathC: V4;
  pathD: V4;
  pathCount: number;
  blocky: number;
  steps: number;
  dither: number;
  ditherType: number;
  ditherPx: number;
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
  idle: 2,
  pathA: [0, 0, 0, 0],
  pathB: [0, 0, 0, 0],
  pathC: [0, 0, 0, 0],
  pathD: [0, 0, 0, 0],
  pathCount: 0,
  blocky: 1,
  steps: 0,
  dither: 0,
  ditherType: 4,
  ditherPx: 3
};


const FIELD_LIB = /* glsl */ `
${glslColorRamp('fieldRamp')}

// Opacity from busyness: soft floor so faint cells still read, ramping to full.
float fieldOpacity(float intensity) {
  return (70.0 + 196.0 * pow(clamp(intensity, 0.0, 1.0), 0.52)) / 255.0;
}

// Cheap hash for the recalc flicker.
float fieldHash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// 4x4 ordered (Bayer) dither in [0,1) — a blocky stipple.
float fieldBayer(vec2 px) {
  float m[16] = float[16](0.,8.,2.,10., 12.,4.,14.,6., 3.,11.,1.,9., 15.,7.,13.,5.);
  int i = int(mod(px.x, 4.0)) + int(mod(px.y, 4.0)) * 4;
  return m[i] / 16.0;
}

// Ordered (Bayer) dither threshold in (0,1) at integer cell coords, for 2x2 / 4x4 / 8x8 matrices
// (the paper-design dithering shader's matrices). +0.5 centres each threshold so a level never goes
// fully on at 0; this is the per-pixel cutoff a continuous coverage is compared against to stipple it.
float fieldDither(vec2 px, int size) {
  if (size <= 2) {
    int m2[4] = int[4](0, 2, 3, 1);
    int i = int(mod(px.x, 2.0)) + int(mod(px.y, 2.0)) * 2;
    return (float(m2[i]) + 0.5) / 4.0;
  } else if (size <= 4) {
    return (fieldBayer(px) * 16.0 + 0.5) / 16.0;
  }
  int m8[64] = int[64](
    0, 32, 8, 40, 2, 34, 10, 42, 48, 16, 56, 24, 50, 18, 58, 26,
    12, 44, 4, 36, 14, 46, 6, 38, 60, 28, 52, 20, 62, 30, 54, 22,
    3, 35, 11, 43, 1, 33, 9, 41, 51, 19, 59, 27, 49, 17, 57, 25,
    15, 47, 7, 39, 13, 45, 5, 37, 63, 31, 55, 23, 61, 29, 53, 21);
  int i = int(mod(px.x, 8.0)) + int(mod(px.y, 8.0)) * 8;
  return (float(m8[i]) + 0.5) / 64.0;
}

// Render-cell count: the native grid coarsened by the blocky factor so the heat reads as chunky
// super-cells (the data grid is fine — ~330m — so at native res the blocks are tiny and look
// like a smooth gradient). blocky=1 → native grid. Floored so cells stay whole and aligned.
vec2 fieldCells() {
  return max(floor(fieldFx.gridSize / max(fieldFx.blocky, 1.0)), vec2(1.0));
}

// Snap a uv to the centre of its super-cell, so re-sampling the (nearest-filtered) field texture
// there picks one representative value for the whole block — chunking the heat without touching data.
vec2 fieldBlockUV(vec2 uv) {
  vec2 cells = fieldCells();
  return (floor(uv * cells) + 0.5) / cells;
}

// The super-cell texel, sampled once in main() (where bitmapTexture is in scope) and read back in
// the colour hook — that hook is a separate function assembled before the texture's declaration, so
// it can't sample the texture itself.
vec4 fieldBlockTexel;

// Grid-line mask: 1 on cell borders, 0 inside, AA'd to a crisp 1px lattice at any zoom. Drawn on
// the super-cell grid so the lattice frames the chunky blocks rather than the fine data cells.
float fieldGrid(vec2 uv) {
  vec2 c = uv * fieldCells();
  vec2 g = abs(fract(c) - 0.5);
  vec2 w = fwidth(c);
  vec2 line = smoothstep(vec2(0.5), 0.5 - w, g);
  return max(line.x, line.y);
}

// Distance from p to segment a–b (aspect-corrected uv).
float fieldSegDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  return length(pa - ba * h);
}

// Distance from uv to the recalc route polyline; circle fallback (distance-from-origin) when no path.
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

// Route radius: max distance of its points from their centroid (aspect-uv).
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

// Recalc effect as (ring, region), both eased over the recalc window: ring = a path-shaped
// pulse radiating outward; region = a soft mask over the area around the route (churned per-cell).
vec2 fieldRecalc(vec2 uv) {
  float dur = fieldFx.recalcDur;
  if (dur <= 0.0) return vec2(0.0);
  float p = (fieldFx.time - fieldFx.recalcStart) / dur;
  if (p < 0.0 || p > 1.6) return vec2(0.0);                 // lingers a beat past the sweep
  // Evaluate at the super-cell CENTRE so the sweep is gridded to match the chunky heat blocks.
  vec2 cuv = fieldBlockUV(uv);
  float d = fieldDistToPath(cuv);
  float R = fieldPathRadius();
  float env = smoothstep(0.0, 0.22, p) * (1.0 - smoothstep(0.82, 1.6, p)); // eased in/out
  float front = p * R * 1.05;                               // wavefront sweeps fully across the route
  float ringAmp = 1.0 - smoothstep(0.0, 1.0, p);           // fade before it rounds to a circle
  float ring = exp(-pow((d - front) / 0.06, 2.0)) * ringAmp * env;
  float region = exp(-pow(d / (R * 0.7 + 0.01), 2.0)) * env;
  return vec2(ring, region);
}

// ── Idle ambience knobs (faint motion at rest; gated by idle*dim at the call site) ──
const float IDLE_CAUSTIC_SCALE  = 0.6;  // spatial freq of the "living air" veins
const float IDLE_CAUSTIC_AMP    = 0.12; // max added alpha for the veins in empty cells
const float IDLE_HAZE_SPEED     = 0.06; // corridor heat-haze travel speed
const float IDLE_HAZE_AMP       = 0.10; // max warm glow added over hot corridors
const float IDLE_GRAIN_AMP      = 0.06; // drifting simplex grain shimmer amplitude
const float IDLE_BREATH_AMP     = 0.06; // global brightness swell (±)
const float IDLE_BREATH_PERIOD  = 10.0; // seconds per inhale/exhale

vec2 fieldRot(vec2 uv, float th) {
  return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
}

// Neuro-noise (zozuar / Paper shaders), 10 iterations: rotated sine-folding → vein-like caustics.
float fieldNeuro(vec2 uv, float t) {
  vec2 sineAcc = vec2(0.0);
  vec2 res = vec2(0.0);
  float scale = 8.0;
  for (int j = 0; j < 10; j++) {
    uv = fieldRot(uv, 1.0);
    sineAcc = fieldRot(sineAcc, 1.0);
    vec2 layer = uv * scale + float(j) + sineAcc - t;
    sineAcc += sin(layer);
    res += (0.5 + 0.5 * cos(layer)) / scale;
    scale *= 1.2;
  }
  return res.x + res.y;
}

// Simplex noise (Ashima / Paper shaders) — for the grain shimmer.
vec3 fieldPermute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float fieldSnoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);
  vec3 p = fieldPermute(fieldPermute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

// Cool "living air": faint drifting veins for the empty/low cells. Returns 0..1; aspect-corrected.
float fieldCaustic(vec2 uv) {
  vec2 cuv = uv * vec2(fieldFx.aspect, 1.0) * IDLE_CAUSTIC_SCALE;
  float n = fieldNeuro(cuv, fieldFx.time * 0.18);
  return clamp(smoothstep(0.45, 1.05, n), 0.0, 1.0);
}

// Corridor heat-haze: a warm highlight sweeping the hot corridors. Noise-driven heading + front
// (never settles into one direction). Returns ~0.5..1.5; caller subtracts 0.5 and masks by intensity.
float fieldHaze(vec2 uv) {
  vec2 p = uv * vec2(fieldFx.aspect, 1.0);
  float t = fieldFx.time;
  float ang = 2.4 + 1.3 * fieldSnoise(vec2(t * 0.012, 3.1));
  vec2 dir = vec2(cos(ang), sin(ang));
  float warp = 0.7 * fieldSnoise(p * 0.8 + vec2(t * 0.03, -t * 0.02));
  float y = fract(dot(p, dir) - t * IDLE_HAZE_SPEED + warp);
  float wave = smoothstep(0.3, 0.65, y) * (1.0 - smoothstep(0.65, 1.0, y));
  return 0.5 + wave;
}
`;

// ── GLSL composition (injected at fs:DECKGL_FILTER_COLOR) ──
// `color` arrives as the raw field texel; decode the channels and rebuild the pixel.
const FIELD_COMPOSE = /* glsl */ `
  // The heat reads as chunky blocks via fieldBlockTexel (the field re-sampled at the super-cell
  // centre, stashed in main()). Ignite stays at native res (color.b) so the route thread keeps its
  // 1-cell crispness; the idle ambience below is sampled per super-cell too (see ambUV) so it
  // steps with the blocks rather than smearing a continuous wave over them.
  float fHue = fieldBlockTexel.r;
  float fInt = fieldBlockTexel.g;
  float fIgnite = color.b;
  float fMask = fieldBlockTexel.a;

  // Posterize the heat into discrete bands so it reads as stepped choropleth gradations rather
  // than a continuous wash — the dense centre otherwise blends many near-equal cells into fluid
  // colour. Banding hue AND intensity steps the colour and the opacity together. steps<2 = smooth.
  if (fieldFx.steps >= 2.0) {
    fHue = floor(fHue * fieldFx.steps + 0.5) / fieldFx.steps;
    fInt = floor(fInt * fieldFx.steps + 0.5) / fieldFx.steps;
  }

  vec3 rgb = fieldRamp(fHue);
  float a = fieldOpacity(fInt);

  // Empty cell: a barely-there fill so the dotted basemap reads through under the grid lines.
  if (fMask < 0.5 && fInt < 0.004) {
    rgb = vec3(40.0, 48.0, 64.0) / 255.0;
    a = 8.0 / 255.0;
  }

  // Dim the background field during a submit — the pulse and route ride over it.
  a *= fieldFx.dim;

  // ── Idle ambience (luminance/alpha only) — folds in dim, so strongest at rest ──
  float idleK = fieldFx.idle * fieldFx.dim;

  // Sample the ambience at the super-cell CENTRE (like the heat) so the motion steps per block
  // instead of flowing as a continuous wave across the cells — this is what kept the dense centre
  // looking fluid. With blocky>1 the veins/haze now light whole cells, preserving the discrete read.
  vec2 ambUV = fieldBlockUV(geometry.uv);

  // Caustic "living air": cool veins drifting through the empty / low cells.
  float emptyW = 1.0 - smoothstep(0.0, 0.18, fInt);
  float caustic = fieldCaustic(ambUV) * idleK * emptyW;
  rgb = mix(rgb, vec3(70.0, 150.0, 236.0) / 255.0, clamp(caustic * 0.6, 0.0, 1.0));
  a += caustic * IDLE_CAUSTIC_AMP;

  // Corridor heat-haze: a slow warm wave so hot corridors smolder.
  float haze = (fieldHaze(ambUV) - 0.5) * pow(clamp(fInt, 0.0, 1.0), 0.8) * idleK;
  rgb = mix(rgb, fieldRamp(clamp(fHue + 0.06, 0.0, 1.0)), clamp(haze * 0.4, 0.0, 1.0));
  a += max(haze, 0.0) * IDLE_HAZE_AMP;

  // Global breath: a slow brightness swell.
  a *= 1.0 + IDLE_BREATH_AMP * idleK * sin(fieldFx.time * 6.2831853 / IDLE_BREATH_PERIOD);

  // Breathing grain: static Bayer stipple + a slow drifting simplex shimmer (on rgb, not alpha).
  float grain = (fieldBayer(gl_FragCoord.xy) - 0.5) * 0.12;
  grain += fieldSnoise(gl_FragCoord.xy * 0.5 + vec2(0.0, fieldFx.time * 0.6)) * IDLE_GRAIN_AMP * idleK;
  rgb *= 1.5 + grain;

  // Recalc moment: cells around the route churn hard through heat values (a visible scramble),
  // then settle as the region fades; a bright wavefront radiates along the route's shape. Bold
  // enough to read across the room — empty cells churn too, so the whole area around the route works.
  vec2 rc = fieldRecalc(geometry.uv);
  if (rc.y > 0.0) {
    vec2 cell = floor(geometry.uv * fieldCells());
    float step = mod(floor(fieldFx.time * 11.0), 131.0);
    float jitter = (fieldHash(cell + step) - 0.5) * 0.55;
    float churnHue = fMask > 0.5 ? fHue : 0.5; // hot cells churn hot; empty churn around neutral
    vec3 scrambled = fieldRamp(clamp(churnHue + jitter, 0.0, 1.0));
    rgb = mix(rgb, scrambled, clamp(rc.y * 0.9, 0.0, 1.0));
    a = max(a, clamp(rc.y * 0.55, 0.0, 1.0));
  }
  if (rc.x > 0.0) {
    rgb = mix(rgb, vec3(255.0, 250.0, 236.0) / 255.0, clamp(0.75 * rc.x, 0.0, 1.0));
    a = max(a, clamp(0.6 * rc.x, 0.0, 1.0));
  }

  // Route ignite: a bright, blocky line travelling cell by cell.
  if (fIgnite > 0.0) {
    rgb = mix(rgb, vec3(255.0, 247.0, 228.0) / 255.0, clamp(fIgnite * 1.2, 0.0, 1.0));
    a = max(a, clamp(fIgnite * 1.15, 0.0, 1.0));
  }

  // ── Ordered-dither pass (the paper-design "dithering" look) ──

  if (fieldFx.dither > 0.0) {
    vec2 dcell = floor(gl_FragCoord.xy / max(fieldFx.ditherPx, 1.0));
    float thr = fieldDither(dcell, int(fieldFx.ditherType + 0.5));
    float aDither = step(thr, clamp(a, 0.0, 1.0));
    a = mix(a, aDither, fieldFx.dither);
  }

  // Grid lines LAST, so the dark lattice reads across the field, ambience and route.
  rgb *= 1.0 - 0.38 * fieldGrid(geometry.uv);

  color = vec4(rgb, clamp(a, 0.0, 1.0));
`;

// Injected at the START of main(), where bitmapTexture + vTexCoord are in scope (the colour hook
// is a separate function assembled before the texture's declaration, so it can't sample there).
// Stash the super-cell texel for FIELD_COMPOSE. vTexCoord is the field uv (linear bounds → no
// coordinate conversion), matching the geometry.uv the colour hook uses.
const FIELD_SAMPLE = /* glsl */ `
  fieldBlockTexel = texture(bitmapTexture, fieldBlockUV(vTexCoord));
`;

// Field data the layer turns into its texture. A new object ref signals a change (deck diffs
// props by reference), so passing the same ref means "no re-upload".
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

// Build the FieldLayer class from the runtime BitmapLayer (passed by loadDeck so the static
// deck import stays out of SSR). We own the texture rather than BitmapLayer's async `image`
// prop — that path silently produced an empty texture; here `fieldData` (raw rgba8) uploads
// straight to a device texture, bound as `bitmapTexture` in draw().
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
          'fs:#main-start': (inject['fs:#main-start'] ?? '') + FIELD_SAMPLE,
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
          idle: p.idle,
          pathA: p.pathA,
          pathB: p.pathB,
          pathC: p.pathC,
          pathD: p.pathD,
          pathCount: p.pathCount,
          blocky: p.blocky,
          steps: p.steps,
          dither: p.dither,
          ditherType: p.ditherType,
          ditherPx: p.ditherPx
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
