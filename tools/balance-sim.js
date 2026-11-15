// Balance harness: paste-free. Load the game with ?god=1&weapons=a,b&level=N and call
// `await (await import('/tools/balance-sim.js')).runLevel()` from the console.
// A simple bot fights (no dodging, so damage taken is a pessimistic upper bound);
// the player gets (level-1) simulated upgrade picks first.
import { input as I } from '/src/input.js';
import { rollUpgrades, applyUpgrade } from '/src/cards.js';

const PRIORITY = { baseDamage: 5, critChance: 4, critDamage: 3, healthRegen: 2, energyRegen: 1 };

// how the bot fights with a weapon set: how close it stands, and when it uses the special (E)
// shield: bash from close in; Bulwark only when 2+ enemies are near enough to hit it (absorb, then release)
const PROFILES = {
  melee: { want: 1.4, special: (p) => p.energy > 60 },
  ranged: { want: 4, special: (p) => p.energy > 60 },
  shield: { want: 1.6, special: (p, near) => p.energy > 40 && near >= 2 },
};
const profileOf = (p) => (p.weapons.some((w) => w.key === 'shield') ? PROFILES.shield : p.weapons.every((w) => w.key === 'crossbow' || w.key === 'knives') ? PROFILES.ranged : PROFILES.melee);

function botStep(g) {
  const p = g.player;
  let best = null, bd = 99;
  for (const e of g.enemies) {
    if (e.dead || e.state === 'spawn' || e.hidden) continue;
    const d = Math.hypot(e.x - p.x, e.y - p.y);
    if (d < bd) { bd = d; best = e; }
  }
  ['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyQ', 'KeyE'].forEach((k) => I._keys.delete(k));
  I.mouse.down[0] = false; I.mouse.down[2] = false;
  if (!best) return;
  const [sx, sy] = g.view.toScreen(best.x, best.y, 0.5);
  I.mouse.x = sx / g.view.dpr; I.mouse.y = sy / g.view.dpr; I.mode = 'kbm';
  I._keys.add('KeyQ'); I.mouse.down[0] = true;
  const P = profileOf(p), ranged = P === PROFILES.ranged;
  const near = g.enemies.filter((e) => !e.dead && Math.hypot(e.x - p.x, e.y - p.y) < 2.5).length;
  if (P.special(p, near)) { I._keys.add('KeyE'); I.mouse.down[2] = true; }
  const want = P.want;
  const dx = best.x - p.x, dy = best.y - p.y, sxd = dx - dy, syd = dx + dy;
  const dir = bd > want ? 1 : ranged && bd < want - 1.5 ? -1 : 0;
  if (dir) {
    if (sxd * dir > 0.4) I._keys.add('KeyD'); if (sxd * dir < -0.4) I._keys.add('KeyA');
    if (syd * dir > 0.4) I._keys.add('KeyS'); if (syd * dir < -0.4) I._keys.add('KeyW');
  }
}

export function simulateUpgrades(player, picks) {
  for (let i = 0; i < picks; i++) {
    const cards = rollUpgrades(player);
    cards.sort((a, b) => b.rarity - a.rarity || (PRIORITY[b.stat] || 2.5) - (PRIORITY[a.stat] || 2.5));
    applyUpgrade(player, cards[0]);
  }
}

export async function runLevel(maxSeconds = 180) {
  const g = window.__game, p = g.player;
  g.god = false;
  simulateUpgrades(p, g.level - 1);
  let taken = 0, hits = 0;
  p.hurt = (dmg) => { if (p.iframes > 0) return false; taken += dmg; hits++; p.iframes = 0.55; return true; };
  let frames = 0;
  while (frames < maxSeconds * 60) {
    if (g.state === 'intro') g.intro.t = 99; // skip boss intros
    botStep(g); g.frame(1 / 60); frames++;
    if (g.state === 'cards' || g.state === 'victory') break;
    if (frames % 600 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { level: g.level, seconds: Math.round(frames / 60), cleared: g.state !== 'play', damageTaken: Math.round(taken), hits, kills: g.runStats.kills, stats: { ...p.stats } };
}
