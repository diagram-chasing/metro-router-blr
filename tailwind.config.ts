import type { Config } from 'tailwindcss';

export default {
	content: ['./src/**/*.{html,js,svelte,ts}'],

	theme: {
		extend: {
			fontFamily: {
				// The exhibit/kiosk UI uses IBM Plex. The printed receipt and its preview
				// (ReceiptDoc.svelte) render in plain monospace to mirror the thermal
				// printer's built-in font, so no bundled receipt face lives here.
				sans: ['IBM Plex Sans', 'ui-sans-serif', 'system-ui', 'sans-serif']
			},
			// 1-bit ink for the receipt graphics (QR / route map / stamp): pure black,
			// white paper, no greys.
			colors: {
				paper: '#ffffff',
				ink: '#000000'
			}
		}
	},

	plugins: []
} satisfies Config;
