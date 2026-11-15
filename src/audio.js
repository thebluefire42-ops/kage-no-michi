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
//
// Each area plays the tense version of its song (biome_N_tense; the chill versions were dropped).
// The mood-switch code below still handles a biome_N_chill / biome_N_tense pair if one is added: a mood change
// waits for the next bar of the playing version, then:
//  -> tense: the tense version comes in at its drop (or where it was left, if that was recent) with an
//     equal-power fade over ~1 bar while the chill version rises through a high-pass sweep and fades out
//  -> chill: the chill version picks up where it was left (never inside its intro) and fades in slowly
//     while the tense version sinks through a closing low-pass sweep
// Cue points (tempo, first beat, drop, end of intro) come from analysing the tracks: MUSIC_CUES.
const TRACKS = {
  main_menu: 'music/main_menu.mp3',
  biome_1_tense: 'music/biome_1_tense.mp3', biome_2_tense: 'music/biome_2_tense.mp3', biome_3_tense: 'music/biome_3_tense.mp3',
  biome_2_chill: 'music/biome_2_chill.mp3', // only for the area 2 cutscene, carrying on into level 11 (see game.updateMusic)
};
// bpm, beat0 = first downbeat (s), drop = where the tense action starts, introEnd = where the chill song settles,
// start = skip the near-silent lead-in when the song starts fresh, skip = quiet breakdowns a tense version jumps over (crossfading to the end of the range), end = loop point
export const MUSIC_CUES = {
  biome_1_tense: { bpm: 171.5, beat0: 0.125, start: 0.4, drop: 22.5 },
  biome_2_tense: { bpm: 120, beat0: 0.475, drop: 38.48 },
  biome_3_tense: { bpm: 88.75, beat0: 0.075, drop: 43.34 },
};
const MUSIC_VOL = 0.5, FADE_IN = 1.4, FADE_OUT = 1.0, OPEN_HZ = 20000, MUFFLED_HZ = 480, LOOP_XF = 4;
const TENSE_IN = 0.9, TENSE_OUT = 2.4;    // into tense: fast, punchy
const CHILL_IN = 4, CHILL_OUT = 4.5;      // back to chill: a smooth settle
const RESUME_WITHIN = 6;                  // re-entering a version this soon resumes where it was left (else: drop / intro end)
const songOf = (name) => (name || '').replace(/_(chill|tense)$/, '');
const moodOf = (name) => (/_tense$/.test(name || '') ? 'tense' : /_chill$/.test(name || '') ? 'chill' : null);
const mus = { want: null, muffled: false, playing: {}, bus: null, filter: null, pending: null, onMood: null };

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
// at: where in the song to start (seconds); applied once the length is known
function startVoice(V, fade, at = 0) {
  const now = ctx.currentTime;
  clearTimeout(V.stop);
  const seek = () => { const d = V.el.duration; V.el.currentTime = at > 0 && isFinite(d) ? Math.min(Math.max(0, d - LOOP_XF - 8), at) : 0; };
  if (at > 0 && !isFinite(V.el.duration)) { V.el.currentTime = 0; V.el.addEventListener('loadedmetadata', seek, { once: true }); } else seek();
  V.el.play().catch(() => {});
  V.g.gain.cancelScheduledValues(now); V.g.gain.setValueAtTime(fade ? 0 : 1, now);
  if (fade) V.g.gain.linearRampToValueAtTime(1, now + fade);
}
function stopVoice(V, fade) {
  const now = ctx.currentTime;
  V.g.gain.cancelScheduledValues(now); V.g.gain.setValueAtTime(V.g.gain.value, now); V.g.gain.linearRampToValueAtTime(0, now + fade);
  clearTimeout(V.stop); V.stop = setTimeout(() => V.el.pause(), fade * 1000 + 60);
}
// near the end of the playing voice: start the other one again (past its intro, for area songs) and crossfade
function loopTick() {
  if (!ctx || ctx.state !== 'running') return;
  for (const T of Object.values(mus.playing)) {
    if (T.out) continue;
    const V = T.voices[T.cur], el = V.el, d = el.duration;
    if (el.paused || !isFinite(d) || d < LOOP_XF * 3) continue;
    const cue = MUSIC_CUES[T.name], t = el.currentTime;
    const end = Math.min(d, (cue && cue.end) || d); // songs play straight through (no jumps), looping at the end
    if (end - t <= LOOP_XF) {
      const xf = Math.max(0.5, end - t);
      T.cur = 1 - T.cur;
      startVoice(T.voices[T.cur], xf, (cue && cue.start) || 0); // loop back to the top of the song
      stopVoice(V, xf);
    }
  }
}

