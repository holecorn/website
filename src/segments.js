// Seven-segment digit geometry, in a 100 x 180 box.
//
//    aaa      Each segment is a hexagon with 45-degree mitred ends. For the
//   f   b     mitres to meet without overlapping, a horizontal segment's tip
//   f   b     apex must sit on the vertical segments' centre line (x = 11 or
//    ggg      89) and a vertical segment's tip apex on the horizontal ones'
//   e   c     (y = 11, 90 or 169) — a segment that reaches past its neighbour's
//   e   c     centre line will overlap it, which shows up as a dark diamond at
//    ddd      the corners once the unlit segments are drawn semi-transparent.
//
// Tips are then pulled back two units from those anchors to leave the hairline
// break between segments that a real LED module has.

export const DIGIT_VIEWBOX = '0 0 100 180';

export const SEGMENTS = {
  a: '13,11 22,2 78,2 87,11 78,20 22,20',
  b: '89,13 98,22 98,79 89,88 80,79 80,22',
  c: '89,92 98,101 98,158 89,167 80,158 80,101',
  d: '13,169 22,160 78,160 87,169 78,178 22,178',
  e: '11,92 20,101 20,158 11,167 2,158 2,101',
  f: '11,13 20,22 20,79 11,88 2,79 2,22',
  g: '13,90 22,81 78,81 87,90 78,99 22,99',
};

export const DIGIT_SEGMENTS = {
  0: 'abcdef',
  1: 'bc',
  2: 'abdeg',
  3: 'abcdg',
  4: 'bcfg',
  5: 'acdfg',
  6: 'acdefg',
  7: 'abc',
  8: 'abcdefg',
  9: 'abcdfg',
};

export function litSegments(char) {
  return DIGIT_SEGMENTS[char] ?? '';
}

export function segmentPoints(points) {
  return points.split(' ').map((pair) => pair.split(',').map(Number));
}
