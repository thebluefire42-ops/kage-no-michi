// Small synthesized sound effects with Web Audio (no audio files needed).
let ctx = null, master = null, noiseBuf = null;
const last = {};

export function initAudio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.45;
      const comp = ctx.createDynamicsCompressor();
      master.connect(comp); comp.connect(ctx.destination);
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume().then(syncMusic, () => {});
    syncMusic();
  } catch (e) { /* audio unavailable */ }
}

// ---------------------------------------------------------------- music
// Looping tracks streamed from music/. Only one plays at a time; switching crossfades.
// Each track has two players (A/B): shortly before the end, the other one starts the song from the top
// and they crossfade, so the loop point is a smooth mix instead of a hard cut.
// muffle(true) closes a low-pass filter so only the low end comes through (menus, dialogue).
const TRACKS = {
  main_menu: 'music/main_menu.mp3',
  biome_1: 'music/biome_1.mp3', biome_2: 'music/biome_2.mp3', biome_3: 'music/biome_3.mp3', biome_4: 'music/biome_4.mp3',
};
const MUSIC_VOL = 0.5, FADE_IN = 1.4, FADE_OUT = 1.0, OPEN_HZ = 20000, MUFFLED_HZ = 480, LOOP_XF = 4;
const mus = { want: null, muffled: false, playing: {}, bus: null, filter: null };

function musicBus() {
  if (mus.bus) return true;
  if (!ctx) return false;
  mus.filter = ctx.createBiquadFilter(); mus.filter.type = 'lowpass'; mus.filter.Q.value = 0.8;
  mus.filter.frequency.value = mus.muffled ? MUFFLED_HZ : OPEN_HZ;
  mus.bus = ctx.createGain(); mus.bus.gain.value = MUSIC_VOL;
  mus.filter.connect(mus.bus); mus.bus.connect(ctx.destination); // past the SFX compressor so hits don't duck the music
  setInterval(loopTick, 200);
  return true;
}

// one of a track's two players: element -> its own gain -> the track gain
function voice(name, T) {
  const el = new Audio(TRACKS[name]); el.preload = 'auto'; el.loop = false;
  const g = ctx.createGain(); g.gain.value = 0;
  ctx.createMediaElementSource(el).connect(g); g.connect(T.gain);
  const V = { el, g, stop: 0 };
  // safety net: if the crossfade was missed (e.g. the tab was asleep), restart from the top
  el.addEventListener('ended', () => { if (T.voices[T.cur] === V && !T.out) startVoice(V, 0.05); });
  return V;
}
function startVoice(V, fade) {
  const now = ctx.currentTime;
  clearTimeout(V.stop);
  V.el.currentTime = 0; V.el.play().catch(() => {});
  V.g.gain.cancelScheduledValues(now); V.g.gain.setValueAtTime(fade ? 0 : 1, now);
  if (fade) V.g.gain.linearRampToValueAtTime(1, now + fade);
}
function stopVoice(V, fade) {
  const now = ctx.currentTime;
  V.g.gain.cancelScheduledValues(now); V.g.gain.setValueAtTime(V.g.gain.value, now); V.g.gain.linearRampToValueAtTime(0, now + fade);
  clearTimeout(V.stop); V.stop = setTimeout(() => V.el.pause(), fade * 1000 + 60);
}
// near the end of the playing voice: start the other one from the top and crossfade
function loopTick() {
  if (!ctx || ctx.state !== 'running') return;
  for (const T of Object.values(mus.playing)) {
    if (T.out) continue;
    const V = T.voices[T.cur], el = V.el, d = el.duration;
    if (el.paused || !isFinite(d) || d < LOOP_XF * 3) continue;
    if (d - el.currentTime <= LOOP_XF) {
      const xf = Math.max(0.5, d - el.currentTime);
      T.cur = 1 - T.cur;
      startVoice(T.voices[T.cur], xf);
      stopVoice(V, xf);
    }
  }
}

