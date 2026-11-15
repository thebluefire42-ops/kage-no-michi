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
    energyRegen: 1.5,  // per second
    healthRegen: 0.4,  // per second (2 per 5s)
    cooldown: 1,       // x1: multiplies every attack, talent and dash cooldown (Cooldown cards)
    moveSpeed: 1,      // x1
    kiCost: 1,         // x1: multiplies the ki cost of every attack that costs ki (reduced by Ki Focus cards)
  },
  dash: { cost: 0, cooldown: 5, minCooldown: 1.0, distance: 3.0, duration: 0.18, jumpDuration: 0.24 },
  hitIframes: 0.55,
  clearHeal: 0,        // no free healing between levels (use regen, syphon or the staff)
  coopReviveHp: 35,    // a fallen co-op partner comes back with this much HP (see coopReturnAfter)
  coopReturnAfter: 1,  // co-op: a fallen player returns this many levels after the one they fell in (the next one)
  downTime: 37.5,      // co-op: seconds a downed player can still be revived
  reviveTime: 1.8,     // seconds the partner must stand next to them
  reviveRange: 1.4,
  reviveHp: 30,
};

// Bumper = basic attack (free, except the `cost` of knives / crossbow / heavy sword). Trigger = special (costs energy).
// `lock` = how long the attack occupies the ninja before ANY other attack can start
// (one attack at a time). The cooldown (`interval` / `cd`) decides how often an attack can be used;
// both are multiplied by the weapon's cooldown multiplier (Wind imbuement, sacrifices).
// rating.speed (1-5) is the weapon's speed: it reflects its cooldowns and sets its move speed (weaponMove).
// rating (1-5, shown on the weapon cards), from the current numbers:
//  speed = attack tempo; damage = sustained + burst damage (bo at full combo, heavy charged, shield incl. the Bulwark release);
//  range = reach of the basic attack (crossbow 10.5, knives ~15, staff 9 + burst, bo 2.4, heavy 2.3-2.9, shield bash 2.8 + 1.3, katanas 1.75)
export const WEAPONS = {
  katanas: {
    name: 'Dual Katanas', jp: '双刀', desc: 'Fast, and versatile in close quarters.',
    rating: { speed: 5, damage: 3, range: 1 },
    basic: { name: 'Twin Slash', interval: 0.34, lock: 0.24, dmg: 5, range: 1.75, arc: 115 },
    special: { name: 'Whirlwind', cost: 35, cd: 0.9, lock: 0.5, dmg: 7, ticks: 5, dur: 0.5, radius: 2.2 },
  },
  crossbow: {
    name: 'Crossbow', jp: '弩', desc: 'High-precision with a slow reload.', move: 0.9,
    rating: { speed: 2, damage: 3, range: 5 },
    basic: { name: 'Bolt', cost: 4, interval: 0.9, lock: 0.32, dmg: 15, speed: 31, pierce: 0, minRange: 1.5, maxRange: 10.5, chargeTime: 1.1 },
    // special: one heavy bolt that flies a long straight line and pierces every enemy in it
    special: { name: 'Piercing Shot', cost: 35, cd: 3.2, lock: 0.45, dmg: 55, pierce: 99, speed: 38, range: 18, knock: 4 },
  },
  heavy: {
    name: 'Heavy Sword', jp: '大太刀', desc: 'Crushing power but very slow.',
    rating: { speed: 1, damage: 5, range: 2 },
    // hold to charge (chargeTime): up to +chargeDmg damage, +chargeKnock knockback and +chargeRange reach
    basic: { name: 'Cleave', cost: 4, interval: 1.6, lock: 0.5, dmg: 14, range: 2.3, arc: 165, knock: 11, chargeTime: 0.9, chargeDmg: 1.0, chargeKnock: 9, chargeRange: 0.6 },
    special: { name: 'Ground Slam', cost: 35, cd: 3.2, lock: 0.5, dmg: 25, radius: 2.8, knock: 9, leap: 1.8 },
  },
  knives: {
    name: 'Throwing Knives', jp: '苦無', desc: 'Swift at range, but low-damage.',
    rating: { speed: 4, damage: 2, range: 4 },
    basic: { name: 'Kunai', interval: 0.33, lock: 0.24, dmg: 4, speed: 17, pierce: 0 },
    special: { name: 'Kunai Fan', cost: 20, cd: 0.7, lock: 0.3, dmg: 3, count: 7, spread: 70, pierce: 1, speed: 16 },
  },
  staff: {
    name: 'Holy Staff', jp: '錫杖', desc: 'Area damage and healing.', move: 0.9,
    rating: { speed: 2, damage: 2, range: 4 },
    // basic: a spirit bolt that bursts into an area at the first enemy or at max range
    basic: { name: 'Spirit Burst', interval: 1.1, lock: 0.34, dmg: 7, speed: 14, range: 9, radius: 1.9 },
    // special: heals you and every ally within `radius`
    // heal is multiplied by your base damage (attack damage), so it grows with damage upgrades
    special: { name: 'Healing Circle', cost: 55, cd: 8, lock: 0.5, heal: 12, radius: 3 },
  },
  bo: {
    name: 'Bo Stick', jp: '棒', desc: 'Tactical successive strikes that warp time.',
    rating: { speed: 5, damage: 4, range: 2 },
    // basic: quick sweeping strike in front of you
    // combo (0-5): every hit raises it and shortens the cooldown (comboCd by combo level); a miss drops it to 0;
    // after comboHold seconds without a hit it falls by one every comboDecay seconds. Every 5th hit in a row is a finisher.
    basic: { name: 'Sweep', interval: 0.42, lock: 0.26, dmg: 5, range: 2.4, arc: 80, knock: 2, comboCd: [0.42, 0.37, 0.32, 0.27, 0.23, 0.19], comboHold: 0.8, comboDecay: 0.2 },
    // special: time slows for enemies while you rain rapid strikes in front of you
    special: { name: 'Thousand Strikes', cost: 40, cd: 4, lock: 1.1, dmg: 4, strikes: 12, dur: 1.0, range: 2.6, arc: 100, timeScale: 0.25 },
  },
  shield: {
    name: 'Shishi Shield', jp: '獅子盾', desc: 'Turn the enemy\'s blows back on them.', move: 0.9,
    rating: { speed: 2, damage: 4, range: 2 },
    // basic: a short dash along the aim that ends in a bash; enemy projectiles it meets fly back where they came from
    basic: { name: 'Shield Bash', interval: 1.1, lock: 0.32, dmg: 9, dash: 2.8, dashDur: 0.2, range: 1.3, arc: 110, knock: 5, stun: 0.2, reflectMul: 1.0 },
    // special: crouch behind the shield for dur s (85% less damage, every hit stored), then release 1.75x the store in a shockwave
    // a store under minStore only pushes enemies away (no damage)
    special: { name: 'Bulwark', cost: 50, cd: 14, lock: 1.6, dur: 1.5, reduce: 0.85, releaseMul: 1.75, radius: 3, maxStore: 300, minStore: 15, move: 0.25 },
  },
};
export const WEAPON_ORDER = ['katanas', 'crossbow', 'heavy', 'knives', 'staff', 'bo', 'shield'];
// switching weapons: after an attack, the OTHER weapon can only attack once this long has passed after that attack's lock
export const WEAPON_SWITCH = 0.3;
// movement speed while carrying a weapon: heavy (speed 1) 95% ... fast (speed 5) 107%; with two weapons the average counts
// (def.move overrides it: the crossbow and the monk staff are cumbersome to run with)
export const weaponMove = (def) => def.move ?? 0.92 + 0.03 * def.rating.speed;
// what the weapon select shows when hovering a weapon: a short description and the reach (tiles) of each attack
export const WEAPON_INFO = {
  katanas: { basic: { desc: 'Two quick slashes in front', reach: 1.75 }, special: { desc: 'Spin, cutting everything around you', reach: 2.2, hits: 5 } },
  crossbow: { basic: { desc: 'Hold to aim, release a heavy bolt', reach: 12 }, special: { desc: 'A heavy bolt that pierces a whole line', reach: 18 } },
  heavy: { basic: { desc: 'Hold to charge a crushing cleave', reach: 2.3 }, special: { desc: 'Leap and slam the ground', reach: 2.8 } },
  knives: { basic: { desc: 'Throw a fast kunai', reach: 15 }, special: { desc: 'A fan of seven kunai', reach: 13, hits: 7 } },
  staff: { basic: { desc: 'Spirit bolt that bursts in an area', reach: 9 }, special: { desc: 'Heal yourself and allies nearby', reach: 3, heal: true } },
  shield: { basic: { desc: 'Dash and bash · turns projectiles back', reach: 1.3, reflect: true }, special: { desc: 'Crouch, absorb hits, then release them', reach: 3, store: true } },
  bo: { basic: { desc: 'Combo strikes: each hit is faster', reach: 2.4 }, special: { desc: 'Slow time, rain twelve strikes', reach: 2.6, hits: 12 } },
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
  sumo:        B({ name: 'Sumo Brute',        behavior: 'sumo',    hp: 110, dmg: 26, speed: 1.6, r: 0.62, cost: 5, range: 2.4,  windup: 1.0,  recover: 0.9,  cooldown: 3.0,  minLevel: 3, heavy: true }),
  samurai:     B({ name: 'Armored Samurai',   behavior: 'samurai', hp: 145, dmg: 22, speed: 1.5, r: 0.5,  cost: 6, range: 2.9,  windup: 0.75, recover: 1.0,  cooldown: 2.0,  minLevel: 4, heavy: true }),
  tate:        B({ name: 'Tate Ashigaru',     behavior: 'shieldCharger', shield: 'pavise', hp: 45,  dmg: 14, speed: 3.4, r: 0.36, cost: 3, range: 1.3, windup: 0.6,  recover: 0.6, cooldown: 1.4, minLevel: 3 }),
  ironguard:   B({ name: 'Iron Gate Samurai', behavior: 'shieldTank',    shield: 'iron',   hp: 110, dmg: 18, speed: 1.6, r: 0.46, cost: 4, range: 1.8, windup: 0.55, recover: 0.7, cooldown: 1.6, minLevel: 5 }),
  // ---- Area 2: autumn mountain pass (yokai)
  shellguard:  B({ name: 'Kappa Shellguard',  behavior: 'shieldCharger', shield: 'shell',  hp: 40,  dmg: 15, speed: 3.5, r: 0.36, cost: 3, range: 1.3, windup: 0.55, recover: 0.6, cooldown: 1.4, minLevel: 12 }),
  barkwarden:  B({ name: 'Kodama Barkwarden', behavior: 'shieldTank',    shield: 'bark',   hp: 120, dmg: 19, speed: 1.5, r: 0.48, cost: 4, range: 1.9, windup: 0.55, recover: 0.7, cooldown: 1.6, minLevel: 14 }),
  kappa:       B({ name: 'Kappa',             behavior: 'hopper',  hp: 28,  dmg: 11, speed: 4.0, r: 0.33, cost: 1, range: 1.1,  windup: 0.26, recover: 0.35, cooldown: 0.6,  minLevel: 11 }),
  kamaitachi:  B({ name: 'Kamaitachi',        behavior: 'lunge',   hp: 40,  dmg: 18, speed: 2.4, r: 0.32, cost: 2, range: 3.0,  windup: 0.55, recover: 0.5,  cooldown: 1.0,  minLevel: 11, lungeSpeed: 17 }),
  karasu:      B({ name: 'Karasu Crow',       behavior: 'ranged',  hp: 24,  dmg: 7, speed: 2.8, r: 0.32, cost: 2, range: 8,    windup: 0.65, recover: 0.4,  cooldown: 1.3,  minLevel: 11, proj: 'dart' }),
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
  // ---- Training halls: skilled martial artists (dodge = chance to slip a weapon hit while not attacking)
  karateka:    B({ name: 'Karate Fighter',     behavior: 'melee',   hp: 34,  dmg: 11, speed: 3.3, r: 0.32, cost: 1, range: 1.15, windup: 0.3,  recover: 0.35, cooldown: 0.55, minLevel: 1, dodge: 0.22 }),
  kenshi:      B({ name: 'Kenjutsu Duelist',   behavior: 'melee',   hp: 44,  dmg: 15, speed: 2.9, r: 0.33, cost: 2, range: 1.4,  windup: 0.34, recover: 0.4,  cooldown: 0.7,  minLevel: 1, dodge: 0.3 }),
  bojutsu:     B({ name: 'Bō Adept',           behavior: 'lunge',   hp: 46,  dmg: 16, speed: 2.4, r: 0.33, cost: 2, range: 2.6,  windup: 0.5,  recover: 0.5,  cooldown: 0.95, minLevel: 1, dodge: 0.15 }),
  naginata:    B({ name: 'Naginata Adept',     behavior: 'lunge',   hp: 50,  dmg: 18, speed: 2.2, r: 0.34, cost: 2, range: 2.9,  windup: 0.55, recover: 0.55, cooldown: 1.0,  minLevel: 1, dodge: 0.12 }),
  shurikenka:  B({ name: 'Shuriken Thrower',   behavior: 'ranged',  hp: 26,  dmg: 10, speed: 2.9, r: 0.31, cost: 2, range: 7.5,  windup: 0.55, recover: 0.35, cooldown: 1.2,  minLevel: 1, proj: 'dart', dodge: 0.25 }),
  sensei:      B({ name: 'Dojo Master',        behavior: 'samurai', hp: 150, dmg: 22, speed: 1.7, r: 0.48, cost: 6, range: 2.9,  windup: 0.65, recover: 0.85, cooldown: 1.8,  minLevel: 1, heavy: true, dodge: 0.1 }),
  // ---- Training mode: a straw dummy that never attacks, never dies, and heals up when left alone
  dummy:       B({ name: 'Training Dummy',     behavior: 'dummy',   hp: 600, dmg: 0,  speed: 0,   r: 0.42, cost: 99, range: 0, windup: 1, minLevel: 99, resetAfter: 3 }),
  // ---- Libraries: wise enemies (scholars and sages that fight with spells)
  scholar:     B({ name: 'Scroll Scholar',     behavior: 'caster',  hp: 32,  dmg: 12, speed: 1.6, r: 0.33, cost: 2, range: 6.5,   windup: 0.8,  recover: 0.6,  cooldown: 3.0,  minLevel: 1, proj: 'orb' }),
  sage:        B({ name: 'Ink Sage',           behavior: 'caster',  hp: 40,  dmg: 14, speed: 1.5, r: 0.34, cost: 3, range: 10,   windup: 0.75, recover: 0.6,  cooldown: 2.6,  minLevel: 1, proj: 'soul' }),
};

