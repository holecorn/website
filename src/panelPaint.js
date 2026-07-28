// Draws a panel framebuffer onto a canvas as individual LEDs. No React, so it
// can be driven straight from a browser check — see tools/verify-panel.mjs.
//
// Unlit LEDs are drawn as well as lit ones, because a dark grey grid is most of
// what a real module looks like with the power on, and the quantisation is the
// thing worth seeing.

import { PANEL_H, PANEL_W } from './panel.js';

const BOARD_BG = '#07090a';
const UNLIT = '#15181b';

// Integer pixels per LED, so the grid stays even. Capped because past about 8px
// per LED it stops looking like a panel and starts looking like a chessboard.
export function panelCell(width) {
  return Math.min(8, Math.max(2, Math.floor(width / PANEL_W)));
}

export function paintPanel(canvas, fb, cell) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = PANEL_W * cell * dpr;
  canvas.height = PANEL_H * cell * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = BOARD_BG;
  ctx.fillRect(0, 0, PANEL_W * cell, PANEL_H * cell);

  const radius = cell * 0.36;
  for (let y = 0; y < PANEL_H; y += 1) {
    for (let x = 0; x < PANEL_W; x += 1) {
      const o = (y * PANEL_W + x) * 3;
      const r = fb.data[o];
      const g = fb.data[o + 1];
      const b = fb.data[o + 2];
      ctx.beginPath();
      ctx.arc(x * cell + cell / 2, y * cell + cell / 2, radius, 0, Math.PI * 2);
      if (r || g || b) {
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.shadowColor = `rgb(${r},${g},${b})`;
        ctx.shadowBlur = cell;
      } else {
        ctx.fillStyle = UNLIT;
        ctx.shadowBlur = 0;
      }
      ctx.fill();
    }
  }
  ctx.shadowBlur = 0;
}