function syncMusic() {
  if (!musicBus() || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  for (const [name, T] of Object.entries(mus.playing)) {
    if (name === mus.want) continue;
    if (T.out) continue;
    T.out = true;
    T.gain.gain.cancelScheduledValues(now); T.gain.gain.setValueAtTime(T.gain.gain.value, now); T.gain.gain.linearRampToValueAtTime(0, now + FADE_OUT);
    clearTimeout(T.stop); T.stop = setTimeout(() => { for (const V of T.voices) V.el.pause(); }, FADE_OUT * 1000 + 50);
  }
  const name = mus.want;
  if (!name || !TRACKS[name]) return;
  let T = mus.playing[name];
  if (!T) {
    const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(mus.filter);
    T = mus.playing[name] = { gain, out: true, cur: 0, voices: [] };
    T.voices = [voice(name, T), voice(name, T)];
  }
  const cur = T.voices[T.cur];
  if (!T.out && !cur.el.paused) return; // already playing
  clearTimeout(T.stop);
  if (cur.el.paused) { T.voices[1 - T.cur].el.pause(); startVoice(cur, 0); } // a newly queued track starts from the top
  T.out = false;
  T.gain.gain.cancelScheduledValues(now); T.gain.gain.setValueAtTime(T.gain.gain.value, now); T.gain.gain.linearRampToValueAtTime(1, now + FADE_IN);
}

export const music = {
  // which track should be playing (null = silence); safe to call every frame
  set(name) { if (name === mus.want) return; mus.want = name; syncMusic(); },
  muffle(on) {
    if (on === mus.muffled) return;
    mus.muffled = on;
    if (mus.filter) { const now = ctx.currentTime; mus.filter.frequency.cancelScheduledValues(now); mus.filter.frequency.setTargetAtTime(on ? MUFFLED_HZ : OPEN_HZ, now, on ? 0.12 : 0.25); }
  },
  get track() { return mus.want; },
  get muffled() { return mus.muffled; },
  debug() { return Object.fromEntries(Object.entries(mus.playing).map(([k, T]) => [k, { cur: T.cur, out: T.out, gain: +T.gain.gain.value.toFixed(2), voices: T.voices.map((V) => ({ paused: V.el.paused, t: +V.el.currentTime.toFixed(1), dur: +(V.el.duration || 0).toFixed(1), g: +V.g.gain.value.toFixed(2) })) }])); },
  // test hook: jump the playing voice to just before the loop point
  seekNearEnd(sec = 6) { const T = mus.playing[mus.want]; if (!T) return; const el = T.voices[T.cur].el; if (isFinite(el.duration)) el.currentTime = Math.max(0, el.duration - sec); },
  get filterHz() { return mus.filter ? Math.round(mus.filter.frequency.value) : null; },
};

function ready() { return ctx && ctx.state === 'running'; }

function noise(dur, freq, q, gain, type = 'bandpass', sweepTo = null, delay = 0) {
  const t = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.02);
}

