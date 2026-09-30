/** Renders a quick SVG of the generated board so the geometry can be eyeballed. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '..', 'src', 'board.generated.ts'), 'utf8');

// The generated file is plain data; strip the TS so it can be eval'd.
const js = src
  .replace(/^import type[\s\S]*?;\n/m, '')
  .replace(/export type[\s\S]*?\n};\n/g, '')
  .replace(/export const/g, 'const')
  .replace(/: readonly \(readonly \[number, number\]\)\[\]/g, '')
  .replace(/: readonly ZoneSpec\[\]/g, '')
  .replace(/: number/g, '');

const { BOARD, COASTLINE } = await import(
  'data:text/javascript,' + encodeURIComponent(js + '\nexport { BOARD, COASTLINE };')
);

const FILL = {
  north_west: '#efe9da', north_east: '#efe9da', west: '#e7e0cd', east: '#e7e0cd',
  south_west: '#efe9da', south_east: '#efe9da',
  north: '#cfc7a8', south: '#cfc7a8', central: '#b3a982',
};

let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1500" width="520" height="780">`;
s += `<rect width="1000" height="1500" fill="#3a322c"/>`;
s += `<polygon points="${COASTLINE.map((p) => p.join(',')).join(' ')}" fill="#8d968a" stroke="#6e786c" stroke-width="14"/>`;
for (const z of BOARD) {
  s += `<polygon points="${z.poly.map((p) => p.join(',')).join(' ')}" fill="${FILL[z.id]}" stroke="#5d6558" stroke-width="5"/>`;
}
for (const z of BOARD) {
  for (const a of z.areas) {
    s += a.volatile
      ? `<circle cx="${a.x}" cy="${a.y}" r="17" fill="#e9e4d6" stroke="#16181a" stroke-width="8" stroke-dasharray="11 8"/>`
      : `<circle cx="${a.x}" cy="${a.y}" r="15" fill="#d6d1c3" stroke="#bab4a4" stroke-width="2"/>`;
  }
  s += `<text x="${z.label[0]}" y="${z.label[1]}" font-family="Courier New,monospace" font-weight="bold" font-size="40" text-anchor="middle" fill="#1c1c1c">${z.majority}/${z.capacity}</text>`;
  s += `<text x="${z.label[0]}" y="${z.label[1] + 26}" font-family="Courier New,monospace" font-size="17" letter-spacing="2" text-anchor="middle" fill="#3d3d3d">${z.name.toUpperCase()}</text>`;
}
s += `</svg>`;

const out = process.argv[2] ?? join(here, 'board-preview.svg');
writeFileSync(out, s);
console.log('wrote', out);
