// Renders the app and tray icons from build/icon.svg (run: npm run icons). The PNGs are committed.
import fs from 'node:fs';
import { Resvg } from '@resvg/resvg-js';
const svg = fs.readFileSync(new URL('./icon.svg', import.meta.url));
const png = w => new Resvg(svg, { fitTo: { mode: 'width', value: w } }).render().asPng();
fs.writeFileSync(new URL('./icon.png', import.meta.url), png(1024));
fs.writeFileSync(new URL('../app/ui/icon.png', import.meta.url), png(128));
fs.writeFileSync(new URL('../app/tray.png', import.meta.url), png(32));
fs.writeFileSync(new URL('../app/tray@2x.png', import.meta.url), png(64));
// Windows icon: an .ico holding PNG images (Vista and later read those)
const sizes = [16, 24, 32, 48, 64, 128, 256], imgs = sizes.map(png);
const head = Buffer.alloc(6 + 16 * sizes.length); head.writeUInt16LE(1, 2); head.writeUInt16LE(sizes.length, 4);
let off = head.length;
sizes.forEach((s, i) => { const e = 6 + 16 * i; head[e] = s % 256; head[e + 1] = s % 256; head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6); head.writeUInt32LE(imgs[i].length, e + 8); head.writeUInt32LE(off, e + 12); off += imgs[i].length; });
fs.writeFileSync(new URL('./icon.ico', import.meta.url), Buffer.concat([head, ...imgs]));
console.log('icons ok');
