// The job lists. Every suite is built the same way in every shard, so a shard just takes every n-th job.
import { WEAPON_ORDER, WEAPONS, BIOME_POOLS, DOJO_POOL, LIBRARY_POOL, UPGRADES, ELEMENTS, ENEMIES, RARITIES } from '../../src/config.js';
import { ARTS } from '../../src/arts.js';

const RANGED = ['crossbow', 'knives', 'staff', 'orb'];
const filler = (w) => (w === 'katanas' ? 'bo' : 'katanas'); // the unused second weapon of a solo-weapon test
// a "typical" player: attacking 70% of the time, a little sloppy with the aim
export const TYPICAL = { uptime: 0.7, aimErr: 8 };
// playstyles: from standing still and swinging, to dodging half of the time; perfect aim or sloppy;
// ranged weapons also at point-blank range (3 tiles) as well as at their comfortable reach
export function styleGrid(w) {
  const out = [];
  for (const uptime of [1, 0.7, 0.45]) for (const aimErr of [0, 14]) {
    out.push({ uptime, aimErr, tag: `up${uptime}-aim${aimErr}` });
    if (RANGED.includes(w)) out.push({ uptime, aimErr, range: 3, tag: `up${uptime}-aim${aimErr}-close` });
  }
  return out;
}
// a representative level for each area (and the special rooms)
export const AREA_LEVEL = [6, 15, 25, 32];
export const ROOMS = [
  ...BIOME_POOLS.map((pool, a) => ({ room: `area${a + 1}`, level: AREA_LEVEL[a], pool })),
  { room: 'dojo', level: 15, pool: DOJO_POOL },
  { room: 'library', level: 15, pool: LIBRARY_POOL },
];

