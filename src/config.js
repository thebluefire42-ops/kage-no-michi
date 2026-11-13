// All tunable game numbers live here.

export const PLAYER_BASE = {
  maxHp: 70,
  maxEnergy: 100,
  speed: 5.4,          // world units / s
  radius: 0.32,
  stats: {
    critChance: 0.05,  // 5%
    critDamage: 0.5,   // +50%
    cooldownMul: 1,    // x1: multiplies every attack cooldown (set by sacrifices; Wind works per weapon)
    baseDamage: 1,     // x1
    energyRegen: 3,    // per second
    healthRegen: 0.4,  // per second (2 per 5s)
    dashCooldown: 5,   // seconds, reduced by dash upgrades
    moveSpeed: 1,      // x1
  },
  dash: { cost: 0, minCooldown: 1.0, distance: 3.0, duration: 0.18, jumpDuration: 0.24 },
  hitIframes: 0.55,
  clearHeal: 0,        // no free healing between levels (use regen, syphon or the staff)
  coopReviveHp: 35,    // a fallen co-op partner comes back with this much HP (see coopReturnAfter)
  coopReturnAfter: 3,  // co-op: a fallen player returns this many levels after the one they fell in
  downTime: 15,        // co-op: seconds a downed player can still be revived
  reviveTime: 1.8,     // seconds the partner must stand next to them
  reviveRange: 1.4,
  reviveHp: 30,
};

// Bumper = basic attack (no energy). Trigger = special (costs energy).
// `lock` = how long the attack occupies the ninja before ANY other attack can start
// (one attack at a time). The cooldown (`interval` / `cd`) decides how often an attack can be used;
// both are multiplied by the weapon's cooldown multiplier (Wind imbuement, sacrifices).
// rating.speed (1-5) is the weapon's speed: it reflects its cooldowns and sets its move speed (weaponMove).
export const WEAPONS = {
  katanas: {
    name: 'Dual Katanas', jp: '双刀', desc: 'Fast slashes, low damage',
    rating: { speed: 5, damage: 1, range: 1 },
    basic: { name: 'Twin Slash', interval: 0.27, lock: 0.24, dmg: 6, range: 1.75, arc: 115 },
    special: { name: 'Whirlwind', cost: 35, cd: 0.9, lock: 0.5, dmg: 5, ticks: 5, dur: 0.5, radius: 2.2 },
  },
  crossbow: {
    name: 'Crossbow', jp: '弩', desc: 'Ranged, slow shots, medium damage', move: 0.9,
    rating: { speed: 2, damage: 3, range: 5 },
    basic: { name: 'Bolt', interval: 0.9, lock: 0.32, dmg: 17, speed: 21, pierce: 0, minRange: 1.5, maxRange: 12, chargeTime: 1.5 },
    special: { name: 'Piercing Volley', cost: 30, cd: 1.1, lock: 0.4, dmg: 19, count: 3, spread: 12, pierce: 3, speed: 23 },
  },
  heavy: {
    name: 'Heavy Sword', jp: '大太刀', desc: 'Slow swings, high damage',
    rating: { speed: 1, damage: 5, range: 2 },
    basic: { name: 'Cleave', interval: 1.1, lock: 0.5, dmg: 30, range: 2.3, arc: 165, knock: 7 },
    special: { name: 'Ground Slam', cost: 35, cd: 1.3, lock: 0.5, dmg: 48, radius: 2.8, knock: 9, leap: 1.8 },
  },
  knives: {
    name: 'Throwing Knives', jp: '苦無', desc: 'Ranged, fast throws, low damage',
    rating: { speed: 4, damage: 1, range: 4 },
    basic: { name: 'Kunai', interval: 0.33, lock: 0.24, dmg: 4, speed: 17, pierce: 0 },
    special: { name: 'Kunai Fan', cost: 20, cd: 0.7, lock: 0.3, dmg: 3, count: 7, spread: 70, pierce: 1, speed: 16 },
  },
  staff: {
    name: 'Monk Staff', jp: '錫杖', desc: 'Long-range spirit bursts, heals', move: 0.9,
    rating: { speed: 2, damage: 1, range: 5 },
    // basic: a spirit bolt that bursts into a small area at the first enemy or at max range
    basic: { name: 'Spirit Burst', interval: 0.6, lock: 0.3, dmg: 5, speed: 14, range: 9, radius: 1.15 },
    // special: heals you and every ally within `radius`
    // heal is multiplied by your base damage (attack damage), so it grows with damage upgrades
    special: { name: 'Healing Circle', cost: 55, cd: 8, lock: 0.5, heal: 12, radius: 3 },
  },
  bo: {
    name: 'Bo Staff', jp: '棒', desc: 'Fast strikes, medium reach, low damage',
    rating: { speed: 5, damage: 1, range: 3 },
    // basic: quick sweeping strike in front of you
    basic: { name: 'Sweep', interval: 0.3, lock: 0.26, dmg: 5, range: 2.4, arc: 80, knock: 2 },
    // special: time slows for enemies while you rain rapid strikes in front of you
    special: { name: 'Thousand Strikes', cost: 40, cd: 4, lock: 1.1, dmg: 4, strikes: 12, dur: 1.0, range: 2.6, arc: 100, timeScale: 0.25 },
  },
};
export const WEAPON_ORDER = ['katanas', 'crossbow', 'heavy', 'knives', 'staff', 'bo'];
// movement speed while carrying a weapon: heavy (speed 1) 95% ... fast (speed 5) 107%; with two weapons the average counts
// (def.move overrides it: the crossbow and the monk staff are cumbersome to run with)
export const weaponMove = (def) => def.move ?? 0.92 + 0.03 * def.rating.speed;
// what the weapon select shows when hovering a weapon: a short description and the reach (tiles) of each attack
export const WEAPON_INFO = {
  katanas: { basic: { desc: 'Two quick slashes in front', reach: 1.75 }, special: { desc: 'Spin, cutting everything around you', reach: 2.2, hits: 5 } },
  crossbow: { basic: { desc: 'Hold to aim, release a heavy bolt', reach: 12 }, special: { desc: 'Three piercing bolts in a fan', reach: 20, hits: 3 } },
  heavy: { basic: { desc: 'Wide, slow cleave that knocks back', reach: 2.3 }, special: { desc: 'Leap and slam the ground', reach: 2.8 } },
  knives: { basic: { desc: 'Throw a fast kunai', reach: 15 }, special: { desc: 'A fan of seven kunai', reach: 13, hits: 7 } },
  staff: { basic: { desc: 'Spirit bolt that bursts in an area', reach: 9 }, special: { desc: 'Heal yourself and allies nearby', reach: 3, heal: true } },
  bo: { basic: { desc: 'Fast sweeping strike', reach: 2.4 }, special: { desc: 'Slow time, rain twelve strikes', reach: 2.6, hits: 12 } },
};