function tone(freq, dur, type, gain, slideTo = null, delay = 0, attack = 0.005) {
  const t = ctx.currentTime + delay;
  const o = ctx.createOscillator();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

function throttle(name, ms) {
  const now = performance.now();
  if (last[name] && now - last[name] < ms) return false;
  last[name] = now; return true;
}

const PENTA = [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1174.66, 1318.5];

export const sfx = {
  slash() { if (!ready() || !throttle('slash', 40)) return; noise(0.12, 3200, 0.9, 0.28, 'bandpass', 900); },
  heavy() { if (!ready()) return; noise(0.25, 1400, 0.7, 0.4, 'bandpass', 300); tone(110, 0.2, 'sine', 0.25, 60); },
  hit() { if (!ready() || !throttle('hit', 35)) return; tone(160, 0.1, 'sine', 0.4, 60); noise(0.05, 1800, 1, 0.22); },
  crit() { if (!ready() || !throttle('crit', 50)) return; tone(1200, 0.12, 'triangle', 0.18, 700); noise(0.08, 5000, 2, 0.2); },
  dash() { if (!ready()) return; noise(0.2, 700, 0.7, 0.25, 'bandpass', 3200); },
  shoot() { if (!ready() || !throttle('shoot', 40)) return; tone(420, 0.09, 'triangle', 0.2, 160); noise(0.06, 2500, 1.5, 0.15); },
  throwKnife() { if (!ready() || !throttle('throw', 30)) return; noise(0.08, 5000, 2.5, 0.18, 'bandpass', 2500); },
  explode() { if (!ready() || !throttle('explode', 60)) return; noise(0.6, 600, 0.5, 0.6, 'lowpass', 50); tone(70, 0.45, 'sine', 0.5, 30); },
  clang() { if (!ready() || !throttle('clang', 60)) return; tone(1650, 0.16, 'square', 0.06, 1400); tone(2470, 0.12, 'triangle', 0.08, 2200); noise(0.05, 4000, 2, 0.15); },
  slam() { if (!ready()) return; noise(0.5, 400, 0.5, 0.6, 'lowpass', 40); tone(55, 0.5, 'sine', 0.6, 30); },
  death() { if (!ready() || !throttle('death', 40)) return; noise(0.3, 900, 0.8, 0.22, 'bandpass', 200); },
  hurt() { if (!ready()) return; tone(240, 0.22, 'sawtooth', 0.18, 90); noise(0.1, 800, 1, 0.25); },
  enemyShoot() { if (!ready() || !throttle('eshoot', 60)) return; tone(700, 0.08, 'square', 0.06, 300); },
  spawn() { if (!ready() || !throttle('spawn', 80)) return; noise(0.35, 500, 0.6, 0.15, 'bandpass', 2000); },
  flip() { if (!ready()) return; noise(0.06, 3500, 1.2, 0.18, 'bandpass', 1500); },
  select() { if (!ready()) return; tone(880, 0.12, 'triangle', 0.18); tone(1320, 0.18, 'triangle', 0.12, null, 0.05); },
  move() { if (!ready() || !throttle('move', 60)) return; tone(520, 0.05, 'triangle', 0.1); },
  gong() {
    if (!ready()) return;
    [110, 220.5, 331, 443].forEach((f, i) => tone(f, 2.2 - i * 0.3, 'sine', 0.22 / (i + 1), f * 0.99));
  },
  chime(rarity = 0) {
    if (!ready()) return;
    const n = 3 + rarity * 2;
    for (let i = 0; i < n; i++) tone(PENTA[i % PENTA.length] * (i >= 8 ? 2 : 1), 0.6, 'sine', 0.12, null, i * 0.06);
    if (rarity >= 3) { tone(1568, 1.4, 'triangle', 0.08, null, n * 0.06); noise(0.9, 8000, 1, 0.1, 'highpass', 12000, 0.1); }
  },
  gate() { if (!ready()) return; [392, 523.25, 659.25, 783.99].forEach((f, i) => tone(f, 1, 'sine', 0.12, null, i * 0.09)); },
  zap() { if (!ready() || !throttle('zap', 70)) return; noise(0.12, 6000, 3, 0.18, 'bandpass', 2000); tone(1800, 0.08, 'square', 0.05, 600); },
  bird() { if (!ready()) return; const f = 2400 + Math.random() * 1200; tone(f, 0.08, 'sine', 0.03, f * 1.4); tone(f * 1.2, 0.07, 'sine', 0.025, f * 0.9, 0.11); },
  bossRoar() { if (!ready()) return; tone(90, 1.0, 'sawtooth', 0.25, 45); noise(1, 300, 0.4, 0.4, 'lowpass', 80); },
  // retro text blip; pitch = speaker voice
  blip(pitch = 1) { if (!ready() || !throttle('blip', 45)) return; tone(330 * pitch * (0.97 + Math.random() * 0.06), 0.045, 'square', 0.035); },
  // katana leaving its sheath (charge) / the cut itself
  iai() { if (!ready()) return; noise(0.35, 2200, 2, 0.18, 'bandpass', 7000); tone(2600, 0.25, 'sine', 0.05, 3400); },
  iaiCut() { if (!ready()) return; noise(0.18, 6000, 1.5, 0.35, 'highpass', 1500); tone(1800, 0.3, 'triangle', 0.12, 400); },
  // war horn: the regent calls his guard
  horn() { if (!ready()) return; tone(98, 1.3, 'sawtooth', 0.14, 92, 0, 0.25); tone(147, 1.2, 'sawtooth', 0.08, 140, 0.05, 0.25); noise(1.2, 300, 0.5, 0.12, 'lowpass', 200); },
  seal() { if (!ready() || !throttle('seal', 80)) return; tone(220, 0.4, 'triangle', 0.1, 880); },
  // lub-dub: two low thumps (the monk's sacrifice screen)
  heartbeat() { if (!ready()) return; tone(62, 0.16, 'sine', 0.5, 40); noise(0.08, 160, 0.7, 0.18, 'lowpass', 60); tone(56, 0.18, 'sine', 0.38, 36, 0.24); noise(0.08, 140, 0.7, 0.12, 'lowpass', 50, 0.24); },
};
