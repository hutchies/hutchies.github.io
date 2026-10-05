// Renders the app icons in public/ from one SVG (run with Playwright available: node scripts/icons.mjs).
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public/', import.meta.url));
const glyph = 'M10 2h4l5 20H5zm1.5 2-1 4h3l-1-4zM12 9.5 16.6 4l1 .8-4.6 5.6.9 3.6h-3.8z';

// `pad` is the share of the icon kept clear around the glyph (maskable icons need ~20%).
const svg = (size, pad, rounded) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="${rounded ? 22 : 0}" fill="#3b5bdb"/>
  <g transform="translate(${pad} ${pad}) scale(${(100 - 2 * pad) / 24})"><path fill="#fff" d="${glyph}"/></g>
</svg>`;

const icons = [
  ['icon-192.png', 192, 18, true],
  ['icon-512.png', 512, 18, true],
  ['icon-maskable-512.png', 512, 26, false],
  ['apple-touch-icon.png', 180, 20, false],
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad, rounded] of icons) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:transparent}</style>${svg(size, pad, rounded)}`);
  await page.locator('svg').screenshot({ path: out + name, omitBackground: true });
}
await browser.close();
