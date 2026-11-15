// Controller shoulder buttons and triggers (LB / RB bumpers, LT / RT triggers) drawn as little button icons,
// plus helpers to draw a line of text where "LB", "LT", "RB" and "RT" become those icons.
const TOKEN = /\b(LB|LT|RB|RT)\b/;
const SPLIT = /\b(LB|LT|RB|RT)\b/g;
export const hasPadToken = (str) => typeof str === 'string' && TOKEN.test(str);

// the icon's width for a line height h
export const padButtonWidth = (name, h) => (name[1] === 'T' ? h * 1.18 : h * 1.62);

// one button, centred on (cx, cy), about h tall
export function drawPadButton(ctx, name, cx, cy, h, fill = '#2c2833', edge = '#e6ddcc', ink = '#ffffff') {
  const trig = name[1] === 'T', left = name[0] === 'L';
  const w = padButtonWidth(name, h), bh = trig ? h : h * 0.78;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.save();
  if (!left) ctx.scale(-1, 1); // right buttons are mirrored
  const x0 = -w / 2, x1 = w / 2, y0 = -bh / 2, y1 = bh / 2;
  ctx.beginPath();
  if (trig) { // a trigger: tall, its outer top corner rounded off
    ctx.moveTo(x0 + w * 0.1, y1);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1, y0 + bh * 0.22);
    ctx.quadraticCurveTo(x1, y0, x1 - w * 0.22, y0);
    ctx.lineTo(x0 + w * 0.42, y0);
    ctx.quadraticCurveTo(x0, y0 + bh * 0.02, x0, y0 + bh * 0.5);
    ctx.lineTo(x0, y1 - bh * 0.12);
    ctx.quadraticCurveTo(x0, y1, x0 + w * 0.1, y1);
  } else { // a bumper: wide, sweeping up toward the outer side
    ctx.moveTo(x0 + bh * 0.25, y1);
    ctx.lineTo(x1 - bh * 0.25, y1);
    ctx.quadraticCurveTo(x1, y1, x1, y1 - bh * 0.3);
    ctx.lineTo(x1, y0 + bh * 0.45);
    ctx.quadraticCurveTo(x1, y0 + bh * 0.05, x1 - w * 0.25, y0 + bh * 0.08);
    ctx.lineTo(x0 + w * 0.35, y0);
    ctx.quadraticCurveTo(x0, y0 - bh * 0.02, x0, y0 + bh * 0.5);
    ctx.lineTo(x0, y1 - bh * 0.25);
    ctx.quadraticCurveTo(x0, y1, x0 + bh * 0.25, y1);
  }
  ctx.closePath();
  ctx.fillStyle = fill; ctx.fill();
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(1, h * 0.08); ctx.strokeStyle = edge; ctx.stroke();
  // a little shine along the top edge
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = Math.max(0.8, h * 0.05);
  ctx.beginPath(); ctx.moveTo(x0 + w * 0.3, y0 + bh * 0.2); ctx.lineTo(x1 - w * 0.3, y0 + bh * 0.2); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = ink; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `800 ${Math.max(6, Math.round(h * (trig ? 0.44 : 0.46)))}px "Zen Kaku Gothic New", sans-serif`;
  ctx.fillText(name, 0, (trig ? bh * 0.08 : bh * 0.04) + 0.5);
  ctx.restore();
}

// a line of text with the button names drawn as icons: width, and drawing (left-aligned, vertically centred)
// the caller sets ctx.font and ctx.fillStyle; h is the icon height
export function richWidth(ctx, str, h) {
  let w = 0;
  str.split(SPLIT).forEach((part, i) => { if (i % 2) w += padButtonWidth(part, h) + h * 0.16; else if (part) w += ctx.measureText(part).width; });
  return w;
}
export function drawRich(ctx, str, x, y, h) {
  const align = ctx.textAlign, base = ctx.textBaseline;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  str.split(SPLIT).forEach((part, i) => {
    if (i % 2) { const bw = padButtonWidth(part, h); x += h * 0.08; drawPadButton(ctx, part, x + bw / 2, y, h); x += bw + h * 0.08; }
    else if (part) { ctx.fillText(part, x, y); x += ctx.measureText(part).width; }
  });
  ctx.textAlign = align; ctx.textBaseline = base;
}
