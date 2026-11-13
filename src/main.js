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

async function boot() {
  try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch (e) { /* fonts optional */ }
  const game = new Game(canvas);
  window.__game = game; // handy for debugging in the console
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    // gamepad presses also try to unlock audio
    if (input.pad.connected && input.mode === 'pad') initAudio();
    game.frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
boot();