// Enemies. Every biome has its own roster; `behavior` is the shared AI archetype,
// `heavy` marks the big, slow, hard-hitting ability enemies. hp/dmg get scaled by level.
// onHit: extra effect on the player when this enemy's attack lands (chill = slow).
const B = (o) => ({ recover: 0.5, cooldown: 1, ...o });
export const ENEMIES = {
  // ---- Area 1: spring village (bandits and soldiers)
  bandit:      B({ name: 'Ronin Bandit',      behavior: 'melee',   hp: 30,  dmg: 12, speed: 2.7, r: 0.33, cost: 1, range: 1.3,  windup: 0.4,  recover: 0.45, cooldown: 0.7,  minLevel: 1 }),
  spear:       B({ name: 'Ashigaru Spearman', behavior: 'lunge',   hp: 46,  dmg: 20, speed: 1.8, r: 0.34, cost: 2, range: 2.6,  windup: 0.65, recover: 0.6,  cooldown: 1.1,  minLevel: 2 }),
  archer:      B({ name: 'Yumi Archer',       behavior: 'ranged',  hp: 22,  dmg: 10, speed: 2.5, r: 0.32, cost: 2, range: 8,    windup: 0.7,  recover: 0.4,  cooldown: 1.4,  minLevel: 3, proj: 'arrow' }),
  assassin:    B({ name: 'Shinobi Assassin',  behavior: 'blink',   hp: 20,  dmg: 8,  speed: 4.8, r: 0.3,  cost: 2, range: 1.15, windup: 0.24, recover: 0.3,  cooldown: 0.55, minLevel: 4 }),
  bomber:      B({ name: 'Bomb Thrower',      behavior: 'lob',     hp: 32,  dmg: 22, speed: 1.6, r: 0.38, cost: 3, range: 8.5,  windup: 0.6,  recover: 0.6,  cooldown: 2.6,  minLevel: 6, proj: 'bomb' }),
  sumo:        B({ name: 'Sumo Brute',        behavior: 'sumo',    hp: 128, dmg: 26, speed: 1.6, r: 0.62, cost: 5, range: 2.4,  windup: 0.8,  recover: 0.9,  cooldown: 2.2,  minLevel: 3, heavy: true }),
  samurai:     B({ name: 'Armored Samurai',   behavior: 'samurai', hp: 145, dmg: 28, speed: 1.5, r: 0.5,  cost: 6, range: 2.9,  windup: 0.75, recover: 1.0,  cooldown: 2.0,  minLevel: 4, heavy: true }),
  tate:        B({ name: 'Tate Ashigaru',     behavior: 'shieldCharger', shield: 'pavise', hp: 45,  dmg: 14, speed: 3.4, r: 0.36, cost: 3, range: 1.3, windup: 0.6,  recover: 0.6, cooldown: 1.4, minLevel: 3 }),
  ironguard:   B({ name: 'Iron Gate Samurai', behavior: 'shieldTank',    shield: 'iron',   hp: 110, dmg: 18, speed: 1.6, r: 0.46, cost: 4, range: 1.8, windup: 0.55, recover: 0.7, cooldown: 1.6, minLevel: 5 }),
  // ---- Area 2: autumn mountain pass (yokai)
  shellguard:  B({ name: 'Kappa Shellguard',  behavior: 'shieldCharger', shield: 'shell',  hp: 50,  dmg: 15, speed: 3.5, r: 0.36, cost: 3, range: 1.3, windup: 0.55, recover: 0.6, cooldown: 1.4, minLevel: 12 }),
  barkwarden:  B({ name: 'Kodama Barkwarden', behavior: 'shieldTank',    shield: 'bark',   hp: 120, dmg: 19, speed: 1.5, r: 0.48, cost: 4, range: 1.9, windup: 0.55, recover: 0.7, cooldown: 1.6, minLevel: 14 }),
  kappa:       B({ name: 'Kappa',             behavior: 'hopper',  hp: 28,  dmg: 11, speed: 4.0, r: 0.33, cost: 1, range: 1.1,  windup: 0.26, recover: 0.35, cooldown: 0.6,  minLevel: 11 }),
  kamaitachi:  B({ name: 'Kamaitachi',        behavior: 'lunge',   hp: 40,  dmg: 18, speed: 2.4, r: 0.32, cost: 2, range: 3.0,  windup: 0.55, recover: 0.5,  cooldown: 1.0,  minLevel: 11, lungeSpeed: 17 }),
  karasu:      B({ name: 'Karasu Crow',       behavior: 'ranged',  hp: 24,  dmg: 10, speed: 2.8, r: 0.32, cost: 2, range: 8,    windup: 0.65, recover: 0.4,  cooldown: 1.3,  minLevel: 11, proj: 'dart' }),
  kitsune:     B({ name: 'Kitsune',           behavior: 'blink',   hp: 24,  dmg: 9,  speed: 4.6, r: 0.3,  cost: 2, range: 1.15, windup: 0.24, recover: 0.3,  cooldown: 0.55, minLevel: 12 }),
  tanuki:      B({ name: 'Tanuki',            behavior: 'lob',     hp: 36,  dmg: 22, speed: 1.7, r: 0.4,  cost: 3, range: 8.5,  windup: 0.6,  recover: 0.6,  cooldown: 2.5,  minLevel: 13, proj: 'jug' }),
  yamabushi:   B({ name: 'Yamabushi Monk',    behavior: 'caster',  hp: 36,  dmg: 12, speed: 1.5, r: 0.33, cost: 3, range: 10,   windup: 0.8,  recover: 0.6,  cooldown: 3.2,  minLevel: 12, proj: 'orb' }),
  boar:        B({ name: 'Boar Spirit',       behavior: 'boar',    hp: 136, dmg: 30, speed: 1.8, r: 0.62, cost: 5, range: 9,    windup: 1.0,  recover: 0.8,  cooldown: 2.2,  minLevel: 13, heavy: true }),
  komainu:     B({ name: 'Komainu Guardian',  behavior: 'komainu', hp: 179, dmg: 30, speed: 1.2, r: 0.6,  cost: 6, range: 8,    windup: 0.55, recover: 1.2,  cooldown: 2.6,  minLevel: 14, heavy: true }),
  // ---- Area 3: snowy castle town at night (undead and oni)
  boneshield:  B({ name: 'Bone Shieldbearer', behavior: 'shieldCharger', shield: 'bone',   hp: 52,  dmg: 15, speed: 3.4, r: 0.36, cost: 3, range: 1.3, windup: 0.55, recover: 0.6, cooldown: 1.4, minLevel: 22 }),
  glacier:     B({ name: 'Glacier Warden',    behavior: 'shieldTank',    shield: 'ice',    hp: 130, dmg: 20, speed: 1.5, r: 0.5,  cost: 4, range: 1.9, windup: 0.55, recover: 0.7, cooldown: 1.6, minLevel: 24, onHit: { chill: 0.35, dur: 1.5 } }),
  skeleton:    B({ name: 'Skeleton Soldier',  behavior: 'melee',   hp: 34,  dmg: 13, speed: 2.6, r: 0.33, cost: 1, range: 1.3,  windup: 0.4,  recover: 0.45, cooldown: 0.7,  minLevel: 21 }),
  ghostspear:  B({ name: 'Ghost Spearman',    behavior: 'lunge',   hp: 46,  dmg: 20, speed: 2.0, r: 0.34, cost: 2, range: 2.8,  windup: 0.6,  recover: 0.6,  cooldown: 1.1,  minLevel: 21 }),
  frostarcher: B({ name: 'Frost Archer',      behavior: 'ranged',  hp: 26,  dmg: 10, speed: 2.4, r: 0.32, cost: 2, range: 8,    windup: 0.7,  recover: 0.4,  cooldown: 1.4,  minLevel: 21, proj: 'icearrow', onHit: { chill: 0.35, dur: 1.5 } }),
  yukionna:    B({ name: 'Yuki-onna',         behavior: 'blink',   hp: 26,  dmg: 9,  speed: 4.4, r: 0.3,  cost: 2, range: 1.2,  windup: 0.26, recover: 0.3,  cooldown: 0.6,  minLevel: 22, onHit: { chill: 0.45, dur: 1.8 } }),
  imp:         B({ name: 'Fire Imp',          behavior: 'lob',     hp: 30,  dmg: 20, speed: 2.0, r: 0.34, cost: 3, range: 8.5,  windup: 0.55, recover: 0.6,  cooldown: 2.4,  minLevel: 22, proj: 'firejar' }),
  wisp:        B({ name: 'Wisp Priest',       behavior: 'caster',  hp: 34,  dmg: 12, speed: 1.6, r: 0.33, cost: 3, range: 10,   windup: 0.8,  recover: 0.6,  cooldown: 3.0,  minLevel: 23, proj: 'soul' }),
  oni:         B({ name: 'Oni Brute',         behavior: 'charger', hp: 128, dmg: 23, speed: 1.3, r: 0.55, cost: 5, range: 2.0,  windup: 0.5,  recover: 0.9,  cooldown: 1.6,  minLevel: 22, heavy: true }),
  gashadokuro: B({ name: 'Gashadokuro',       behavior: 'gasha',   hp: 221, dmg: 24, speed: 1.1, r: 0.85, cost: 7, range: 5.5,  windup: 0.8,  recover: 1.2,  cooldown: 2.4,  minLevel: 23, heavy: true }),
  // ---- Area 4: the Kagerō fortress (Gensai's elite soldiers)
  kgsoldier:   B({ name: 'Kagerō Soldier',     behavior: 'melee',   hp: 50,  dmg: 15, speed: 3.0, r: 0.34, cost: 2, range: 1.35, windup: 0.36, recover: 0.4,  cooldown: 0.6,  minLevel: 31 }),
  kgspear:     B({ name: 'Fortress Spearman',  behavior: 'lunge',   hp: 62,  dmg: 21, speed: 2.3, r: 0.34, cost: 2, range: 2.9,  windup: 0.5,  recover: 0.5,  cooldown: 0.95, minLevel: 31, lungeSpeed: 18 }),
  kgsentry:    B({ name: 'Crossbow Sentry',    behavior: 'ranged',  hp: 40,  dmg: 14, speed: 2.4, r: 0.32, cost: 2, range: 9,    windup: 0.75, recover: 0.4,  cooldown: 1.25, minLevel: 31, proj: 'arrow' }),
  kgshinobi:   B({ name: 'Elite Shinobi',      behavior: 'blink',   hp: 38,  dmg: 12, speed: 5.0, r: 0.3,  cost: 2, range: 1.2,  windup: 0.24, recover: 0.28, cooldown: 0.5,  minLevel: 31 }),
  kgshield:    B({ name: 'Gate Shieldbearer',  behavior: 'shieldCharger', shield: 'iron', hp: 68, dmg: 17, speed: 3.6, r: 0.36, cost: 3, range: 1.3, windup: 0.5, recover: 0.6, cooldown: 1.3, minLevel: 31 }),
  kgwall:      B({ name: 'Iron Wall Guard',    behavior: 'shieldTank',    shield: 'iron', hp: 160, dmg: 22, speed: 1.7, r: 0.48, cost: 4, range: 1.9, windup: 0.5, recover: 0.7, cooldown: 1.5, minLevel: 31 }),
  kgmonk:      B({ name: 'War Priest',         behavior: 'caster',  hp: 48,  dmg: 14, speed: 1.6, r: 0.33, cost: 3, range: 10,   windup: 0.75, recover: 0.6,  cooldown: 2.8,  minLevel: 32, proj: 'orb' }),
  kgchampion:  B({ name: 'Honor Guard Champion', behavior: 'samurai', hp: 230, dmg: 32, speed: 1.6, r: 0.5, cost: 6, range: 3.0,  windup: 0.7,  recover: 0.9,  cooldown: 1.8,  minLevel: 31, heavy: true }),
  frostoni:    B({ name: 'Frost Oni',         behavior: 'frostoni', hp: 187, dmg: 20, speed: 1.3, r: 0.62, cost: 6, range: 5,    windup: 0.9,  recover: 1.0,  cooldown: 2.4,  minLevel: 24, heavy: true, onHit: { chill: 0.5, dur: 2.2 } }),
};

