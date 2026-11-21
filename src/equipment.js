// Equipment sets: chosen before a run, after the weapon. Each set has its own look (the same ninja: hood,
// scarf and sash, in its own colours plus a few pieces of gear drawn by rig.js, o.gear) and its own bonus.
//   default    +1 life (solo)
//   assassin   +10% crit chance, +20% crit damage
//   tactician  +2 reroll tokens
//   martial    Weapon Artist: choose 1 of 2 techniques when the run begins (Game.offerMartial)
//   feather    +1 dash, +10% movement speed
//   monk       imbuement cards are never common (cards.js withRarity)
//   satanist   the first sacrifice of the run has no downside (sacrifice.js sacFree)
import { REROLLS, SOLO_LIVES } from './config.js';

export const EQUIP_ORDER = ['default', 'assassin', 'tactician', 'martial', 'feather', 'monk', 'satanist'];

// pal: colours over the player's own palette. Player 2 keeps a blue scarf (scarf2) so co-op stays readable.
export const EQUIPMENT = {
  default: {
    name: 'Shinobi Garb', jp: '忍装束', title: 'Default', bonus: '+1 life (solo)', lines: ['+1 life (solo)'],
    pal: null,
  },
  assassin: {
    name: "Assassin's Set", jp: '暗殺', title: 'Assassin', bonus: '+10% crit chance, +20% crit damage', lines: ['+10% crit chance', '+20% crit damage'],
    pal: { cloth: '#26232a', cloth2: '#17151b', hood: '#1c1a20', sash: '#8e1c22', scarf: '#b3222b', accent: '#b3222b' }, scarf2: '#2f6fb0',
    gear: 'assassin',
  },
  tactician: {
    name: "Tactician's Set", jp: '軍師', title: 'Tactician', bonus: `+2 rerolls (${REROLLS + 2} in all)`, lines: ['+2 reroll tokens'],
    pal: { cloth: '#2a3352', cloth2: '#1a2038', hood: '#202842', sash: '#c99a32', scarf: '#5a2a6a', accent: '#d8ac40', trim: '#d8ac40' }, scarf2: '#2a7ac0',
    gear: 'tactician',
  },
  martial: {
    name: "Weapon Artist's Set", jp: '武芸', title: 'Weapon Artist', bonus: 'Choose 1 of 2 techniques before your run', lines: ['Choose 1 of 2 techniques', 'before your run'],
    pal: { cloth: '#e4dccb', cloth2: '#2b2f3a', hood: '#2b2f3a', sash: '#1b1b20', scarf: '#c8302a', accent: '#c8302a', wrap: '#f2ecdf' }, scarf2: '#2a7ac0',
    gear: 'martial',
  },
  feather: {
    name: 'Feather Set', jp: '羽衣', title: 'Feather', bonus: '+1 dash, +10% movement speed', lines: ['+1 dash', '+10% movement speed'],
    pal: { cloth: '#4f6470', cloth2: '#34444e', hood: '#3c4e58', sash: '#d8e4e6', scarf: '#eef4f2', accent: '#9fd0d8', feather: '#f1f4ef', feather2: '#9fb8bf' }, scarf2: '#8fc4ee',
    gear: 'feather',
  },
  monk: {
    name: "Monk's Set", jp: '僧衣', title: 'Monk', bonus: 'Imbuements are never common', lines: ['Imbuements are', 'never common'],
    pal: { cloth: '#5a3f2a', cloth2: '#3c2a1c', hood: '#4a3424', sash: '#d0882a', scarf: '#e09a30', accent: '#e09a30', kesa: '#d0882a', beads: '#6a2a1a' }, scarf2: '#3a9ae0',
    gear: 'monk',
  },
  satanist: {
    name: "Satanist's Set", jp: '魔契', title: 'Satanist', bonus: 'Your first sacrifice has no downside', lines: ['Your first sacrifice', 'has no downside'],
    pal: { cloth: '#1e1416', cloth2: '#120b0d', hood: '#170e11', sash: '#7a0f16', scarf: '#9a1420', accent: '#d8262e', horn: '#e8dcc8', oni: '#b3202a' }, scarf2: '#2f6fb0',
    gear: 'satanist',
  },
};

// the palette for player `index` wearing set `key` (base = that player's normal palette)
export function equipPal(base, key, index) {
  const E = EQUIPMENT[key];
  if (!E || !E.pal) return base;
  const pal = { ...base, ...E.pal };
  if (index === 1 && E.scarf2) pal.scarf = E.scarf2;
  return pal;
}

// a new run: the set's look and bonuses for player p
export function applyEquipment(p, key) {
  const E = EQUIPMENT[key] ? key : 'default';
  p.equip = E;
  p.pal = equipPal(p.pal, E, p.index);
  p.rerolls = REROLLS + (E === 'tactician' ? 2 : 0);
  p.lives = p.g && p.g.players.length === 1 ? SOLO_LIVES + (E === 'default' ? 1 : 0) : 0; // (co-op: partners revive each other instead)
  if (E === 'assassin') { p.stats.critChance += 0.10; p.stats.critDamage += 0.20; }
  if (E === 'feather') { p.stats.extraDash = (p.stats.extraDash || 0) + 1; p.stats.moveSpeed += 0.10; p.dashCharges = undefined; }
}
