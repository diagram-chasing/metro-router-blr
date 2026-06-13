import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// better-sqlite3 is a native CommonJS module imported only from $lib/server.
	// Keep it out of the bundler so the prebuilt binary loads as-is at runtime.
	ssr: { external: ['better-sqlite3'] },
	optimizeDeps: { exclude: ['better-sqlite3'] }
});