export const BOSSES = {
  10: { type: 'ronin_boss', name: 'Ronin Warlord Kurogane', jp: '黒鉄', title: 'The Iron Ronin', hp: 1620, r: 0.55 },
  20: { type: 'tengu',      name: 'Tengu of the Red Peak',  jp: '天狗', title: 'Lord of the Mountain Winds', hp: 3300, r: 0.6 },
  30: { type: 'oni_lord',   name: 'Oni Lord Shuten',        jp: '酒呑', title: 'Gate Guardian of the Kagerō', hp: 8400, r: 1.0 },
  33: { type: 'gensai',     name: 'Regent Gensai',          jp: '玄斎', title: 'Usurper of the Kagerō', hp: 10500, r: 0.5, hall: true },
};
// Boss hit damage (already +20% over the original tuning; the Tengu hits ~75% harder than before).
export const BOSS_DMG = {
  ronin_boss: { sweep: 22, dash: 17 },
  tengu: { feather: 14, gust: 18, dive: 42 },
  oni_lord: { slam: 36, stomp: 24, wave: 22, charge: 31, fire: 7 },
  gensai: { iai: 38, crescent: 20, seal: 26, mirage: 24, slash: 22 },
};
// Co-op scaling (2 players)
export const COOP_BOSS_HP = 1.6;
export const COOP_ENEMY_COUNT = 1.35;
export const COOP_ENEMY_HP = 1.35;
export const COOP_ENEMY_DMG = 1.15;

