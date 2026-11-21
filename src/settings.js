// Player settings (pause menu → Settings): music and effects volume, enemy hit indicators on / off.
// Kept in this browser's localStorage when it is available (a private window simply starts from the defaults).
const KEY = 'kage.settings';
// tele: enemy hit indicators 'off' | 'heavy' (only heavy enemies' and bosses' attacks) | 'on'
export const settings = { music: 1, sfx: 1, tele: 'off' }; // (they start off: the user's choice)
export const TELE_MODES = ['off', 'heavy', 'on'];

try {
  const s = JSON.parse(localStorage.getItem(KEY) || 'null');
  if (s && typeof s === 'object') {
    if (typeof s.music === 'number') settings.music = Math.min(1, Math.max(0, s.music));
    if (typeof s.sfx === 'number') settings.sfx = Math.min(1, Math.max(0, s.sfx));
    if (typeof s.tele === 'boolean') settings.tele = s.tele ? 'on' : 'off'; // (saved before the AoE option)
    else if (s.tele === 'aoe') settings.tele = 'heavy'; // (the option it replaced)
    else if (['off', 'heavy', 'on'].includes(s.tele)) settings.tele = s.tele;
  }
} catch (e) { /* no storage: defaults */ }

const listeners = [];
export function onSettings(fn) { listeners.push(fn); }
export function saveSettings() {
  try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) { /* no storage */ }
  for (const fn of listeners) fn(settings);
}
