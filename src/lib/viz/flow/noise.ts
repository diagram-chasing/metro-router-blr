// A compact seeded 2D gradient (Perlin-style) noise + fbm, hand-rolled so the wall
// adds zero dependencies. The field module finite-differences this to derive a
// divergence-free curl — particles then flow *around* features instead of piling up.

export type Noise2D = (x: number, y: number) => number; // ~[-1, 1]

export function makeNoise(seed = 1337): { noise2: Noise2D; fbm2: (x: number, y: number, oct?: number) => number } {
	const perm = new Uint8Array(512);
	const p = new Uint8Array(256);
	for (let i = 0; i < 256; i++) p[i] = i;
	// xorshift shuffle so the permutation is deterministic per seed.
	let s = seed >>> 0 || 1;
	const rnd = () => {
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		return (s >>> 0) / 4294967296;
	};
	for (let i = 255; i > 0; i--) {
		const j = (rnd() * (i + 1)) | 0;
		const t = p[i];
		p[i] = p[j];
		p[j] = t;
	}
	for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

	const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
	const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
	const grad = (h: number, x: number, y: number) => (h & 1 ? -x : x) + (h & 2 ? -y : y);

	const noise2: Noise2D = (x, y) => {
		const xi = Math.floor(x);
		const yi = Math.floor(y);
		const X = xi & 255;
		const Y = yi & 255;
		const xf = x - xi;
		const yf = y - yi;
		const u = fade(xf);
		const v = fade(yf);
		const aa = perm[perm[X] + Y];
		const ab = perm[perm[X] + Y + 1];
		const ba = perm[perm[X + 1] + Y];
		const bb = perm[perm[X + 1] + Y + 1];
		const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
		const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
		return lerp(x1, x2, v); // ~[-1, 1]
	};

	const fbm2 = (x: number, y: number, oct = 3) => {
		let a = 0.5;
		let f = 1;
		let sum = 0;
		let norm = 0;
		for (let i = 0; i < oct; i++) {
			sum += a * noise2(x * f, y * f);
			norm += a;
			a *= 0.5;
			f *= 2;
		}
		return sum / norm;
	};

	return { noise2, fbm2 };
}