// Each biome uses only its own enemies.
export const BIOME_POOLS = [
  ['bandit', 'spear', 'archer', 'assassin', 'bomber', 'sumo', 'samurai', 'tate', 'ironguard'],
  ['kappa', 'kamaitachi', 'karasu', 'kitsune', 'tanuki', 'yamabushi', 'boar', 'komainu', 'shellguard', 'barkwarden'],
  ['skeleton', 'ghostspear', 'frostarcher', 'yukionna', 'imp', 'wisp', 'oni', 'gashadokuro', 'frostoni', 'boneshield', 'glacier'],
  ['kgsoldier', 'kgspear', 'kgsentry', 'kgshinobi', 'kgshield', 'kgwall', 'kgmonk', 'kgchampion'],
];
// the regent's guard: what Gensai summons in his hall
export const GENSAI_GUARD = ['kgsoldier', 'kgsoldier', 'kgspear', 'kgsentry', 'kgshinobi', 'kgshield', 'kgwall'];
// Heavy (big tanky) enemies are rarer: lower pick weight and a per-level cap.
export const HEAVY_WEIGHT = 0.55;
export const heavyCap = (level, coop) => 1 + Math.floor((((level - 1) % 10) + 1) / 4) + (coop ? 1 : 0);
// Shields block 80% of frontal hits until broken by 3 blocked melee hits or a burst of damage.
export const SHIELD = { block: 0.8, arc: Math.PI * 2 / 3, meleeHits: 3, burstFrac: 0.35, burstWindow: 1.5, breakStun: 0.8 };
export const PLAYER_STUN = 0.45;

