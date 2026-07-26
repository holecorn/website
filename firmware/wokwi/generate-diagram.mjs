// Generates diagram.json for Wokwi. The pin assignments are read out of
// sketch.ino so there is one source of truth: the two displays share seven
// segment lines, which is fiddly enough by hand that a silent mismatch between
// the wiring and the firmware is the likely failure.
//
//   node firmware/wokwi/generate-diagram.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SEGMENTS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

function pinsFrom(sketch, name) {
  const match = sketch.match(new RegExp(`byte ${name}\\[\\]\\s*=\\s*\\{([^}]*)\\}`));
  if (!match) throw new Error(`could not find ${name}[] in sketch.ino`);
  return match[1].split(',').map((pin) => {
    const n = Number(pin.trim());
    if (!Number.isInteger(n)) throw new Error(`bad pin "${pin.trim()}" in ${name}[]`);
    return n;
  });
}

const sketch = readFileSync(join(here, 'sketch.ino'), 'utf8');
const segmentPins = pinsFrom(sketch, 'segmentPins');
const digitPins = pinsFrom(sketch, 'digitPins');

if (segmentPins.length !== SEGMENTS.length) {
  throw new Error(`expected ${SEGMENTS.length} segment pins, got ${segmentPins.length}`);
}
if (digitPins.length !== 4) {
  throw new Error(`expected 4 digit pins, got ${digitPins.length}`);
}

const parts = [
  { type: 'board-esp32-devkit-c-v4', id: 'esp', top: 150, left: -100, attrs: {} },
  {
    type: 'wokwi-7segment',
    id: 'sevA',
    top: -80,
    left: 100,
    attrs: { digits: '2', common: 'cathode', color: '#2f80ed' },
  },
  {
    type: 'wokwi-7segment',
    id: 'sevB',
    top: -80,
    left: 330,
    attrs: { digits: '2', common: 'cathode', color: '#eb5757' },
  },
];

const connections = [];

// One resistor per segment, feeding the same segment on both displays — which is
// what `resistorsOnSegments` in the sketch's SevSeg config describes.
SEGMENTS.forEach((segment, i) => {
  const id = `r${segment}`;
  parts.push({
    type: 'wokwi-resistor',
    id,
    top: 40 + i * 30,
    left: 30,
    attrs: { value: '220' },
  });
  connections.push([`esp:${segmentPins[i]}`, `${id}:1`, 'green', []]);
  connections.push([`${id}:2`, `sevA:${segment}`, 'green', []]);
  connections.push([`${id}:2`, `sevB:${segment}`, 'green', []]);
});

// Team A's digits first, then team B's, matching the order formatDigits writes.
const digitTargets = ['sevA:DIG1', 'sevA:DIG2', 'sevB:DIG1', 'sevB:DIG2'];
digitPins.forEach((pin, i) => {
  connections.push([`esp:${pin}`, digitTargets[i], 'orange', []]);
});

const driven = connections.filter((c) => c[0].startsWith('esp:')).map((c) => c[0]);
const expected = [...segmentPins, ...digitPins].map((p) => `esp:${p}`);
if (new Set(driven).size !== driven.length) {
  throw new Error('a GPIO is wired twice');
}
if ([...driven].sort().join() !== [...expected].sort().join()) {
  throw new Error('driven pins do not match the sketch');
}

const reached = new Set(connections.map((c) => c[1]));
for (const display of ['sevA', 'sevB']) {
  for (const pin of [...SEGMENTS, 'DIG1', 'DIG2']) {
    if (!reached.has(`${display}:${pin}`)) throw new Error(`${display}:${pin} unwired`);
  }
}

const diagram = { version: 1, author: 'Holecorn', editor: 'wokwi', parts, connections };
writeFileSync(join(here, 'diagram.json'), `${JSON.stringify(diagram, null, 2)}\n`);
console.log(
  `diagram.json: ${parts.length} parts, ${connections.length} connections`,
  `\nsegments ${segmentPins.join(',')} · digits ${digitPins.join(',')}`,
);