export const BOSSES = {
  10: { type: 'ronin_boss', name: 'Ronin Warlord Kurogane', jp: '黒鉄', title: 'The Iron Ronin', hp: 1620, r: 0.55 },
  20: { type: 'tengu',      name: 'Tengu of the Red Peak',  jp: '天狗', title: 'Lord of the Mountain Winds', hp: 3300, r: 0.6 },
  30: { type: 'oni_lord',   name: 'Oni Lord Shuten',        jp: '酒呑', title: 'Gate Guardian of the Kagerō', hp: 8400, r: 1.0 },
  33: { type: 'gensai',     name: 'Regent Gensai',          jp: '玄斎', title: 'Usurper of the Kagerō', hp: 10500, r: 0.5, hall: true },
};
// Boss hit damage (already +20% over the original tuning; the Tengu hits ~75% harder than before).
export const BOSS_DMG = {
  ronin_boss: { sweep: 22, dash: 17, whirl: 46 },
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
// special level enemies: training halls fight only martial artists; libraries mix wise casters into the area's pool
export const DOJO_POOL = ['karateka', 'kenshi', 'bojutsu', 'naginata', 'shurikenka', 'sensei', 'sumo'];
export const LIBRARY_POOL = ['scholar', 'sage'];
export const LIBRARY_WISE_WEIGHT = 1.8; // pick weight of the wise casters next to the area's own enemies
// the regent's guard: what Gensai summons in his hall
export const GENSAI_GUARD = ['kgsoldier', 'kgsoldier', 'kgspear', 'kgsentry', 'kgshinobi', 'kgshield', 'kgwall'];
// Heavy (big tanky) enemies are rarer: lower pick weight and a per-level cap.
export const HEAVY_WEIGHT = 0.55;
export const heavyCap = (level, coop) => 1 + Math.floor((((level - 1) % 10) + 1) / 4) + (coop ? 1 : 0);
// shield-bearers (pavise, iron, bark, ice...): at most this many per level, the same growth as heavies
export const shieldCapFor = (level, coop) => 1 + Math.floor((((level - 1) % 10) + 1) / 4) + (coop ? 1 : 0);
export const SHIELD_WEIGHT = 0.8;     // how often shield-bearers are picked compared with plain enemies
export const SPAWN_REPEAT = 0.55;     // each heavy / shield-bearer already in the level multiplies the next one's odds by this
export const SPAWN_GUARANTEE = { shield: 3, heavy: 5 }; // from this level of each area, every level has at least one
// Shields block 80% of frontal hits until broken by 3 blocked melee hits or a burst of damage.
export const SHIELD = { block: 0.8, arc: Math.PI * 2 / 3, meleeHits: 3, burstFrac: 0.35, burstWindow: 1.5, breakStun: 0.8 };
export const PLAYER_STUN = 0.45;
// Sumo Brute moves: belly charge (speed x dur tiles, its red lane is exactly that long, width wide; hits for
// chargeMul x damage), then a stomp inside a circle of stompR after stompWindup seconds
export const SUMO = { speed: 10, dur: 0.6, width: 1.8, chargeMul: 0.9, stompR: 2.3, stompWindup: 0.8 };

// enemy HP: +5% per level through area 1, then +6% per level (bosses have fixed health)
export const levelScale = (level) => (level <= 10 ? 1 + 0.05 * (level - 1) : 1.45 + 0.06 * (level - 10));
// Enemy damage grows much slower than HP: player max HP is 70 (only sacrifices change it).
// ...plus a step per area (areas 1-4), so every new area also hits a bit harder
export const AREA_DMG = [0.8, 1.05, 1.15, 1.25];
// Attack windups (the telegraphed charge before a strike) last this much longer per area (areas 1-4):
// area 1 enemies charge slower so their attacks are easier to read. Bosses are not affected.
export const AREA_WINDUP = [1.35, 1, 1, 1];
export const levelDamageScale = (level) => (1 + 0.03 * (level - 1)) * AREA_DMG[level > 30 ? 3 : Math.floor((level - 1) / 10)];
// Enemy count multiplier: area 1 ramps from 1x (level 1) to 2x (level 9);
// later areas stay at 1.5x so there's no sudden drop when the area changes.
export const enemyCountMul = (level) => (level <= 10 ? 1.2 + 0.8 * (Math.min(level, 6) - 1) / 5 : level <= 20 ? 1.4 : level > 30 ? 1.8 : 1.65);
export const levelBudget = (level) => (6 + 2.3 * level) * enemyCountMul(level);

// ---- Upgrades ----
export const RARITIES = [
  { key: 'common',    name: 'Common',    jp: '並', weight: 50, color: '#cfc6b2', glow: '#a8a090' },
  { key: 'rare',      name: 'Rare',      jp: '稀', weight: 30, color: '#5fb2ff', glow: '#3a8cff' },
  { key: 'epic',      name: 'Epic',      jp: '極', weight: 15, color: '#c77dff', glow: '#9b4dff' },
  { key: 'legendary', name: 'Legendary', jp: '伝説', weight: 5, color: '#ffd45e', glow: '#ffb020' },
];

// Stat upgrades. values per rarity [common, rare, epic, legendary]
export const UPGRADES = {
  critChance:   { name: 'Crit Chance',   jp: '会心', values: [0.06, 0.11, 0.15, 0.30], fmt: 'pct',  cap: 1 },
  critDamage:   { name: 'Crit Damage',   jp: '痛撃', values: [0.18, 0.34, 0.50, 0.75], fmt: 'pctPlus' },
  baseDamage:   { name: 'Base Damage',   jp: '剛力', values: [0.06, 0.115, 0.15, 0.25], fmt: 'pct' },
  energyRegen:  { name: 'Energy Regen',  jp: '気',   values: [0.35, 0.58, 0.75, 1.5],    fmt: 'perSec1' },
  healthRegen:  { name: 'Health Regen',  jp: '癒',   values: [0.12, 0.23, 0.35, 0.6],   fmt: 'perSec2' },
  moveSpeed:    { name: 'Move Speed',    jp: '軽身', values: [0.05, 0.09, 0.12, 0.20], fmt: 'pct', cap: 1.7 },
  // multiplicative: new cooldown = cooldown x (1 - value)
  cooldown:     { name: 'Cooldown',      jp: '疾風', values: [0.05, 0.08, 0.12, 0.20], fmt: 'mulPct', mult: true, min: 0.4 },
  // multiplicative: ki cost of special attacks x (1 - value), down to 40%
  kiCost:       { name: 'Energy Usage',      jp: '気節', values: [0.06, 0.09, 0.12, 0.2], fmt: 'mulPct', mult: true, min: 0.4 },
};

// Music: when the area's song switches to its tense version. threat = living enemies (heavy ones count 3).
// Tense at a boss, at threat >= threat, or at lowHpThreat when a player is under 30% health;
// back to chill after threat stays <= calmThreat for hold seconds (clearedHold once the level is cleared).
// Tense = fighting: a hit dealt or taken (or an attack next to an enemy) within combatWindow s while
// at least combatEnemies are alive, or a boss fight. Chill at the start of a level (no fighting yet),
// once only calmEnemies or fewer are left (after calmHold s), or after hold s without fighting.
// minTense / minChill stop it from flickering.
export const MUSIC_TENSE = { combatWindow: 3, combatEnemies: 3, calmEnemies: 2, calmHold: 1.5, hold: 4, clearedHold: 1, minTense: 6, minChill: 2 };

// Waves per level, seconds between enemies within a wave, and seconds before the next wave comes anyway,
// per area (levels 1-2 use 2 waves). Areas 3-4 trickle in over many small waves.
export const SPAWN_PACING = [
  { waves: 3, stagger: 0.45, timeout: 13 },
  { waves: 6, stagger: 0.8, timeout: 15 },
  { waves: 5, stagger: 0.5, timeout: 12 },
  { waves: 7, stagger: 0.7, timeout: 11 },
];
// every hit a player takes from enemies, bosses, projectiles and hazards is multiplied by this
export const ENEMY_DAMAGE_MUL = 0.75;
// admin mode: a run started past level 1 (level select / ?level=N) deals this many times the normal damage
export const ADMIN_DAMAGE = 5;
// regular enemies move this much faster than their listed speed (bosses unchanged)
export const ENEMY_SPEED_MUL = 1.18;
// Large garden pond with a bridge (areas 1-2): chance per level, size in tiles (the bridge crosses the short side).
// The bridge is 2 tiles wide and centred on a tile row/column so every body size can path over it.
export const POND = { chance: 0.6, long: [7, 9], short: [4, 5], bridgeHalf: 1.0 };
// heavy ("super") enemies have this share of their listed health
export const HEAVY_HP_MUL = 0.8;

// Route map between levels: each path shows the reward you get after that level.
// Weights for the reward of a route node; sacrifice chance ramps up through the area to ROUTE.sacMax,
// and every area has at least sacMin and at most sacPerArea sacrifice nodes on its map.
export const ROUTE = {
  weights: { stat: 38, element: 22, talent: 14, item: 6, art: 13 },
  sacMax: 0.15, sacMin: 1, sacPerArea: 2,
  options: { stat: 3, element: 2, talent: 2, item: 3, art: 2 },
};

// ---- Route node indicators ----
// Every fight node rolls a difficulty before the player chooses: fewer/softer enemies on Novice, more,
// harder-hitting and more heavies on Difficult. count = enemy budget, heavyW = heavy pick weight,
// heavyCap = change to the per-level heavy cap, dmg = enemy damage.
export const DIFFICULTY = [
  { key: 'novice',    name: 'Easy',      count: 0.88, heavyW: 0.45, heavyCap: -1, dmg: 0.82 },
  { key: 'regular',   name: 'Normal',    count: 1.0,  heavyW: 1.0,  heavyCap: 0,  dmg: 1.0 },
  { key: 'difficult', name: 'Difficult', count: 1.3,  heavyW: 1.7,  heavyCap: 1,  dmg: 1.2 },
];
export const DIFFICULTY_ODDS = [0.3, 0.45, 0.25];
// Nodes whose cards roll a rarity also roll a reward tier [low, medium, high]. Harder fights lean a little
// toward better rewards, but not by much: an easy fight can still pay well, a hard one can pay badly.
export const REWARD_ODDS = [
  [0.48, 0.37, 0.15], // novice
  [0.40, 0.40, 0.20], // regular
  [0.32, 0.41, 0.27], // difficult
];
// mul = multiplier on the rarity weights [common, rare, epic, legendary]; min = rarity at least one card has
export const REWARD_TIERS = [
  { key: 'low',    name: 'Low',    mul: [1, 1, 1, 1],       min: 0 },
  { key: 'medium', name: 'Medium', mul: [1, 1.5, 1.5, 1.5], min: 1 },
  { key: 'high',   name: 'High',   mul: [1, 1.25, 2.4, 2.4], min: 2 },
];

// Consumable item cards (amount by rarity):
//  heal: restores health right away (only offered when hurt)
//  energy: restores ki right away (only offered when not full)
//  rush: +x% damage for the first 30 seconds of the next level
export const HEAL_CARD = { name: 'Herbal Tea', jp: '治癒', values: [20, 30, 45, 75], color: '#ff7a8a' };
export const ITEM_CARDS = {
  heal: HEAL_CARD,
  energy: { name: 'Energy Tonic', jp: '気薬', values: [25, 40, 60, 100], color: '#4fc8dc' },
  rush: { name: 'Rice Wine', jp: '戦勢', values: [0.1, 0.15, 0.25, 0.4], color: '#ff8a3c', dur: 30 },
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
  lightning: { name: 'Lightning', jp: '雷', values: [1, 2, 3, 5],        fmt: 'chains', color: '#ffe46a', desc: 'Hits chain to nearby enemies for 20–30% damage' },
  poison:    { name: 'Poison',    jp: '毒', values: [2, 4, 6, 12],       fmt: 'dps',    color: '#8fe05a', desc: 'Hits poison for 3s (damage per second)' },
  // syphon has diminishing returns: each card adds value x (1 - current / cap), so the 25% cap is only approached
  syphon:    { name: 'Syphon',    jp: '吸', values: [0.015, 0.03, 0.045, 0.08], fmt: 'pct1', color: '#ff6b8a', desc: 'Heals you for a share of the damage this weapon deals', cap: 0.25, diminish: true },
  ice:       { name: 'Ice',       jp: '氷', values: [0.1, 0.15, 0.2, 0.3], fmt: 'slow',  color: '#9ee4ff', desc: 'Hits slow enemy movement and attacks for 2s', cap: 0.7 },
  // wind: this weapon's attacks come back faster (cooldown reduction)
  wind:      { name: 'Wind',      jp: '風', values: [0.07, 0.11, 0.16, 0.25], fmt: 'slow', color: '#aef0c8', desc: 'This weapon\'s attacks recover faster', cap: 0.7 },
};
// every hit rolls a little luck: ±12% of its damage, and at least ±1
export const DAMAGE_SPREAD = 0.12;
// lightning: each chained hit deals this share of the hit (1 chain: low, 2: low-medium, 3+: medium)
export const chainDamageFor = (chains) => (chains >= 3 ? 0.3 : chains >= 2 ? 0.25 : 0.2);
export const ELEMENT_RULES = { chainRange: 3.5, chainDamage: 0.35, poisonDur: 3, poisonTick: 0.5, slowDur: 2 };

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
  // every number is per rarity [common, rare, epic, legendary]; a higher rarity is stronger and recharges faster
  arrowRain: { name: 'Arrow Rain',        jp: '矢雨', cd: [24, 22, 20, 18], desc: 'Rains arrows on an area', radius: 2.6, dur: 2.2, tick: 0.2, dmg: [8, 11, 15, 21], targeted: true },
  meteor:    { name: 'Meteorite',         jp: '隕石', cd: [27, 24, 22, 20], desc: 'Strikes an area with a meteorite', radius: 2.1, delay: 0.85, dmg: [80, 120, 170, 250], targeted: true },
  meditate:  { name: 'Meditate',          jp: '瞑想', cd: [32, 30, 27, 24], desc: 'Restores some energy', coopDesc: ' (partner gets some)', energy: [35, 55, 80, 999], partner: [15, 25, 35, 50] },
  vitalize:  { name: 'Vitalize',          jp: '活力', cd: [40, 36, 32, 28], desc: 'Restores some health', coopDesc: ' (partner gets some)', heal: [15, 25, 40, 999], partner: [8, 12, 18, 30] },
  shadows:   { name: 'Master of Shadows', jp: '影分身', cd: [50, 45, 40, 34], desc: 'Spawns shadow clones to fight for you for {dur}s', count: [3, 4, 6, 9], dur: 8, dmg: 4, interval: 0.55 },
  rage:      { name: 'Rage',              jp: '激怒', cd: [40, 36, 32, 28], desc: 'Increases your damage for {dur}s', dur: 6, mult: [1.5, 2, 2.75, 3.5] },
};