export const levelScale = (level) => 1 + 0.07 * (level - 1);        // enemy HP
// Enemy damage grows much slower than HP: player max HP is 70 (only sacrifices change it).
export const levelDamageScale = (level) => 1 + 0.03 * (level - 1);
// Enemy count multiplier: area 1 ramps from 1x (level 1) to 2x (level 9);
// later areas stay at 1.5x so there's no sudden drop when the area changes.
export const enemyCountMul = (level) => (level <= 10 ? 1 + (Math.min(level, 9) - 1) / 8 : level > 30 ? 1.65 : 1.5);
export const levelBudget = (level) => (5 + 1.95 * level) * enemyCountMul(level);

// ---- Upgrades ----
export const RARITIES = [
  { key: 'common',    name: 'Common',    jp: '並', weight: 50, color: '#cfc6b2', glow: '#a8a090' },
  { key: 'rare',      name: 'Rare',      jp: '稀', weight: 30, color: '#5fb2ff', glow: '#3a8cff' },
  { key: 'epic',      name: 'Epic',      jp: '極', weight: 15, color: '#c77dff', glow: '#9b4dff' },
  { key: 'legendary', name: 'Legendary', jp: '伝説', weight: 5, color: '#ffd45e', glow: '#ffb020' },
];

// Stat upgrades. values per rarity [common, rare, epic, legendary]
export const UPGRADES = {
  critChance:   { name: 'Crit Chance',   jp: '会心', values: [0.05, 0.10, 0.15, 0.30], fmt: 'pct',  cap: 1 },
  critDamage:   { name: 'Crit Damage',   jp: '痛撃', values: [0.10, 0.20, 0.35, 0.50], fmt: 'pctPlus' },
  baseDamage:   { name: 'Base Damage',   jp: '剛力', values: [0.05, 0.10, 0.15, 0.25], fmt: 'pct' },
  energyRegen:  { name: 'Energy Regen',  jp: '気',   values: [0.5, 1.0, 1.5, 3.0],    fmt: 'perSec1' },
  healthRegen:  { name: 'Health Regen',  jp: '癒',   values: [0.1, 0.2, 0.35, 0.6],   fmt: 'perSec2' },
  moveSpeed:    { name: 'Move Speed',    jp: '軽身', values: [0.04, 0.08, 0.12, 0.20], fmt: 'pct', cap: 1.7 },
  // multiplicative: new cooldown = cooldown x (1 - value)
  dashCooldown: { name: 'Dash Cooldown', jp: '疾風', values: [0.06, 0.10, 0.15, 0.25], fmt: 'secs', mult: true, min: PLAYER_BASE.dash.minCooldown },
};