export function buildSuite(name) {
  const jobs = [];
  const add = (j) => jobs.push({ id: jobs.length, dur: 40, seed: 1000 + jobs.length, ...(j.weapon ? { weaponName: WEAPONS[j.weapon].name } : {}), ...j });
  if (name === 'smoke') {
    add({ weapons: ['katanas', 'bo'], use: 'A', specials: 'always', target: { type: 'dummy' }, style: TYPICAL, dur: 10 });
    add({ weapons: ['crossbow', 'katanas'], use: 'A', specials: 'always', target: { type: 'bandit', level: 6 }, style: TYPICAL, dur: 10 });
    add({ weapons: ['knives', 'katanas'], use: 'A', specials: 'always', target: { type: 'dummy', count: 4, layout: 'cluster' }, style: TYPICAL, dur: 10 });
    add({ weapons: ['orb', 'katanas'], use: 'A', specials: 'always', target: { type: 'bandit', level: 6 }, style: TYPICAL, dur: 10 });
  }
  // 1. every weapon alone on dummies, across the playstyle grid: one target and a tight group of four
  if (name === 'weapons') {
    for (const w of WEAPON_ORDER) for (const specials of ['never', 'always']) for (const st of styleGrid(w))
      for (const tg of [{ count: 1, layout: 'single' }, { count: 4, layout: 'cluster' }]) for (const seed of [1, 2])
        add({ suite: name, weapon: w, weapons: [w, filler(w)], use: 'A', specials, style: st, target: { type: 'dummy', ...tg }, seed: seed * 7919 + jobs.length });
  }
  // 2. every weapon against every enemy type of every room, one at a time (they come back after each kill):
  //    time to kill and kills per minute, real health, shields and all. Two playstyles.
  if (name === 'enemies') {
    for (const R of ROOMS) for (const type of R.pool) for (const w of WEAPON_ORDER) for (const st of [TYPICAL, { uptime: 0.45, aimErr: 14 }])
      add({ suite: name, weapon: w, room: R.room, enemy: type, enemyName: ENEMIES[type].name, heavy: !!ENEMIES[type].heavy, shield: !!ENEMIES[type].shield, weapons: [w, filler(w)], use: 'A', specials: 'always', style: st, target: { type, level: R.level } });
  }
  // 3. every weapon (one per run) against a mixed group of four of each area's regular enemies (saved as 'pairs'
  //    for the report; the 'pair' key is just the weapon since the one-weapon change)
  if (name === 'pairs') {
    for (const w of WEAPON_ORDER) for (let ar = 0; ar < 4; ar++) for (const st of [TYPICAL, { uptime: 0.45, aimErr: 14 }]) for (const seed of [1, 2]) {
      const pool = BIOME_POOLS[ar].filter((t) => !ENEMIES[t].heavy);
      add({ suite: name, weapon: w, pair: w, room: `area${ar + 1}`, weapons: [w, filler(w)], use: 'A', specials: 'always', style: st, target: { types: pool, level: AREA_LEVEL[ar], count: 4, layout: 'spread' }, seed: seed * 104729 + jobs.length });
    }
  }
  // 4. what one card / element / technique adds, per weapon, for a typical player on one dummy and on a group
  if (name === 'cards') {
    for (const w of WEAPON_ORDER) for (const tg of [{ count: 1, layout: 'single' }, { count: 4, layout: 'cluster' }]) for (const seed of [1, 2, 3, 4, 5, 6]) {
      const base = { suite: name, weapon: w, weapons: [w, filler(w)], use: 'A', specials: 'always', style: TYPICAL, target: { type: 'dummy', ...tg }, group: tg.count > 1, seed };
      add({ ...base, card: 'baseline', kind: 'baseline' });
      for (const stat of ['baseDamage', 'critChance', 'critDamage', 'kiCost'])
        UPGRADES[stat].values.forEach((value, rarity) => add({ ...base, card: stat, label: UPGRADES[stat].name, rarityName: RARITIES[rarity].name, kind: 'stat', rarity, cards: [{ type: 'stat', stat, rarity, value }] }));
      for (const el of ['lightning', 'poison', 'arcane', 'burn'])
        for (const rarity of [1, 3]) add({ ...base, card: el, label: ELEMENTS[el].name, rarityName: RARITIES[rarity].name, kind: 'element', rarity, cards: [{ type: 'element', element: el, slot: 0, rarity, value: ELEMENTS[el].values[rarity] }] });
      for (const art of Object.keys(ARTS[w])) add({ ...base, card: art, label: ARTS[w][art].name, artText: ARTS[w][art].text, kind: 'art', artSlot: ARTS[w][art].slot, arts: [[0, art]] });
    }
  }
  // 4b. two legendary stat cards together: does a pair that works together (crit chance + crit damage) keep up with
  //     doubling up on Attack Damage?
  if (name === 'combos') {
    const L = (stat) => ({ type: 'stat', stat, rarity: 3, value: UPGRADES[stat].values[3] });
    const COMBOS = { none: [], 'dmg': [L('baseDamage')], 'dmg+dmg': [L('baseDamage'), L('baseDamage')], 'cc+cd': [L('critChance'), L('critDamage')], 'cc+cc': [L('critChance'), L('critChance')], 'cd+cd': [L('critDamage'), L('critDamage')], 'dmg+cc': [L('baseDamage'), L('critChance')], 'cd+cc+cc': [L('critDamage'), L('critChance'), L('critChance')], 'dmg+dmg+dmg': [L('baseDamage'), L('baseDamage'), L('baseDamage')] };
    // deeper stacks (crit chance and crit damage multiply each other; Attack Damage only adds up)
    Object.assign(COMBOS, { 'dmg x4': [L('baseDamage'), L('baseDamage'), L('baseDamage'), L('baseDamage')], 'cc+cc+cd+cd': [L('critChance'), L('critChance'), L('critDamage'), L('critDamage')], 'cc+cc+cc+cd': [L('critChance'), L('critChance'), L('critChance'), L('critDamage')], 'cd x3': [L('critDamage'), L('critDamage'), L('critDamage')] });
    for (const w of WEAPON_ORDER) for (const [combo, cards] of Object.entries(COMBOS)) for (const seed of [1, 2, 3])
      add({ suite: name, weapon: w, combo, weapons: [w, filler(w)], use: 'A', specials: 'always', style: TYPICAL, target: { type: 'dummy' }, cards, seed });
    // with the Patient Executioner sacrifice (every hit crits, cooldowns x1.5): crit damage vs attack damage cards
    const EX = { 'exec': [], 'exec+cd': [L('critDamage')], 'exec+dmg': [L('baseDamage')], 'exec+cd+cd': [L('critDamage'), L('critDamage')], 'exec+dmg+dmg': [L('baseDamage'), L('baseDamage')] };
    for (const w of WEAPON_ORDER) for (const [combo, cards] of Object.entries(EX)) for (const seed of [1, 2, 3])
      add({ suite: name, weapon: w, combo, weapons: [w, filler(w)], use: 'A', specials: 'always', style: TYPICAL, target: { type: 'dummy' }, cards, alwaysCrit: true, seed });
  }
  // 5. the design vision, one targeted test per claim (see VISION in report.mjs for what each should show)
  if (name === 'vision') {
    const seeds = [1, 2];
    const dummy = (count = 1) => ({ type: 'dummy', count, layout: count > 1 ? 'cluster' : 'single' });
    const solo = (w, j) => add({ suite: name, weapon: w, weapons: [w, filler(w)], use: 'A', specials: 'always', target: dummy(), ...j });
    for (const seed of seeds) {
      // clean play (always attacking, sharp aim, still target) vs messy play (loose aim, a target circling at 2.5 tiles/s,
      // dodging 30% of the time): for the bo, missed swings reset the combo. Every weapon, for comparison.
      for (const w of WEAPON_ORDER) {
        solo(w, { test: 'flow', style: { uptime: 1, aimErr: 0 }, seed });
        solo(w, { test: 'flow-basic', style: { uptime: 1, aimErr: 0 }, specials: 'never', seed });
        solo(w, { test: 'messy', style: { uptime: 0.7, aimErr: 20, aimLag: 0.25 }, target: { ...dummy(), move: 2.5 }, seed });
      }
      // bo: pinned at no combo and at full combo (its slowest and fastest swing), attacking all the time
      for (const c of [0, 5]) solo('bo', { test: `bo-combo${c}`, style: { uptime: 1, aimErr: 0 }, specials: 'never', forceCombo: c, seed });
      // throwing knives: never dashing through vs dashing through the stacked kunai, on one target and a stacked group
      for (const count of [1, 4]) {
        solo('knives', { test: 'knives-nodash', style: { uptime: 0.7, aimErr: 8, dashThrough: false }, target: dummy(count), seed });
        solo('knives', { test: 'knives-dash', style: { uptime: 0.7, aimErr: 8, range: 2.6, dashThrough: true }, target: dummy(count), seed });
      }
      // crossbow: aim matters (sharp, sloppy, wild) at its comfortable range
      for (const aimErr of [0, 14, 25]) solo('crossbow', { test: `crossbow-aim${aimErr}`, style: { uptime: 0.7, aimErr, range: 6 }, seed });
      // arcane: a legendary Arcane imbuement on every weapon, with specials (energy spent) vs basic attacks only
      for (const w of WEAPON_ORDER) for (const specials of ['always', 'never']) for (const arc of [false, true])
        solo(w, { test: `arcane-${specials}-${arc ? 'on' : 'off'}`, style: TYPICAL, specials, target: dummy(4), ...(arc ? { cards: [{ type: 'element', element: 'arcane', slot: 0, rarity: 3, value: ELEMENTS.arcane.values[3] }] } : {}), seed });
      // katanas: hitting with the blade tip vs crowding in too close
      solo('katanas', { test: 'katanas-tip', style: { uptime: 0.7, aimErr: 8, range: 1.6 }, specials: 'never', secondaries: 'never', seed });
      solo('katanas', { test: 'katanas-close', style: { uptime: 0.7, aimErr: 8, range: 0.8 }, specials: 'never', secondaries: 'never', seed });
      solo('katanas', { test: 'katanas-tip-cb', style: { uptime: 0.7, aimErr: 8, range: 1.6 }, specials: 'never', secondaries: 'never', arts: [[0, 'crossedBlades']], seed });
      // shishi shield: under pressure (three enemies landing a 12 hit every 1.6 s) with and without the Bulwark
      for (const specials of ['always', 'never'])
        add({ suite: name, weapon: 'shield', test: `shield-pressure-${specials}`, weapons: ['shield', 'katanas'], use: 'A', specials, style: { ...TYPICAL, range: 1.4 }, target: dummy(3), incoming: { dmg: 12, every: 1.6 }, seed });
      // restless spirit orb (one weapon per run): every weapon against area-2 groups of only regular enemies vs groups
      // that include heavies (the spirits of what falls fight on, taking constant chip damage, see harness), so the
      // orb should climb the ranking when strong enemies fall
      for (const w of WEAPON_ORDER) for (const heavy of [false, true]) {
        const types = BIOME_POOLS[1].filter((t) => heavy || !ENEMIES[t].heavy);
        add({ suite: name, test: heavy ? 'orb-heavy' : 'orb-light', weapon: w, weapons: [w, filler(w)], use: 'A', specials: 'always', style: TYPICAL, target: { types, level: 15, count: 3, layout: 'spread' }, dur: 60, seed });
      }
    }
  }
  return jobs;
}
