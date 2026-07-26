import { describe, it, expect } from 'vitest';
import { DIGIT_SEGMENTS, SEGMENTS, litSegments, segmentPoints } from './segments.js';

function inside([x, y], polygon) {
  let hit = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Sampled off the integer and half-integer grid so no probe lands on a vertex
// or a 45-degree mitre edge, where ray casting is a coin toss.
function probes() {
  const points = [];
  for (let i = 0; i < 100; i++) {
    for (let j = 0; j < 180; j++) points.push([i + 0.31, j + 0.17]);
  }
  return points;
}

describe('segment geometry', () => {
  const polygons = Object.fromEntries(
    Object.entries(SEGMENTS).map(([name, points]) => [name, segmentPoints(points)]),
  );

  it('never lets two segments cover the same point', () => {
    const names = Object.keys(polygons);
    const clashes = new Set();
    for (const point of probes()) {
      const covering = names.filter((name) => inside(point, polygons[name]));
      if (covering.length > 1) clashes.add(covering.join('+'));
    }
    expect([...clashes]).toEqual([]);
  });

  it('stays inside the viewBox', () => {
    for (const [name, polygon] of Object.entries(polygons)) {
      for (const [x, y] of polygon) {
        expect(x, `${name} x`).toBeGreaterThanOrEqual(0);
        expect(x, `${name} x`).toBeLessThanOrEqual(100);
        expect(y, `${name} y`).toBeGreaterThanOrEqual(0);
        expect(y, `${name} y`).toBeLessThanOrEqual(180);
      }
    }
  });

  it('covers every digit with known segments', () => {
    for (const [digit, lit] of Object.entries(DIGIT_SEGMENTS)) {
      for (const name of lit) {
        expect(SEGMENTS, `digit ${digit} segment ${name}`).toHaveProperty(name);
      }
    }
    expect(Object.keys(DIGIT_SEGMENTS)).toHaveLength(10);
  });

  it('lights nothing for a padding blank', () => {
    expect(litSegments(' ')).toBe('');
    expect(litSegments(undefined)).toBe('');
  });
});
