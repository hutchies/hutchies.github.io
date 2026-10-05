import { defineConfig, type Plugin } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Emits sw.js (from sw/sw.js) with the list of every built and public file to
 * precache, and a version derived from that list so each deploy replaces the
 * old cache.
 */
function serviceWorker(): Plugin {
  return {
    name: 'service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = [...Object.keys(bundle), ...readdirSync('public')].filter((f) => f !== 'index.html' && f !== 'sw.js');
      const precache = ['./', ...files.sort().map((f) => `./${f}`)];
      const version = createHash('sha256').update(precache.join('\n')).digest('hex').slice(0, 12);
      const source = readFileSync('sw/sw.js', 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  // Relative base so the build works from any sub-path (e.g. GitHub Pages project sites).
  base: './',
  plugins: [svelte(), serviceWorker()],
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