// Consumable item cards (amount by rarity):
//  heal: restores health right away (only offered when hurt)
//  energy: restores ki right away (only offered when not full)
//  rush: +x% damage for the first 30 seconds of the next level
export const HEAL_CARD = { name: 'Heal', jp: '治癒', values: [10, 15, 25, 50], color: '#ff7a8a' };
export const ITEM_CARDS = {
  heal: HEAL_CARD,
  energy: { name: 'Ki Tonic', jp: '気薬', values: [25, 40, 60, 100], color: '#4fc8dc' },
  rush: { name: 'Battle Rush', jp: '戦勢', values: [0.1, 0.15, 0.25, 0.4], color: '#ff8a3c', dur: 30 },
};
// Pickups dropped by enemies: normal / heavy ("super") / boss drop chances
export const DROPS = {
  heal: 10, energy: 25,
  normal: { heal: 0.03, energy: 0.08 },
  heavy: { either: true }, // always drops one: heal or ki, 50/50
  boss: { heal: 1, energy: 0 },
};

// Element upgrades: applied to ONE of your two weapons; repeated picks stack.
export const ELEMENTS = {
  lightning: { name: 'Lightning', jp: '雷', values: [1, 2, 3, 6],        fmt: 'chains', color: '#ffe46a', desc: 'Hits chain to nearby enemies for 50% damage' },
  poison:    { name: 'Poison',    jp: '毒', values: [2, 4, 6, 12],       fmt: 'dps',    color: '#8fe05a', desc: 'Hits poison for 3s (damage per second)' },
  // syphon has diminishing returns: each card adds value x (1 - current / cap), so the 25% cap is only approached
  syphon:    { name: 'Syphon',    jp: '吸', values: [0.015, 0.03, 0.045, 0.08], fmt: 'slow', color: '#ff6b8a', desc: 'Heals you for a share of the damage this weapon deals', cap: 0.25, diminish: true },
  ice:       { name: 'Ice',       jp: '氷', values: [0.1, 0.2, 0.3, 0.5], fmt: 'slow',  color: '#9ee4ff', desc: 'Hits slow enemy movement and attacks for 2s', cap: 0.7 },
  // wind: this weapon's attacks come back faster (cooldown reduction)
  wind:      { name: 'Wind',      jp: '風', values: [0.05, 0.08, 0.12, 0.2], fmt: 'slow', color: '#aef0c8', desc: 'This weapon\'s attacks recover faster', cap: 0.5 },
};
export const ELEMENT_RULES = { chainRange: 3.5, chainDamage: 0.5, poisonDur: 3, poisonTick: 0.5, slowDur: 2 };