// voices -> track gain -> track filter (for the mood sweeps) -> shared muffle filter
function track(name) {
  let T = mus.playing[name];
  if (!T) {
    const gain = ctx.createGain(); gain.gain.value = 0;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = OPEN_HZ; filter.Q.value = 0.7;
    gain.connect(filter); filter.connect(mus.filter);
    T = mus.playing[name] = { name, gain, filter, out: true, cur: 0, voices: [], leftAt: -1, leftWhen: -1e9 };
    T.voices = [voice(name, T), voice(name, T)];
  }
  return T;
}
const curTime = (T) => { const el = T.voices[T.cur].el; return el.paused ? -1 : el.currentTime; };

// equal-power gain curves (sin in, cos out), starting from the current value
function curve(param, from, to, dur) {
  const now = ctx.currentTime, n = 32, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i / (n - 1);
    c[i] = to > from ? from + (to - from) * Math.sin(k * Math.PI / 2) : to + (from - to) * Math.cos(k * Math.PI / 2);
  }
  param.cancelScheduledValues(now);
  try { param.setValueCurveAtTime(c, now, Math.max(0.05, dur)); } catch (e) { param.setValueAtTime(from, now); param.linearRampToValueAtTime(to, now + dur); }
}
function resetFilter(T) {
  const now = ctx.currentTime, f = T.filter;
  f.frequency.cancelScheduledValues(now); f.type = 'lowpass'; f.frequency.setValueAtTime(OPEN_HZ, now);
}
function fadeOutTrack(T, dur, sweep) {
  if (T.out) return;
  T.out = true;
  T.leftAt = curTime(T); T.leftWhen = ctx.currentTime;
  curve(T.gain.gain, T.gain.gain.value, 0, dur);
  const now = ctx.currentTime, f = T.filter;
  f.frequency.cancelScheduledValues(now);
  if (sweep === 'rise') { f.type = 'highpass'; f.frequency.setValueAtTime(30, now); f.frequency.exponentialRampToValueAtTime(900, now + dur); }
  else if (sweep === 'sink') { f.type = 'lowpass'; f.frequency.setValueAtTime(OPEN_HZ, now); f.frequency.exponentialRampToValueAtTime(500, now + dur); }
  clearTimeout(T.stop); T.stop = setTimeout(() => { for (const V of T.voices) V.el.pause(); resetFilter(T); }, dur * 1000 + 80);
}
// where a version (re)starts: where it was left if that was recent, else its cue point
function entryPoint(T) {
  const cue = MUSIC_CUES[T.name] || {};
  // tense versions take turns between their drops, so each burst of action hits a fresh drop
  const first = cue.drop ?? cue.introEnd ?? 0;
  const recent = T.leftAt >= 0 && ctx.currentTime - T.leftWhen < RESUME_WITHIN;
  if (recent) return Math.max(first, T.leftAt); // a quick flip back: carry on where it was
  if (!cue.drops) return first;
  T.dropI = ((T.dropI ?? -1) + 1) % cue.drops.length;
  return cue.drops[T.dropI];
}
// seconds until the next bar line (or just the next beat) of a playing track (0 if unknown)
function toNextBar(T, beats = 4) {
  const cue = MUSIC_CUES[T.name], t = curTime(T);
  if (!cue || t < 0) return 0;
  const bar = (60 / cue.bpm) * beats, k = (t - cue.beat0) / bar;
  let w = (Math.ceil(k) - k) * bar;
  if (w < 0.08) w += bar;
  return w > 2.6 ? w - bar / 2 > 0.08 ? w - bar / 2 : w : w; // slow songs: half-bar is close enough
}

