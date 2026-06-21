<script lang="ts">
	// The commuter profile as an EMISSIONS RESONANCE — a real Chladni figure.
	//
	// Method (after cymatics-labs): sand grains on a vibrating plate drift down the
	// gradient of the field energy |z|² and settle onto the nodal lines (where the
	// plate is still). We simulate exactly that — a seeded cloud of particles run to
	// convergence with a Newton-relaxed gradient step — then print the settled grains.
	// The plate's two modes come from the visitor's emissions: clean, light commutes
	// ring a calm figure; heavy ones a dense, agitated one. The pattern *is* the data.
	//
	//   z(X,Y) = cos(mπX)cos(nπY) − cos(nπX)cos(mπY),   X,Y ∈ [−1,1]
	//
	// Deterministic: a mulberry32 PRNG seeded from the visitor's answers, so the same
	// commute always rings the same figure. Pure 1-bit grains — thermal-native.
	let { n, m, seed = '', size = 188 }: { n: number; m: number; seed?: string; size?: number } =
		$props();

	function hash(s: string): number {
		let h = 2166136261 >>> 0;
		for (let i = 0; i < s.length; i++) {
			h ^= s.charCodeAt(i);
			h = Math.imul(h, 16777619) >>> 0;
		}
		return h >>> 0;
	}

	function mulberry32(a: number) {
		return () => {
			a |= 0;
			a = (a + 0x6d2b79f5) | 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	const uid = $derived(`chladni-${hash(seed)}-${n}-${m}`);
	const PI = Math.PI;

	const grains = $derived.by(() => {
		const a = Math.max(n, m);
		const b = Math.min(n, m);
		const field = (X: number, Y: number) =>
			Math.cos(a * PI * X) * Math.cos(b * PI * Y) - Math.cos(b * PI * X) * Math.cos(a * PI * Y);
		// analytic ∇z
		const grad = (X: number, Y: number): [number, number] => [
			-a * PI * Math.sin(a * PI * X) * Math.cos(b * PI * Y) +
				b * PI * Math.sin(b * PI * X) * Math.cos(a * PI * Y),
			-b * PI * Math.cos(a * PI * X) * Math.sin(b * PI * Y) +
				a * PI * Math.cos(b * PI * X) * Math.sin(a * PI * Y)
		];

		const rand = mulberry32(hash(seed) || 1);
		const P = 600; // initial grains — kept low so the figure prints as a light sketch
		const K = 26; // settle iterations
		const relax = 0.55; // Newton step relaxation
		const cx = size / 2;
		const cy = size / 2;
		const half = size / 2 - 6; // square half-extent in px
		const rClip = size / 2 - 6;

		const seen = new Set<number>();
		const pts: { x: number; y: number }[] = [];

		for (let i = 0; i < P; i++) {
			let X = rand() * 2 - 1;
			let Y = rand() * 2 - 1;
			let noise = 0.045;
			for (let k = 0; k < K; k++) {
				const z = field(X, Y);
				const [zx, zy] = grad(X, Y);
				const g2 = zx * zx + zy * zy + 1e-6;
				const s = (relax * z) / g2; // project toward nearest node
				X -= s * zx + (rand() - 0.5) * noise;
				Y -= s * zy + (rand() - 0.5) * noise;
				if (X < -1) X = -1;
				else if (X > 1) X = 1;
				if (Y < -1) Y = -1;
				else if (Y > 1) Y = 1;
				noise *= 0.84;
			}
			// drop grains pinned to the plate edge — they'd draw a false square frame
			if (Math.abs(X) > 0.992 || Math.abs(Y) > 0.992) continue;
			const px = cx + X * half;
			const py = cy + Y * half;
			if ((px - cx) ** 2 + (py - cy) ** 2 > rClip * rClip) continue;
			const key = Math.round(px) * 4096 + Math.round(py);
			if (seen.has(key)) continue;
			seen.add(key);
			pts.push({ x: px, y: py });
		}
		return pts;
	});

	const ringR = $derived(size / 2 - 1.5);
</script>

<svg viewBox="0 0 {size} {size}" width={size} class="mx-auto block" role="img" aria-label="emissions resonance figure">
	<defs>
		<clipPath id={uid}>
			<circle cx={size / 2} cy={size / 2} r={size / 2 - 4} />
		</clipPath>
	</defs>
	<g clip-path="url(#{uid})">
		{#each grains as g, i (i)}
			<circle cx={g.x} cy={g.y} r="0.7" fill="#000" />
		{/each}
	</g>
	<circle cx={size / 2} cy={size / 2} r={ringR} fill="none" stroke="#000" stroke-width="1.2" />
</svg>
