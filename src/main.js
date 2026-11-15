// Entry point: boot input/audio, then run the frame loop.
import { input } from './input.js';
import { initAudio } from './audio.js';
import { Game } from './game.js';

const canvas = document.getElementById('game');
input.init(canvas);

// Browsers only allow audio after a user gesture.
const unlock = () => initAudio();
addEventListener('keydown', unlock);
addEventListener('mousedown', unlock);
addEventListener('gamepadconnected', unlock);

// a short message in the corner when a frame throws, so a bug shows up instead of a frozen screen
let errBox = null;
function reportError(e) {
  console.error(e);
  if (!errBox) {
    errBox = document.createElement('div');
    errBox.style.cssText = 'position:fixed;left:10px;bottom:10px;z-index:6;max-width:60vw;padding:8px 12px;background:rgba(40,8,12,0.9);color:#ffd0c0;font:600 12px monospace;white-space:pre-wrap;border:1px solid #c8302e;border-radius:4px;pointer-events:none';
    document.body.append(errBox);
  }
  errBox.textContent = `Error: ${e && e.message ? e.message : e}\n${(e && e.stack ? e.stack.split('\n').slice(1, 3).join('\n') : '')}`;
}

async function boot() {
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* fonts optional */ }
  let game;
  try { game = new Game(canvas); } catch (e) { if (window.__bootError) window.__bootError(String(e && e.stack || e)); throw e; }
  window.__game = game; // handy for debugging in the console
  let last = performance.now(), first = true, errors = 0;
  const loop = (now) => {
    requestAnimationFrame(loop); // keep the loop alive even if this frame fails
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); // never negative: the first frame stamp can predate the start time
    last = now;
    try {
      // gamepad presses also try to unlock audio
      if (input.pad.connected && input.mode === 'pad') initAudio();
      game.frame(dt);
      if (first) { first = false; const ld = document.getElementById('loading'); if (ld) ld.remove(); }
    } catch (e) { if (errors++ < 5) reportError(e); }
  };
  requestAnimationFrame(loop);
}
boot();