function syncMusic() {
  if (!musicBus() || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const name = mus.want;
  const live = Object.values(mus.playing).find((T) => !T.out && T.name !== name);
  // a mood change of the same song: wait for the bar line, then switch with the mood's transition
  if (name && live && songOf(live.name) === songOf(name) && moodOf(name) && moodOf(live.name)) {
    clearTimeout(mus.pending);
    const want = name, wait = toNextBar(live, moodOf(name) === 'tense' ? 1 : 4); // into tense: on the next beat; back to chill: on the bar
    mus.pending = setTimeout(() => { mus.pending = null; if (mus.want === want) moodSwitch(live, track(want)); }, wait * 1000);
    return;
  }
  clearTimeout(mus.pending); mus.pending = null;
  for (const T of Object.values(mus.playing)) if (T.name !== name) fadeOutTrack(T, FADE_OUT);
  if (!name || !TRACKS[name]) return;
  const T = track(name);
  // load the other version of this song too, so a mood change can start right away
  for (const k of Object.keys(TRACKS)) if (k !== name && songOf(k) === songOf(name)) track(k);
  const cur = T.voices[T.cur];
  if (!T.out && !cur.el.paused) return; // already playing
  clearTimeout(T.stop); resetFilter(T);
  if (cur.el.paused) { T.voices[1 - T.cur].el.pause(); startVoice(cur, 0, (MUSIC_CUES[name] && MUSIC_CUES[name].start) || 0); } // a newly queued song starts from the top (past any silent lead-in)
  T.out = false;
  T.gain.gain.cancelScheduledValues(now); T.gain.gain.setValueAtTime(T.gain.gain.value, now); T.gain.gain.linearRampToValueAtTime(1, now + FADE_IN);
}

function moodSwitch(from, to) {
  const tense = moodOf(to.name) === 'tense';
  fadeOutTrack(from, tense ? TENSE_OUT : CHILL_OUT, tense ? 'rise' : 'sink');
  clearTimeout(to.stop); resetFilter(to);
  const cur = to.voices[to.cur];
  if (to.out || cur.el.paused) {
    to.voices[1 - to.cur].el.pause();
    if (cur.el.paused) startVoice(cur, 0, entryPoint(to)); else cur.g.gain.setValueAtTime(1, ctx.currentTime);
  }
  to.out = false;
  curve(to.gain.gain, to.gain.gain.value, 1, tense ? TENSE_IN : CHILL_IN);
  if (mus.onMood) mus.onMood(tense ? 'tense' : 'chill');
}

export const music = {
  // which track should be playing (null = silence); safe to call every frame
  set(name) { if (name === mus.want) return; mus.want = name; syncMusic(); },
  // called when a mood switch actually happens (on the bar line): 'tense' | 'chill'
  set onMood(fn) { mus.onMood = fn; },
  // beat phase (0..1) and bpm of the song playing now, for visuals that pulse with the music
  beat() {
    const T = mus.playing[mus.want], cue = T && MUSIC_CUES[T.name];
    if (!T || !cue || T.out) return null;
    const t = curTime(T); if (t < 0) return null;
    const b = 60 / cue.bpm;
    const x = (t - cue.beat0) / b;
    return { phase: ((x % 1) + 1) % 1, n: Math.floor(x), bpm: cue.bpm };
  },
  // muffle(on, hz): low-pass the music down to hz (default: the heavy menu muffle)
  muffle(on, hz = MUFFLED_HZ) {
    const target = on ? hz : OPEN_HZ;
    if (on === mus.muffled && Math.abs((mus.hz || OPEN_HZ) - target) < target * 0.04) return;
    mus.muffled = on; mus.hz = target;
    if (mus.filter) { const now = ctx.currentTime; mus.filter.frequency.cancelScheduledValues(now); mus.filter.frequency.setTargetAtTime(target, now, on ? 0.12 : 0.25); }
  },
  get track() { return mus.want; },
  // seconds into a track that is playing (-1 if it is not)
  timeOf(name) { const T = mus.playing[name]; return T && !T.out ? curTime(T) : -1; },
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
  if (!Number.isFinite(freq) || !Number.isFinite(dur) || !Number.isFinite(gain) || (slideTo != null && !Number.isFinite(slideTo))) return; // a bad value must never throw mid-game
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
  caw(pitch = 1, delay = 0) { if (!ready()) return; const f = 560 * pitch; tone(f, 0.26, 'sawtooth', 0.06, f * 0.6, delay, 0.025); tone(f * 1.51, 0.22, 'square', 0.025, f * 0.85, delay, 0.025); noise(0.24, 1300 * pitch, 1.4, 0.12, 'bandpass', 700 * pitch, delay); },
  bird() { if (!ready()) return; const f = 2400 + Math.random() * 1200; tone(f, 0.08, 'sine', 0.03, f * 1.4); tone(f * 1.2, 0.07, 'sine', 0.025, f * 0.9, 0.11); },
  bossRoar() { if (!ready()) return; tone(90, 1.0, 'sawtooth', 0.25, 45); noise(1, 300, 0.4, 0.4, 'lowpass', 80); },
  // ---- weapon voices: each weapon has its own swing and hit sounds
  // katanas: light, high metallic "shing"; the 3rd cut of the rhythm rings brighter and longer
  katana(step = 0) {
    if (!ready() || !throttle('katana', 30)) return;
    const p = 1 + (Math.random() - 0.5) * 0.12 + (step === 2 ? 0.12 : 0), big = step === 2;
    noise(0.09, 7200 * p, 2.2, 0.2, 'bandpass', 3200 * p);
    tone(2900 * p, big ? 0.34 : 0.15, 'sine', big ? 0.07 : 0.04, 3300 * p);
    tone(4350 * p, big ? 0.24 : 0.09, 'sine', big ? 0.035 : 0.022, 4100 * p, 0.005);
  },
  cut() { if (!ready() || !throttle('cut', 35)) return; noise(0.05, 5200, 1.6, 0.22, 'highpass', 2600); tone(1900 + Math.random() * 400, 0.06, 'triangle', 0.05, 1200); },
  // heavy sword: a deep whoosh, a low metal thud on impact (k = charge 0..1), a crunch on each enemy
  heavyWhoosh(k = 0) { if (!ready()) return; noise(0.3 + k * 0.15, 520, 0.8, 0.3 + k * 0.15, 'bandpass', 150); },
  heavyThud(k = 0) {
    if (!ready()) return;
    tone(68, 0.5 + k * 0.3, 'sine', 0.55, 36);
    tone(150, 0.22, 'triangle', 0.22, 78);
    tone(310, 0.26 + k * 0.1, 'square', 0.045 + k * 0.03, 236); // the iron ringing
    tone(463, 0.18, 'square', 0.025, 380);
    noise(0.35 + k * 0.2, 700, 0.6, 0.45, 'lowpass', 90);
  },
  heavyHit() { if (!ready() || !throttle('hhit', 40)) return; tone(110, 0.18, 'sine', 0.38, 52); noise(0.12, 1200, 0.7, 0.28, 'lowpass', 200); },
  heavyCharge(k = 0.6) { if (!Number.isFinite(k)) k = 0.6; if (!ready() || !throttle('hcharge', 140)) return; tone(52 + k * 46, 0.2, 'sawtooth', 0.045 + k * 0.04, 58 + k * 56); noise(0.15, 300 + k * 320, 0.7, 0.07, 'bandpass', 520 + k * 520); },
  heavyReady() { if (!ready()) return; tone(196, 0.55, 'triangle', 0.1, 192); tone(392, 0.4, 'sine', 0.06, 390, 0.02); noise(0.2, 3000, 2, 0.05, 'highpass', 6000); },
  // crossbow: the string creaks while it is drawn, clicks when locked, twangs on release; bolts land with a thunk
  stringDraw(k) { if (!ready() || !throttle('string', 105)) return; const f = 170 + k * 280; tone(f, 0.09, 'sawtooth', 0.032, f * 1.15); noise(0.07, 1400 + k * 1600, 3, 0.055, 'bandpass', 2000 + k * 1800); },
  stringLock() { if (!ready()) return; tone(1500, 0.05, 'square', 0.05, 900); noise(0.04, 4000, 2, 0.12, 'highpass', 2500); },
  twang(k = 1) { if (!ready()) return; tone(250 + k * 90, 0.3, 'triangle', 0.16, 115); tone(500 + k * 180, 0.12, 'sine', 0.05, 240); noise(0.1, 2600, 1.2, 0.18, 'bandpass', 900); },
  thunk() { if (!ready() || !throttle('thunk', 40)) return; tone(150, 0.14, 'sine', 0.5, 68); noise(0.08, 900, 0.8, 0.35, 'lowpass', 200); tone(420, 0.05, 'triangle', 0.08, 250); },
  // throwing knives: a few different whooshes, and a bright metal tick on hit
  knifeThrow() {
    if (!ready() || !throttle('throw', 30)) return;
    const v = Math.floor(Math.random() * 3), p = 0.85 + Math.random() * 0.35;
    if (v === 0) noise(0.08, 5200 * p, 2.5, 0.2, 'bandpass', 2400 * p);
    else if (v === 1) { noise(0.06, 3600 * p, 3, 0.16, 'bandpass', 6500 * p); noise(0.05, 6000 * p, 3, 0.1, 'bandpass', 3000 * p, 0.05); }
    else { noise(0.11, 2800 * p, 1.6, 0.18, 'bandpass', 5200 * p); tone(5200 * p, 0.04, 'sine', 0.02, 7000 * p); }
  },
  knifeHit() { if (!ready() || !throttle('khit', 35)) return; const p = 0.9 + Math.random() * 0.25; tone(3100 * p, 0.05, 'triangle', 0.06, 2200 * p); noise(0.03, 7000, 2, 0.15, 'highpass', 4000); },
  // monk staff: the shakujo's rings jingle on each cast; its blessings ring like a temple bell (rin)
  shakujo() {
    if (!ready() || !throttle('shakujo', 60)) return;
    for (let i = 0; i < 4; i++) { const f = 2600 + Math.random() * 1400; tone(f, 0.25, 'sine', 0.032, f * 0.995, i * 0.035 + Math.random() * 0.02); }
    noise(0.12, 7000, 3, 0.05, 'highpass', 5000);
  },
  rin(p = 1) {
    if (!ready() || !throttle('rin', 70)) return;
    const f = 880 * p;
    tone(f, 1.4, 'sine', 0.085, f * 0.998, 0, 0.004); tone(f * 1.004, 1.2, 'sine', 0.05, null, 0.01);
    tone(f * 2.76, 0.8, 'sine', 0.032, f * 2.75, 0, 0.004); tone(f * 5.4, 0.35, 'sine', 0.014, null, 0, 0.004);
  },
  // bo: a wooden "tok", one step higher with each hit of the combo
  tok(step = 0) {
    if (!ready() || !throttle('tok', 30)) return;
    const f = 560 * Math.pow(1.26, step) * (0.97 + Math.random() * 0.06);
    tone(f, 0.07, 'triangle', 0.32, f * 0.92, 0, 0.002); tone(f * 2.4, 0.03, 'sine', 0.08, null, 0, 0.002); noise(0.03, f * 3, 2, 0.14, 'bandpass');
  },
  // shishi shield: a bright ting when a projectile is turned back, a heavy thump for the bash,
  // a dull clang for each hit the Bulwark soaks up and a deep boom when it is released
  ting() { if (!ready() || !throttle('ting', 40)) return; const p = 0.95 + Math.random() * 0.1; tone(2600 * p, 0.45, 'sine', 0.08, 2580 * p, 0, 0.002); tone(3920 * p, 0.25, 'sine', 0.04, null, 0, 0.002); noise(0.05, 8000, 2, 0.12, 'highpass', 5000); },
  thump() { if (!ready() || !throttle('thump', 40)) return; tone(92, 0.26, 'sine', 0.5, 50); tone(210, 0.1, 'triangle', 0.18, 120); noise(0.14, 500, 0.7, 0.4, 'lowpass', 120); },
  absorb() { if (!ready() || !throttle('absorb', 50)) return; tone(170, 0.2, 'square', 0.06, 150); tone(255, 0.16, 'triangle', 0.07, 230); noise(0.12, 650, 1, 0.22, 'bandpass', 380); },
  release() { if (!ready()) return; tone(48, 1.1, 'sine', 0.6, 30); tone(74, 0.7, 'sawtooth', 0.1, 40); tone(220, 0.9, 'triangle', 0.06, 205); noise(0.9, 320, 0.6, 0.55, 'lowpass', 40); },
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
