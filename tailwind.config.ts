import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],

	theme: {
		extend: {
			fontFamily: {
				// The exhibit/kiosk UI keeps IBM Plex.
				sans: ['IBM Plex Sans', 'ui-sans-serif', 'system-ui', 'sans-serif'],
				// `font-mono` is used only inside the printed receipt — point it at the
				// receipt's ledger face. Space Mono ships 400/700 only; the receipt
				// never asks for 500/600.
				mono: ['Space Mono', 'ui-monospace', 'monospace'],
				// Masthead wordmark only.
				display: ['Archivo Variable', 'IBM Plex Sans', 'sans-serif']
			},
			// The receipt is a 1-bit thermal print: pure black ink, white paper, no
			// greys. Hierarchy comes from size / weight / caps; "shading" comes from
			// dash + dot + dither patterns, never from a grey value.
			colors: {
				paper: '#ffffff',
				ink: '#000000'
			},
			// One tight type scale for the whole receipt — `r-` prefixed so it never
			// collides with default utilities used elsewhere.
			fontSize: {
				'r-2xs': ['9px', { lineHeight: '1.5', letterSpacing: '0.04em' }],
				'r-xs': ['10.5px', { lineHeight: '1.5', letterSpacing: '0.02em' }],
				'r-sm': ['11.5px', { lineHeight: '1.5' }],
				'r-base': ['13px', { lineHeight: '1.55' }],
				'r-lg': ['15px', { lineHeight: '1.35' }],
				'r-stat': ['27px', { lineHeight: '1', letterSpacing: '-0.02em' }],
				'r-title': ['40px', { lineHeight: '0.92', letterSpacing: '-0.015em' }]
			},
			letterSpacing: {
				label: '0.14em', // section / column labels
				footer: '0.24em' // the footer "RETAIN FOR YOUR RECORDS"
			}
		}
	},

	plugins: []
} satisfies Config;
