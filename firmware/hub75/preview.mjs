// Turns the PPMs from test_render.cpp into LED-dot PNGs, so what you review is
// the firmware's own framebuffer rather than a JavaScript restatement of it.
//
//   clang++ -std=c++17 -I. -o /tmp/render_test test_render.cpp
//   /tmp/render_test && node preview.mjs
//
// No Playwright here — a PNG this simple is quicker to encode by hand than to
// screenshot, and it keeps the firmware check free of browser dependencies.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const dir = new URL('./out/', import.meta.url).pathname;
const SCALE = 9, RADIUS = 3.4;

function readPpm(path) {
  const buf = readFileSync(path);
  // P6\n<w> <h>\n255\n then raw RGB.
  let i = 0, fields = [];
  while (fields.length < 4) {
    while (buf[i] === 0x20 || buf[i] === 0x0a || buf[i] === 0x0d) i++;
    let start = i;
    while (i < buf.length && ![0x20, 0x0a, 0x0d].includes(buf[i])) i++;
    fields.push(buf.toString('ascii', start, i));
  }
  i++;
  const [, w, h] = [fields[0], Number(fields[1]), Number(fields[2])];
  return { w, h, data: buf.subarray(i) };
}

function crc32(buf) {
  let c, table = [];
  for (let n = 0; n < 256; n++) {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Each panel pixel becomes a dot on a dark board, with a soft halo, so the
// preview reads like the module rather than like a bitmap.
function draw(src) {
  const W = src.w * SCALE, H = src.h * SCALE;
  const out = Buffer.alloc(W * H * 3);
  for (let i = 0; i < W * H; i++) {
    out[i * 3] = 0x07; out[i * 3 + 1] = 0x09; out[i * 3 + 2] = 0x0a;
  }
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const s = (y * src.w + x) * 3;
      const on = src.data[s] || src.data[s + 1] || src.data[s + 2];
      const cx = x * SCALE + SCALE / 2, cy = y * SCALE + SCALE / 2;
      const reach = on ? RADIUS + 2.2 : RADIUS;
      for (let dy = -Math.ceil(reach); dy <= Math.ceil(reach); dy++) {
        for (let dx = -Math.ceil(reach); dx <= Math.ceil(reach); dx++) {
          const px = Math.round(cx + dx), py = Math.round(cy + dy);
          if (px < 0 || py < 0 || px >= W || py >= H) continue;
          const d = Math.hypot(dx, dy);
          let k;
          if (d <= RADIUS) k = 1;
          else if (on && d <= reach) k = 0.35 * (1 - (d - RADIUS) / 2.2);
          else continue;
          const o = (py * W + px) * 3;
          const lit = on ? [src.data[s], src.data[s + 1], src.data[s + 2]] : [0x15, 0x18, 0x1b];
          for (let c = 0; c < 3; c++) out[o + c] = Math.min(255, Math.max(out[o + c], lit[c] * k));
        }
      }
    }
  }
  return png(W, H, out);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.ppm'));
for (const f of files) {
  const name = f.replace(/\.ppm$/, '');
  writeFileSync(`${dir}${name}.png`, draw(readPpm(`${dir}${f}`)));
}
console.log(`rendered ${files.length} previews to firmware/hub75/out/`);