export const PLAYER_COLORS = ['#e05252', '#52a8e0'];

// ---- Talents: rare, powerful active abilities on X / Y / B (keys 1 / 2 / 3).
// A talent card appears with TALENT_CHANCE per card slot. The first card grants the talent with a
// power bonus by rarity; later cards for it either raise power or cut the cooldown (also by rarity).
export const TALENT_CHANCE = 0.12;
export const MAX_TALENTS = 3;
export const TALENT_POWER = [0, 0.15, 0.3, 0.6];        // power bonus per rarity
export const TALENT_UPGRADE_POWER = [0.1, 0.2, 0.3, 0.5];
export const TALENT_UPGRADE_CD = [0.06, 0.12, 0.18, 0.3]; // cooldown reduction per rarity
export const TALENT_MIN_CD = 6;
export const TALENTS = {
  arrowRain: { name: 'Arrow Rain',        jp: '矢雨', cd: 20, desc: 'Arrow storm · scales with damage', radius: 2.6, dur: 2.2, tick: 0.2, dmg: 9, targeted: true },
  meteor:    { name: 'Meteorite',         jp: '隕石', cd: 24, desc: 'Meteor strike · scales with damage', radius: 2.1, delay: 0.85, dmg: 95, targeted: true },
  meditate:  { name: 'Meditate',          jp: '瞑想', cd: 30, desc: 'Refill your energy (partner gets some)', partner: 35 },
  vitalize:  { name: 'Vitalize',          jp: '活力', cd: 35, desc: 'Restore health (partner gets some)', heal: 25, partner: 12 },
  shadows:   { name: 'Master of Shadows', jp: '影分身', cd: 40, desc: 'Four shadow clones fight beside you', count: 4, dur: 8, dmg: 6, interval: 0.55 },
  rage:      { name: 'Rage',              jp: '激怒', cd: 35, desc: 'Deal double damage for a while', dur: 6, mult: 2 },
};
