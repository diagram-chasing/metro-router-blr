import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],

	theme: {
		extend: {
			fontFamily: {
				// The exhibit/kiosk UI keeps IBM Plex.
				sans: ['IBM Plex Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
				// `font-mono` is the receipt's body/ledger face. Space Mono ships 400/700
				// (+ italics) only; the receipt never asks for 500/600. This is the one
				// place we still want real bold + italic, so it stays Space Mono.
				mono: ['Space Mono', 'ui-monospace', 'monospace'],
				// `font-display` is the pixel voice: masthead, section headings, and the
				// big display numbers. Departure Mono is single-weight (no bold/italic) —
				// hierarchy there comes from size / caps / spacing, never weight.
				display: ['Departure Mono', 'ui-monospace', 'monospace']
			},
			// The receipt is a 1-bit thermal print: pure black ink, white paper, no
			// greys. Hierarchy comes from size / weight / caps; "shading" comes from
			// dash + dot + dither patterns, never from a grey value.
			colors: {
				paper: '#ffffff',
				ink: '#000000'
			},
			// One type scale for the whole receipt — `r-` prefixed so it never collides
			// with default utilities used elsewhere. Bumped so nothing prints below ~12px:
			// small text on a thermal head is exactly what smudges. Length is cheap.
			fontSize: {
				'r-2xs': ['11.5px', { lineHeight: '1.5', letterSpacing: '0.03em' }],
				'r-xs': ['12.5px', { lineHeight: '1.5', letterSpacing: '0.02em' }],
				'r-sm': ['13.5px', { lineHeight: '1.5' }],
				'r-base': ['15px', { lineHeight: '1.6' }],
				'r-lg': ['18px', { lineHeight: '1.35' }],
				// Display sizes (Departure Mono): kept near clean pixel-grid multiples so
				// the pixel face stays crisp with font-smoothing off.
				'r-stat': ['32px', { lineHeight: '1', letterSpacing: '0' }],
				'r-title': ['40px', { lineHeight: '1', letterSpacing: '0' }]
			},
			letterSpacing: {
				label: '0.14em', // section / column labels
				footer: '0.24em' // the footer "RETAIN FOR YOUR RECORDS"
			}
		}
	},

	plugins: []
} satisfies Config;
