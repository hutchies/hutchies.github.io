import type { NoteValue } from '../model/types';

/**
 * Draw a small note glyph (head, stem, flags, dots) with its baseline at y.
 * `h` is the overall glyph height. Returns the drawn width.
 */
export function drawNote(ctx: CanvasRenderingContext2D, x: number, y: number, h: number, v: NoteValue): number {
  const rx = h * 0.2;
  const ry = h * 0.14;
  const cx = x + rx;
  const cy = y - ry;
  ctx.save();
  ctx.lineWidth = Math.max(1, h * 0.07);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, -0.35, 0, Math.PI * 2);
  if (v.base >= 4) ctx.fill();
  else ctx.stroke();
  let width = rx * 2;
  if (v.base >= 2) {
    const sx = cx + rx * 0.9;
    const top = y - h;
    ctx.beginPath();
    ctx.moveTo(sx, cy);
    ctx.lineTo(sx, top);
    ctx.stroke();
    const flags = Math.max(0, Math.round(Math.log2(v.base)) - 2);
    for (let i = 0; i < flags; i++) {
      const fy = top + i * h * 0.2;
      ctx.beginPath();
      ctx.moveTo(sx, fy);
      ctx.quadraticCurveTo(sx + h * 0.35, fy + h * 0.2, sx + h * 0.25, fy + h * 0.45);
      ctx.stroke();
    }
    if (flags) width = Math.max(width, rx * 1.8 + h * 0.35);
  }
  for (let d = 0; d < v.dots; d++) {
    ctx.beginPath();
    ctx.arc(x + width + h * 0.12 + d * h * 0.18, cy, h * 0.055, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  return width + (v.dots ? h * 0.12 + v.dots * h * 0.18 : 0);
}
