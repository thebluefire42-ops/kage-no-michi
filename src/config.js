// All tunable game numbers live here.

export const PLAYER_BASE = {
  maxHp: 70,
  maxEnergy: 100,
  speed: 4.14,         // world units / s (2026-11-21: -10%, was 4.6; before that 5.4)
  radius: 0.32,
  stats: {
    critChance: 0.1,   // 10%
    critDamage: 0.5,   // +50%
    cooldownMul: 1,    // x1: multiplies every attack cooldown (set by sacrifices; Wind works per weapon)
    baseDamage: 1,     // x1
    energyRegen: 1.65, // per second (no Energy Regen cards any more)
    healthRegen: 0.4,  // per second (2 per 5s)
    cooldown: 1,       // x1: multiplies every attack, talent and dash cooldown (no card raises it any more)
    dashCd: 1,         // x1: multiplies the dash cooldown (Dash Cooldown cards)
    moveSpeed: 1,      // x1
    kiCost: 1,         // x1: multiplies the ki cost of every attack that costs ki (reduced by Ki Focus cards)
    // conditional town cards (2026-11-21, user's design; numbers in UPGRADES):
    highHpDmg: 0,      // +damage while at or above HIGH_HP of max health
    idleEnergy: 0,     // +energy regen after IDLE_ENERGY_T s without attacking
    levelDmg: 0,       // +damage gained for every level completed from now on (Player.levelBonus holds the total)
    perfectEnergy: 0,  // energy from every perfect dodge
    dodgeEnergy: 0,    // energy from a dash that passes through at least one enemy
    openStrike: 0,     // +damage to enemies above OPEN_STRIKE_HP of their health
    lowHpSpeed: 0,     // +move speed below LOW_HP of max health
    energyHeal: 0,     // health per energy spent (1 per 25 = 0.04)
    afterCrit: 0,      // +crit chance for AFTERIMAGE_T s after a dash
    highEnergyDmg: 0,  // +damage while energy is above HIGH_ENERGY
  },
  dash: { cost: 0, cooldown: 5, minCooldown: 1.0, distance: 2.7, duration: 0.18, jumpDuration: 0.24 },
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
    rating: { speed: 4, damage: 3, range: 2 },
    basic: { name: 'Twin Slash', interval: 0.3, edge: 0.65, edgeMul: 2.1, lock: 0.19, dmg: 3.3, range: 1.9, arc: 115 }, // (2026-11-20: tip x2.1, was x1.4 at 4.5 dmg)
    // secondary: Whirlwind (the special until 2026-11-21): spin, cutting everything around you
    secondary: { name: 'Whirlwind', cost: 15, cd: 4, lock: 0.5, dmg: 4, ticks: 5, dur: 0.5, radius: 2.2 }, // (2026-11-21: 15 energy, was 40; 4.5 per cut, was 7; cooldown 4 s, was 0.9)
    // special: Blade Waltz (2026-11-21): blink from enemy to enemy within `radius` of where you stood, one cut each
    // (`strikes` in all, `every` s apart; the least-cut enemy next), while enemies slow to timeScale. You can't be hit
    // during it and end beside the last enemy cut. Needs an enemy in reach (nothing is spent otherwise).
    special: { name: 'Blade Waltz', cost: 45, cd: 12, lock: 0.2, strikes: 6, dmg: 13.5, radius: 5.5, every: 0.13, timeScale: 0.3 }, // (every 0.13 s, was 0.09: a little slower)
  },
  crossbow: {
    name: 'Crossbow', jp: '弩', desc: 'High-precision with a slow reload.', move: 0.9,
    rating: { speed: 2, damage: 4, range: 4 },
    // basic: no draw (2026-11-19): every bolt flies the full maxRange; the reload is longer instead. Every enemy keeps its own
    // marks: the 3rd bolt on the same enemy breaks them for markMul x damage (hitting others in between keeps them)
    basic: { name: 'Bolt', markMul: 2, interval: 1.3, lock: 0.32, dmg: 12, speed: 31, pierce: 0, maxRange: 7.9 }, // (range -25% on 2026-11-19: was 10.5)
    // special: one heavy bolt that flies a long straight line and pierces every enemy in it
    // secondary: leap back out of reach and loose a bolt while in the air (it marks like a normal bolt)
    secondary: { name: 'Backstep Shot', cost: 8, cd: 3, lock: 0.34, hop: 2.4, dur: 0.3, dmg: 12 },
    special: { name: 'Piercing Shot', cost: 25, cd: 3.2, lock: 0.45, dmg: 50, pierce: 99, speed: 38, range: 18, knock: 4 },
  },
  heavy: {
    name: 'Heavy Sword', jp: '大太刀', desc: 'Crushing power but very slow.',
    rating: { speed: 1, damage: 5, range: 2 },
    // hold to charge (chargeTime): damage grows linearly with the charge, up to +chargeDmg (full charge = 2.8x)
    // hold to charge (chargeTime): up to +chargeDmg damage, +chargeKnock knockback and +chargeRange reach
    // basic: a quick, short sweep (free); secondary: the old charged cleave, wider, slowing what it hits, for a little ki
    basic: { name: 'Low Sweep', interval: 0.75, lock: 0.36, dmg: 10, range: 1.7, arc: 130, knock: 4 },
    secondary: { name: 'Cleave', cost: 10, interval: 1.6, lock: 0.5, dmg: 14, range: 2.8, arc: 190, knock: 11, chargeTime: 0.9, chargeDmg: 1.8, chargeKnock: 9, chargeRange: 0.6, slow: 0.4, slowDur: 2.5 },
    special: { name: 'Ground Slam', cost: 30, cd: 3.2, lock: 0.6, dmg: 38, radius: 3.3, knock: 10, leap: 2.1, leapDur: 0.44, anim: 0.6 },
  },
  knives: {
    name: 'Throwing Knives', jp: '苦無', desc: 'Swift at range, but low-damage.',
    rating: { speed: 5, damage: 2, range: 3 },
    // basic attacks are free; the fan costs 1 energy per kunai. Kunai stick in what they hit (for stick s, at most maxStick per enemy); dashing
    // through that enemy pulls them out again for pullDmg each and cuts that dash's cooldown by dashCut
    basic: { name: 'Blades', interval: 0.33, lock: 0.24, dmg: 4, pullDmg: 5, speed: 23, range: 7, pierce: 0, stick: 5, maxStick: 5, dashCut: 0.8 },
    secondary: { name: 'Blade Fan', cost: 4, cd: 2.5, lock: 0.3, dmg: 4, count: 7, spread: 70, pierce: 1, speed: 21, range: 6.5 },
    // special: kunai fly out all around you in quick succession while time slows down for a moment
    special: { name: 'Blade Storm', cost: 35, cd: 14, lock: 0.85, dmg: 8, count: 20, dur: 0.75, speed: 20, range: 6, pierce: 1, timeScale: 0.35 },
  },
  staff: {
    name: 'Holy Staff', jp: '錫杖', desc: 'Area damage and healing.', move: 0.9,
    rating: { speed: 2, damage: 2, range: 4 },
    // basic: a spirit bolt that bursts into an area at the first enemy or at max range
    // every burst leaves the enemies it hits vulnerable for vulnDur s: x vulnMul damage from every other source
    // (2026-11-19: no paper talisman any more: a small light that sways through the air and lands on the ground; range was 9)
    basic: { name: 'Spirit Light', interval: 1.1, lock: 0.34, dmg: 7, range: 5, minRange: 2, flight: 0.55, sway: 0.7, radius: 1.9, vulnDur: 4, vulnMul: 1.2 },
    // special: heals you and every ally within `radius`
    // heal is multiplied by your attack damage, so it grows with damage upgrades
    // secondary: a 45 degree sweep of the staff; only its outer edge (the last `edge` tiles of its reach) does damage
    secondary: { name: 'Halo Sweep', cost: 15, interval: 1.4, lock: 0.4, dmg: 16, range: 3.8, edge: 0.9, arc: 45, knock: 3 },
    special: { name: 'Healing Circle', cost: 55, cd: 8, lock: 0.5, heal: 12, radius: 3, push: 9 }, // push: enemies in the circle are thrown back
  },
  bo: {
    name: 'Bo Stick', jp: '棒', desc: 'Tactical successive strikes that warp time.',
    rating: { speed: 4, damage: 3, range: 2 },
    // basic: quick sweeping strike in front of you
    // combo (0-5): every hit raises it and shortens the cooldown (comboCd by combo level: slow at no combo, very fast
    // at full combo; the damage stays the same); a miss drops it to 0;
    // after comboHold seconds without a hit it falls by one every comboDecay seconds. Every 5th hit in a row is a finisher.
    basic: { name: 'Sweep', interval: 0.9, lock: 0.28, dmg: 6.5, range: 2.24, arc: 80, knock: 2, comboCd: [0.9, 0.68, 0.48, 0.38, 0.32, 0.29], comboHold: 0.8, comboDecay: 0.2 }, // (2026-11-20: ~12% slower, 5.5 → 6.5 dmg)
    // special: time slows for enemies while you rain rapid strikes in front of you
    // secondary: plant the stick and vault up over it (untouchable for the jump); the next attack deals +50%
    // (a quick, low ninja whip around the planted stick, not a high jump: release = share of the move after which the stick is back in hand)
    secondary: { name: 'Pole Vault', cost: 8, cd: 5.5, lock: 0.3, dur: 0.4, height: 0.75, hop: 2.3, release: 0.55, empower: 1.5, hold: 5 },
    special: { name: 'Thousand Strikes', cost: 40, cd: 9, lock: 1.1, dmg: 4, strikes: 12, dur: 1.0, range: 2.6, arc: 100, timeScale: 0.25 },
  },
  shield: {
    name: 'Shishi Shield', jp: '獅子盾', desc: 'Turn the enemy\'s blows back on them.', move: 0.9,
    rating: { speed: 2, damage: 4, range: 2 },
    // basic: a short dash along the aim that ends in a bash; enemy projectiles it meets fly back where they came from
    basic: { name: 'Shield Bash', interval: 1.4, lock: 0.32, dmg: 9, dash: 4.2, dashDur: 0.26, range: 1.3, arc: 110, knock: 5, stun: 0.2, reflectMul: 1.0, reflectSpeed: 2.2 }, // reflectSpeed: turned-back shots fly this much faster (at least 20 tiles/s)
    // special: crouch behind the shield for dur s (85% less damage, every hit stored), then release 1.75x the store in a shockwave
    // a store under minStore only pushes enemies away (no damage)
    // secondary: the shield is thrown once around you in a circle, hitting everything on its way, and comes back
    secondary: { name: 'Lion Disc', cost: 8, cd: 2.6, lock: 0.3, dmg: 10, radius: 2.4, dur: 0.6, knock: 5 },
    special: { name: 'Bulwark', cost: 50, cd: 14, lock: 1.6, dur: 1.5, reduce: 0.85, releaseMul: 1.75, radius: 4, maxStore: 300, minStore: 15, move: 0.25 },
  },
  gloves: {
    name: "Earth Shaper's Gloves", jp: '地神手', desc: 'Slow and heavy: stomp, raise a rock, punch it through.', move: 0.94,
    rating: { speed: 1, damage: 4, range: 3 },
    // basic: a stomp (stompDmg to everyone within stompR, pushed back; you stand still for anchor s), then a dark rock rises
    // and the punch (at punchAt s) sends it along the aim: dmg to the first enemy hit, half of it to others within splash
    // (2026-11-19: much faster, much less per hit: was interval 1.55, dmg 22, stomp 4)
    basic: { name: 'Stone Fist', interval: 0.9, lock: 0.34, stompDmg: 2.5, stompR: 1.4, stompKnock: 3, anchor: 0.24, dmg: 11, speed: 16, range: 7, splash: 1.0, knock: 5, punchAt: 0.18, stompAt: 0.08 },
    // secondary: an uppercut into the air; a great dark rock bursts out of the ground in front of the enemy and strikes it at an angle
    secondary: { name: 'Rising Crag', cost: 12, cd: 3.1, lock: 0.5, dmg: 30, range: 6, radius: 1.2, knock: 9, at: 0.23 },
    // special: every enemy within radius is locked in spiked rock for lockDur s (bosses are slowed instead), and for as long
    // the basic recovers quakeMul times as fast
    special: { name: 'Earthen Prison', cost: 40, cd: 14, lock: 0.6, radius: 6, lockDur: 5, quakeMul: 0.6, bossSlow: 0.5 },
  },
  orb: {
    name: 'Restless Spirit Orb', jp: '霊玉', desc: 'Souls of the fallen fight for you',
    rating: { speed: 1, damage: 4, range: 3 },
    // basic: a slow wisp that hunts the nearest enemy ahead of you for `life` s (turning `turn` rad/s, looking `seek` tiles ahead).
    // A hit tethers the enemy: tickDmg every `tick` s for tetherDur s (it no longer takes extra damage from other sources).
    // Every enemy on the line between the player and a tethered enemy takes the same tick too (it is not tethered by it).
    // When a tethered enemy dies, the tether jumps to the nearest enemy within `spread` tiles.
    basic: { name: 'Haunting Wisp', interval: 1.05, lock: 0.3, dmg: 2, speed: 5.5, life: 3, turn: 4.2, seek: 7, tetherDur: 4, tick: 0.5, tickDmg: 2.3, spread: 5 },
    // special: calls back the last enemy killed (not bosses) as a spirit with its own stats; spirits stay between levels until
    // they fall. At most `max` per player (the oldest fades). hurtMul = share of enemy damage a spirit really takes.
    // secondary: the orb is dashed on the ground at your feet and breaks: spirits rise out of it, and everything around takes
    // damage and is tethered (no slow since 2026-11-21); the orb forms again in your hand a moment later
    secondary: { name: 'Soul Drop', cost: 12, cd: 4.5, lock: 0.35, dmg: 5, radius: 2.2, flight: 0.16, reform: 0.55 }, // (2026-11-20: +50%, was 8 energy / 3 s)
    special: { name: 'Call the Fallen', cost: 40, cd: 11.7, lock: 0.6, max: 4, leash: 9, hurtMul: 0.6 },
  },
};
export const WEAPON_ORDER = ['katanas', 'knives', 'bo', 'orb', 'gloves', 'crossbow', 'heavy', 'staff', 'shield']; // (weapon select order; the locked ones last)
// weapons that can't be picked for now (shown locked on the weapon select screen; 2026-11-20)
export const LOCKED_WEAPONS = new Set(['crossbow', 'heavy', 'staff', 'shield']);
// switching weapons: after an attack, the OTHER weapon can only attack once this long has passed after that attack's lock
export const WEAPON_SWITCH = 0.3;
// movement speed while carrying a weapon: heavy (speed 1) 95% ... fast (speed 5) 107%
// (def.move overrides it: the crossbow and the monk staff are cumbersome to run with)
export const weaponMove = (def) => def.move ?? 0.92 + 0.03 * def.rating.speed;
// what the weapon select shows when hovering a weapon: a short description and the reach (tiles) of each attack
export const WEAPON_INFO = {
  katanas: { secondary: { desc: 'Spin, cutting everything around you', reach: 2.2, hits: 5 }, basic: { desc: 'Quick slashes · double damage with the blade tip', reach: 1.9 }, special: { desc: 'Blink from enemy to enemy in slow motion, cutting each', reach: 5.5, hits: 6 } },
  crossbow: { secondary: { desc: 'Leap back and fire a bolt mid-air', reach: 7.9 }, basic: { desc: 'Marks every enemy hit; the 3rd bolt on one hits 2x', reach: 7.9, marks: true }, special: { desc: 'A heavy bolt that pierces a whole line', reach: 18 } },
  heavy: { basic: { desc: 'A quick, short sweep', reach: 1.7 }, secondary: { desc: 'Hold to charge a wide cleave that slows', reach: 2.8 }, special: { desc: 'Leap and slam the ground', reach: 3.3 } },
  knives: { basic: { desc: 'Blades stick · dash through to pull them out', reach: 7 }, secondary: { desc: 'A fan of seven blades', reach: 6.5, hits: 7 }, special: { desc: 'Time slows; blades fly out all around you', reach: 6, hits: 20 } }, // (Blade Storm: 8 x 20)
  staff: { secondary: { desc: 'A sweep of light that strikes only at its edge', reach: 3.8 }, basic: { desc: 'A swaying light lands and bursts · +20% dmg taken 4s', reach: 5 }, special: { desc: 'Heal yourself and allies nearby', reach: 3, heal: true } },
  shield: { secondary: { desc: 'Throw the shield once around you', reach: 2.4 }, basic: { desc: 'Dash and bash · shots hitting the charge fly back', reach: 4.2, reflect: true }, special: { desc: 'Crouch, absorb hits, then release them', reach: 4, store: true } },
  bo: { secondary: { desc: 'Untouchable vault, attack mid-air · next hit +50%', reach: 2.3 }, basic: { desc: 'Combo strikes on one enemy: each hit is faster', reach: 2.24 }, special: { desc: 'Slow time, rain twelve strikes', reach: 2.6, hits: 12 } },
  gloves: { secondary: { desc: 'Uppercut: a great rock strikes up at them', reach: 6 }, basic: { desc: 'Stomp, then punch a rising rock at them', reach: 7 }, special: { desc: 'Lock everyone near in stone; punch faster', reach: 6 } },
  orb: { secondary: { desc: 'Smash the orb at your feet: spirits rise and tether', reach: 2.2 }, basic: { desc: 'Tethers enemies: their soul burns over time', reach: 7 }, special: { desc: 'The last enemy slain rises to fight for you', reach: 2 } },
};

// Enemies. Every biome has its own roster; `behavior` is the shared AI archetype,
// `heavy` marks the big, slow, hard-hitting ability enemies. hp/dmg get scaled by level.
// onHit: extra effect on the player when this enemy's attack lands (chill = slow).
const B = (o) => ({ recover: 0.5, cooldown: 1, ...o });
export const ENEMIES = {
  // ---- Area 1: spring village (bandits and soldiers)
  bandit:      B({ name: 'Ronin Bandit',      behavior: 'melee',   hp: 30,  dmg: 14.4, speed: 2.7, r: 0.33, cost: 1, range: 1.3,  windup: 0.4,  recover: 0.45, cooldown: 0.7,  minLevel: 1 }),
  spear:       B({ name: 'Ashigaru Spearman', behavior: 'lunge',   hp: 46,  dmg: 20, speed: 1.8, r: 0.34, cost: 2, range: 2.6,  windup: 0.65, recover: 0.6,  cooldown: 1.1,  minLevel: 2 }),
  archer:      B({ name: 'Yumi Archer',       behavior: 'ranged',  hp: 22,  dmg: 11.5, speed: 2.5, r: 0.32, cost: 2, range: 8,    windup: 0.7,  recover: 0.4,  cooldown: 1.7,  minLevel: 1, proj: 'arrow' }), // (cooldown 1.7, was 1.4: shoots a little less often) // (from level 1 since 2026-11-21: early levels shouldn't be only bandits)
  assassin:    B({ name: 'Shinobi Assassin',  behavior: 'blink',   hp: 20,  dmg: 16, speed: 4.8, r: 0.3,  cost: 2, range: 1.15, windup: 0.24, recover: 0.3,  cooldown: 0.55, minLevel: 4 }),
  bomber:      B({ name: 'Bomb Thrower',      behavior: 'lob',     hp: 32,  dmg: 22, speed: 1.6, r: 0.38, cost: 3, range: 8.5,  windup: 0.6,  recover: 0.6,  cooldown: 2.6,  minLevel: 6, proj: 'bomb' }),
  sumo:        B({ name: 'Sumo Brute',        behavior: 'sumo',    hp: 110, dmg: 26, speed: 1.6, r: 0.62, cost: 5, range: 2.4,  windup: 1.0,  recover: 0.9,  cooldown: 2.0,  minLevel: 3, heavy: true }),
  samurai:     B({ name: 'Armored Samurai',   behavior: 'samurai', hp: 145, dmg: 22, speed: 1.5, r: 0.5,  cost: 6, range: 2.9,  windup: 0.75, recover: 1.0,  cooldown: 2.0,  minLevel: 4, heavy: true }),
  tate:        B({ name: 'Tate Ashigaru',     behavior: 'shieldCharger', shield: 'pavise', hp: 45,  dmg: 14, speed: 3.4, r: 0.36, cost: 3, range: 1.3, windup: 0.6,  recover: 0.6, cooldown: 1.4, minLevel: 3 }),
  // a support soldier: carries a tall nobori banner; enemies inside its wide orange circle are emboldened (BANNER).
  // It keeps back, standing where its circle covers the most allies; up close it jabs with the banner pole.
  banner:      B({ name: 'Banner Bearer',     behavior: 'banner',  hp: 42,  dmg: 9,  speed: 2.5, r: 0.34, cost: 3, range: 1.3,  windup: 0.5,  recover: 0.5,  cooldown: 1.3,  minLevel: 4, support: true }),
  ironguard:   B({ name: 'Iron Gate Samurai', behavior: 'shieldTank',    shield: 'iron',   hp: 110, dmg: 18, speed: 1.6, r: 0.46, cost: 4, range: 1.8, windup: 0.55, recover: 0.7, cooldown: 1.6, minLevel: 5 }),
  // ---- Area 2: autumn mountain pass (yokai)
  shellguard:  B({ name: 'Kappa Shellguard',  behavior: 'shieldCharger', shield: 'shell',  hp: 40,  dmg: 15, speed: 3.5, r: 0.36, cost: 3, range: 1.3, windup: 0.55, recover: 0.6, cooldown: 1.4, minLevel: 12 }),
  barkwarden:  B({ name: 'Kodama Barkwarden', behavior: 'shieldTank',    shield: 'bark',   hp: 120, dmg: 19, speed: 1.5, r: 0.48, cost: 4, range: 1.9, windup: 0.55, recover: 0.7, cooldown: 1.6, minLevel: 14 }),
  kappa:       B({ name: 'Kappa',             behavior: 'hopper',  hp: 28,  dmg: 11, speed: 4.0, r: 0.33, cost: 1, range: 1.1,  windup: 0.26, recover: 0.35, cooldown: 0.6,  minLevel: 11 }),
  kamaitachi:  B({ name: 'Kamaitachi',        behavior: 'lunge',   hp: 40,  dmg: 18, speed: 2.4, r: 0.32, cost: 2, range: 3.0,  windup: 0.55, recover: 0.5,  cooldown: 1.0,  minLevel: 11, lungeSpeed: 17 }),
  karasu:      B({ name: 'Karasu Crow',       behavior: 'ranged',  hp: 24,  dmg: 7, speed: 2.8, r: 0.32, cost: 2, range: 8,    windup: 0.65, recover: 0.4,  cooldown: 1.3,  minLevel: 11, proj: 'dart' }),
  kitsune:     B({ name: 'Kitsune',           behavior: 'blink',   hp: 24,  dmg: 9,  speed: 4.6, r: 0.3,  cost: 2, range: 1.15, windup: 0.24, recover: 0.3,  cooldown: 0.55, minLevel: 12 }),
  tanuki:      B({ name: 'Tanuki',            behavior: 'lob',     hp: 36,  dmg: 18.7, speed: 1.7, r: 0.4,  cost: 3, range: 8.5,  windup: 0.6,  recover: 0.6,  cooldown: 2.5,  minLevel: 13, proj: 'jug' }),
  yamabushi:   B({ name: 'Yamabushi Monk',    behavior: 'caster',  hp: 36,  dmg: 12, speed: 1.5, r: 0.33, cost: 3, range: 10,   windup: 0.8,  recover: 0.6,  cooldown: 3.2,  minLevel: 12, proj: 'orb' }),
  boar:        B({ name: 'Boar Spirit',       behavior: 'boar',    hp: 136, dmg: 25.5, speed: 1.8, r: 0.62, cost: 5, range: 9,    windup: 1.0,  recover: 0.8,  cooldown: 2.2,  minLevel: 13, heavy: true }),
  komainu:     B({ name: 'Komainu Guardian',  behavior: 'komainu', hp: 179, dmg: 25.5, speed: 1.2, r: 0.6,  cost: 6, range: 8,    windup: 0.55, recover: 1.2,  cooldown: 2.6,  minLevel: 14, heavy: true }),
  // ---- Area 3: snowy castle town at night (undead and oni)
  boneshield:  B({ name: 'Bone Shieldbearer', behavior: 'shieldCharger', shield: 'bone',   hp: 52,  dmg: 15, speed: 3.4, r: 0.36, cost: 3, range: 1.3, windup: 0.55, recover: 0.6, cooldown: 1.4, minLevel: 22 }),
  glacier:     B({ name: 'Glacier Warden',    behavior: 'shieldTank',    shield: 'ice',    hp: 110, dmg: 20, speed: 1.5, r: 0.5,  cost: 4, range: 1.9, windup: 0.55, recover: 0.7, cooldown: 1.6, minLevel: 24, onHit: { chill: 0.35, dur: 1.5 } }),
  skeleton:    B({ name: 'Skeleton Soldier',  behavior: 'melee',   hp: 34,  dmg: 13, speed: 2.6, r: 0.33, cost: 1, range: 1.3,  windup: 0.4,  recover: 0.45, cooldown: 0.7,  minLevel: 21 }),
  ghostspear:  B({ name: 'Ghost Spearman',    behavior: 'lunge',   hp: 46,  dmg: 17, speed: 2.0, r: 0.34, cost: 2, range: 2.8,  windup: 0.6,  recover: 0.6,  cooldown: 1.1,  minLevel: 21 }),
  frostarcher: B({ name: 'Frost Archer',      behavior: 'ranged',  hp: 26,  dmg: 10, speed: 2.4, r: 0.32, cost: 2, range: 8,    windup: 0.7,  recover: 0.4,  cooldown: 1.7,  minLevel: 21, proj: 'icearrow', onHit: { chill: 0.35, dur: 1.5 } }),
  yukionna:    B({ name: 'Yuki-onna',         behavior: 'blink',   hp: 26,  dmg: 9,  speed: 4.4, r: 0.3,  cost: 2, range: 1.2,  windup: 0.26, recover: 0.3,  cooldown: 0.6,  minLevel: 22, onHit: { chill: 0.45, dur: 1.8 } }),
  imp:         B({ name: 'Fire Imp',          behavior: 'lob',     hp: 30,  dmg: 17, speed: 2.0, r: 0.34, cost: 3, range: 8.5,  windup: 0.55, recover: 0.6,  cooldown: 2.4,  minLevel: 22, proj: 'firejar' }),
  wisp:        B({ name: 'Wisp Priest',       behavior: 'caster',  hp: 34,  dmg: 12, speed: 1.6, r: 0.33, cost: 3, range: 10,   windup: 0.8,  recover: 0.6,  cooldown: 3.0,  minLevel: 23, proj: 'soul' }),
  oni:         B({ name: 'Oni Brute',         behavior: 'charger', hp: 128, dmg: 23, speed: 1.3, r: 0.55, cost: 5, range: 2.0,  windup: 0.5,  recover: 0.9,  cooldown: 1.6,  minLevel: 22, heavy: true }),
  gashadokuro: B({ name: 'Gashadokuro',       behavior: 'gasha',   hp: 160, dmg: 24, speed: 1.1, r: 0.85, cost: 7, range: 5.5,  windup: 0.8,  recover: 1.2,  cooldown: 2.4,  minLevel: 23, heavy: true }),
  // ---- Area 4: the Kagerō fortress (Gensai's elite soldiers)
  kgsoldier:   B({ name: 'Kagerō Soldier',     behavior: 'melee',   hp: 50,  dmg: 12.75, speed: 3.0, r: 0.34, cost: 2, range: 1.35, windup: 0.36, recover: 0.4,  cooldown: 0.6,  minLevel: 31 }),
  kgspear:     B({ name: 'Fortress Spearman',  behavior: 'lunge',   hp: 62,  dmg: 21, speed: 2.3, r: 0.34, cost: 2, range: 2.9,  windup: 0.5,  recover: 0.5,  cooldown: 0.95, minLevel: 31, lungeSpeed: 18 }),
  kgsentry:    B({ name: 'Crossbow Sentry',    behavior: 'ranged',  hp: 40,  dmg: 14, speed: 2.4, r: 0.32, cost: 2, range: 9,    windup: 0.75, recover: 0.4,  cooldown: 1.25, minLevel: 31, proj: 'arrow' }),
  kgshinobi:   B({ name: 'Elite Shinobi',      behavior: 'blink',   hp: 38,  dmg: 10.2, speed: 5.0, r: 0.3,  cost: 2, range: 1.2,  windup: 0.24, recover: 0.28, cooldown: 0.5,  minLevel: 31 }),
  kgshield:    B({ name: 'Gate Shieldbearer',  behavior: 'shieldCharger', shield: 'iron', hp: 58, dmg: 17, speed: 3.6, r: 0.36, cost: 3, range: 1.3, windup: 0.5, recover: 0.6, cooldown: 1.3, minLevel: 31 }),
  kgwall:      B({ name: 'Iron Wall Guard',    behavior: 'shieldTank',    shield: 'iron', hp: 115, dmg: 22, speed: 1.7, r: 0.48, cost: 4, range: 1.9, windup: 0.5, recover: 0.7, cooldown: 1.5, minLevel: 31 }),
  kgmonk:      B({ name: 'War Priest',         behavior: 'caster',  hp: 48,  dmg: 14, speed: 1.6, r: 0.33, cost: 3, range: 10,   windup: 0.75, recover: 0.6,  cooldown: 2.8,  minLevel: 32, proj: 'orb' }),
  kgchampion:  B({ name: 'Honor Guard Champion', behavior: 'samurai', hp: 150, dmg: 32, speed: 1.6, r: 0.5, cost: 6, range: 3.0,  windup: 0.7,  recover: 0.9,  cooldown: 1.8,  minLevel: 31, heavy: true }),
  frostoni:    B({ name: 'Frost Oni',         behavior: 'frostoni', hp: 150, dmg: 20, speed: 1.3, r: 0.62, cost: 6, range: 5,    windup: 0.9,  recover: 1.0,  cooldown: 2.4,  minLevel: 24, heavy: true, onHit: { chill: 0.5, dur: 2.2 } }),
  // ---- Training halls: skilled martial artists (dodge = chance to slip a weapon hit while not attacking)
  karateka:    B({ name: 'Karate Fighter',     behavior: 'melee',   hp: 34,  dmg: 11, speed: 3.3, r: 0.32, cost: 1, range: 1.15, windup: 0.3,  recover: 0.35, cooldown: 0.55, minLevel: 1, dodge: 0.22 }),
  kenshi:      B({ name: 'Kenjutsu Duelist',   behavior: 'melee',   hp: 44,  dmg: 15, speed: 2.9, r: 0.33, cost: 2, range: 1.4,  windup: 0.34, recover: 0.4,  cooldown: 0.7,  minLevel: 1, dodge: 0.3 }),
  bojutsu:     B({ name: 'Bō Adept',           behavior: 'lunge',   hp: 46,  dmg: 16, speed: 2.4, r: 0.33, cost: 2, range: 2.6,  windup: 0.5,  recover: 0.5,  cooldown: 0.95, minLevel: 1, dodge: 0.15 }),
  naginata:    B({ name: 'Naginata Adept',     behavior: 'lunge',   hp: 50,  dmg: 18, speed: 2.2, r: 0.34, cost: 2, range: 2.9,  windup: 0.55, recover: 0.55, cooldown: 1.0,  minLevel: 1, dodge: 0.12 }),
  shurikenka:  B({ name: 'Shuriken Thrower',   behavior: 'ranged',  hp: 26,  dmg: 10, speed: 2.9, r: 0.31, cost: 2, range: 7.5,  windup: 0.55, recover: 0.35, cooldown: 1.2,  minLevel: 1, proj: 'dart', dodge: 0.25 }),
  sensei:      B({ name: 'Dojo Master',        behavior: 'samurai', hp: 150, dmg: 22, speed: 1.7, r: 0.48, cost: 6, range: 2.9,  windup: 0.65, recover: 0.85, cooldown: 1.8,  minLevel: 1, heavy: true, dodge: 0.1 }),
  // ---- Area 2 additions (2026-11-19)
  // a wind-swallow yokai: circles the player in the air, folds its wings and dives straight through (red lane)
  tsubame:     B({ name: 'Kaze Tsubame',       behavior: 'swoop',   hp: 26, dmg: 12, speed: 4.4, r: 0.3,  cost: 1, range: 4.8, windup: 0.5, recover: 0.45, cooldown: 1.4, minLevel: 11, dash: 17, dashDur: 0.28 }),
  // a matagi hunter: keeps his distance, lays bear traps behind him as he backs off, and fires a long-range rifle
  // (a thin aim line that locks lockBefore s before the shot)
  hunter:      B({ name: 'Matagi Hunter',      behavior: 'hunter',  hp: 44, dmg: 22, speed: 2.3, r: 0.33, cost: 3, range: 11,  windup: 1.15, recover: 0.7, cooldown: 2.8, minLevel: 13, trapDmg: 12, trapStun: 1.0, maxTraps: 3 }),
  // ---- Training mode: a straw dummy that never attacks, never dies, and heals up when left alone
  dummy:       B({ name: 'Training Dummy',     behavior: 'dummy',   hp: 600, dmg: 0,  speed: 0,   r: 0.42, cost: 99, range: 0, windup: 1, minLevel: 99, resetAfter: 3 }),
  // ---- Libraries: wise enemies (scholars and sages that fight with spells)
  scholar:     B({ name: 'Scroll Scholar',     behavior: 'caster',  hp: 32,  dmg: 12, speed: 1.6, r: 0.33, cost: 2, range: 6.5,   windup: 0.8,  recover: 0.6,  cooldown: 3.0,  minLevel: 1, proj: 'orb', maxProj: 1 }),
  sage:        B({ name: 'Ink Sage',           behavior: 'caster',  hp: 40,  dmg: 14, speed: 1.5, r: 0.34, cost: 3, range: 10,   windup: 0.75, recover: 0.6,  cooldown: 2.6,  minLevel: 1, proj: 'soul', maxProj: 2 }),
};

export const BOSSES = {
  10: { type: 'ronin_boss', name: 'Ronin Warlord Kurogane', jp: '黒鉄', title: 'The Iron Ronin', hp: 1377, r: 0.55 }, // (-15% on 2026-11-21: was 1620)
  20: { type: 'tengu',      name: 'Tengu of the Red Peak',  jp: '天狗', title: 'Lord of the Mountain Winds', hp: 3300, r: 0.6 },
  30: { type: 'oni_lord',   name: 'Oni Lord Shuten',        jp: '酒呑', title: 'Gate Guardian of the Kagerō', hp: 8400, r: 1.0 },
  33: { type: 'gensai',     name: 'Regent Gensai',          jp: '玄斎', title: 'Usurper of the Kagerō', hp: 10500, r: 0.5, hall: true },
};
// Boss hit damage (already +20% over the original tuning; the Tengu hits ~75% harder than before).
export const BOSS_DMG = {
  ronin_boss: { sweep: 22, dash: 17, whirl: 40 }, // (whirl, the great charged circle: 40 since 2026-11-21, was 46)
  tengu: { feather: 14, gust: 18, dive: 42 },
  oni_lord: { slam: 36, stomp: 24, wave: 22, charge: 31, fire: 7 },
  gensai: { iai: 38, crescent: 20, seal: 26, mirage: 24, slash: 22 },
};
// Co-op scaling (2 players)
export const COOP_BOSS_HP = 2;
// (2026-11-19: co-op brings fewer enemies, each tougher; solo enemies +10% health)
export const COOP_ENEMY_COUNT = 1.4;
export const COOP_ENEMY_HP = 1.35;
export const SOLO_ENEMY_HP = 1.1;
export const COOP_ENEMY_DMG = 1.1;

// Each biome uses only its own enemies.
// archers' pick weight in levels 1..until (instead of the usual 0.6 for an enemy new to these levels)
export const EARLY_ARCHER = { mul: 0.55, until: 3 };
// archers (Yumi, Frost) are picked this much less often: area 1 most (2026-11-21)
export const ARCHER_WEIGHT = [0.8, 0.9, 0.9, 0.9]; // (about a third of level 1's enemies are archers)
export const BIOME_POOLS = [
  ['bandit', 'spear', 'archer', 'assassin', 'bomber', 'sumo', 'samurai', 'tate', 'ironguard', 'banner'],
  ['kappa', 'kamaitachi', 'karasu', 'kitsune', 'tanuki', 'yamabushi', 'boar', 'komainu', 'shellguard', 'barkwarden', 'tsubame', 'hunter'],
  ['skeleton', 'ghostspear', 'frostarcher', 'yukionna', 'imp', 'wisp', 'oni', 'gashadokuro', 'frostoni', 'boneshield', 'glacier'],
  ['kgsoldier', 'kgspear', 'kgsentry', 'kgshinobi', 'kgshield', 'kgwall', 'kgmonk', 'kgchampion'],
];
// special level enemies: training halls fight only martial artists; libraries mix wise casters into the area's pool
export const DOJO_POOL = ['karateka', 'kenshi', 'bojutsu', 'naginata', 'shurikenka', 'sensei', 'sumo'];
export const LIBRARY_POOL = ['scholar', 'sage'];
export const LIBRARY_COUNT = 0.85; // a library level brings this share of the normal enemy budget
export const LIBRARY_WISE_WEIGHT = 1.8; // pick weight of the wise casters next to the area's own enemies
// the regent's guard: what Gensai summons in his hall
export const GENSAI_GUARD = ['kgsoldier', 'kgsoldier', 'kgspear', 'kgsentry', 'kgshinobi', 'kgshield', 'kgwall'];
// The Banner Bearer's circle: radius (tiles); enemies inside deal dmgMul damage, move speedMul faster and ready their
// attacks atkMul faster. At most one bearer per level.
export const BANNER = { radius: 3.6, dmgMul: 1.2, speedMul: 1.15, atkMul: 1.2, retarget: 0.4, keepAway: 3.2 };
// Perfect dodge: a dash started while you stand inside an enemy attack that lands within `window` s (its telegraph or a
// ground blast about to go off) slows time to `scale` for `dur` real seconds
// an enemy projectile hurts when the player's CENTRE comes within its r + PROJ_HIT_PAD; every projectile telegraph
// lane is drawn exactly that wide (laneW in behaviors.js / extras.js) and exactly as long as the shot flies
export const PROJ_HIT_PAD = 0.14;
export const laneW = (r) => 2 * (r + PROJ_HIT_PAD);
// archers' arrows (Yumi Archer, Frost Archer): a thin lane as wide as the arrow, and they hit only that close
// (the player's centre within ARROW_HALF of the arrow's line; projectiles carry it as hitR)
export const ARROW_HALF = 0.12;
export const PERFECT_DODGE = { window: 0.25, dur: 0.28, scale: 0.25 }; // (window 0.25 s since 2026-11-21: easier, was 0.15)
// Heavy (big tanky) enemies are rarer: lower pick weight and a per-level cap.
export const HEAVY_WEIGHT = 0.55;
export const heavyCap = (level, coop) => Math.round((1 + Math.floor((((level - 1) % 10) + 2) / 4)) * (coop ? COOP_ENEMY_COUNT : 1));
// shield-bearers (pavise, iron, bark, ice...): at most this many per level, the same growth as heavies
export const shieldCapFor = (level, coop) => Math.round((1 + Math.floor((((level - 1) % 10) + 2) / 4)) * (coop ? COOP_ENEMY_COUNT : 1));
export const SHIELD_WEIGHT = 0.8;     // how often shield-bearers are picked compared with plain enemies
export const SPAWN_REPEAT = 0.55;     // each heavy / shield-bearer already in the level multiplies the next one's odds by this
export const SPAWN_GUARANTEE = { shield: 2, heavy: 4 };
export const EARLY_TOUGH = 1.35;      // levels 1-4 of an area: heavies and shield-bearers are picked this much more often // from this level of each area, every level has at least one
// Shields block 80% of frontal hits until broken by 3 blocked melee hits or a burst of damage.
export const SHIELD = { block: 0.8, arc: Math.PI * 2 / 3, meleeHits: 3, burstFrac: 0.35, burstWindow: 1.5, breakStun: 0.8 };
export const PLAYER_STUN = 0.45;
// Sumo Brute moves: belly charge (speed x dur tiles, its red lane is exactly that long, width wide; hits for
// chargeMul x damage), then a stomp inside a circle of stompR after stompWindup seconds
export const SUMO = { speed: 10, dur: 0.6, width: 2.1, chargeMul: 0.9, stompR: 3.0, stompWindup: 0.8 };

// enemy HP: +5% per level through area 1, then +6% per level (bosses have fixed health)
export const levelScale = (level) => (level <= 10 ? 1 + 0.05 * (level - 1) : 1.45 + 0.06 * (level - 10));
// Enemy damage grows much slower than HP: player max HP is 70 (only sacrifices change it).
// ...plus a step per area (areas 1-4), so every new area also hits a bit harder
export const AREA_DMG = [0.8, 0.95, 1.07, 1.25]; // (area 3 was 1.15)
// Attack windups (the telegraphed charge before a strike) last this much longer per area (areas 1-4):
// area 1 enemies charge slower so their attacks are easier to read. Bosses are not affected.
export const AREA_WINDUP = [1.35, 1, 1, 1];
export const levelDamageScale = (level) => (1 + 0.03 * (level - 1)) * AREA_DMG[level > 30 ? 3 : Math.floor((level - 1) / 10)];
// Enemy count multiplier: area 1 ramps from 1x (level 1) to 2x (level 9);
// later areas stay at 1.5x so there's no sudden drop when the area changes.
export const enemyCountMul = (level) => (level <= 10 ? 1.35 + 0.65 * (Math.min(level, 6) - 1) / 5 : level <= 20 ? 1.2 + 0.12 * Math.min(level - 11, 3) / 3 : level > 30 ? 1.8 : level <= 23 ? 1.72 : 1.65);
// ENEMY_COUNT: every level brings this many times more enemies (2026-11-19: x1.4, waves got bigger too)
export const ENEMY_COUNT = 1.3;
export const levelBudget = (level) => (6 + 2.3 * level) * enemyCountMul(level) * ENEMY_COUNT;

// ---- Upgrades ----
export const RARITIES = [
  { key: 'common',    name: 'Common',    jp: '並', weight: 50, color: '#cfc6b2', glow: '#a8a090' },
  { key: 'rare',      name: 'Rare',      jp: '稀', weight: 30, color: '#5fb2ff', glow: '#3a8cff' },
  { key: 'epic',      name: 'Epic',      jp: '極', weight: 15, color: '#c77dff', glow: '#9b4dff' },
  { key: 'legendary', name: 'Legendary', jp: '伝説', weight: 5, color: '#ffd45e', glow: '#ffb020' },
];

// Stat upgrades. values per rarity [common, rare, epic, legendary]
export const UPGRADES = {
  critChance:   { name: 'Crit Chance',   jp: '会心', values: [0.08, 0.14, 0.25, 0.35], fmt: 'pct',  cap: 1, overflow: 'critDamage' }, // (crit chance past 100% becomes crit damage, 1 for 1)
  critDamage:   { name: 'Crit Damage',   jp: '痛撃', values: [0.20, 0.40, 0.70, 1.00], fmt: 'pctPlus' },
  baseDamage:   { name: 'Attack Damage',   jp: '剛力', values: [0.06, 0.115, 0.15, 0.25], fmt: 'pct' },
  healthRegen:  { name: 'Health Regen',  jp: '癒',   values: [0.12, 0.23, 0.35, 0.6],   fmt: 'perSec2', offer: false }, // (no card since 2026-11-21)
  moveSpeed:    { name: 'Move Speed',    jp: '軽身', values: [0.06, 0.09, 0.13, 0.20], fmt: 'pct', cap: 1.7 },
  // multiplicative: new dash cooldown = dash cooldown x (1 - value) (2026-11-20: replaces the Cooldown card; the dash never drops under its 1 s minimum)
  dashCd:       { name: 'Dash Cooldown', jp: '迅歩', values: [0.10, 0.20, 0.33, 0.55], fmt: 'mulPct', mult: true, min: 0.25 },
  // multiplicative: ki cost of special attacks x (1 - value), down to 40%
  // multiplicative: every attack cooldown x (1 - value), down to 35% (2026-11-21: replaces the Wind imbuement, a little lower)
  cooldownMul:  { name: 'Attack Cooldown', jp: '迅撃', values: [0.06, 0.10, 0.17, 0.25], fmt: 'mulPct', mult: true, min: 0.35 },
  kiCost:       { name: 'Energy Cost',      jp: '気節', values: [0.10, 0.15, 0.24, 0.37], fmt: 'mulPct', mult: true, min: 0.4 },
  // conditional cards (2026-11-21, user's numbers)
  highHpDmg:     { name: 'Unscathed Might', jp: '無傷', values: [0.10, 0.16, 0.25, 0.35], fmt: 'pct' },
  idleEnergy:    { name: 'Still Breath',    jp: '静息', values: [0.40, 0.70, 1.00, 1.60], fmt: 'pct' },
  levelDmg:      { name: 'Seasoned',        jp: '歴戦', values: [0.01, 0.015, 0.025, 0.04], fmt: 'pct1' },
  perfectEnergy: { name: 'Perfect Focus',   jp: '見切', values: [15, 33, 50, 80], fmt: 'flat' },
  dodgeEnergy:   { name: 'Shadow Passage',  jp: '影抜', values: [3, 5, 9, 15], fmt: 'flat' },
  openStrike:    { name: 'Opening Strike',    jp: '先手', values: [0.10, 0.15, 0.25, 0.40], fmt: 'pct' },
  lowHpSpeed:    { name: 'Cornered Fox',      jp: '窮狐', values: [0.15, 0.22, 0.33, 0.50], fmt: 'pct' },
  energyHeal:    { name: 'Energetic Healing', jp: '気癒', values: [1 / 25, 1 / 18, 1 / 10, 1 / 5], fmt: 'perEnergy' }, // (1 health per 25 / 18 / 10 / 5 energy spent)
  afterCrit:     { name: 'Afterimage',        jp: '残像', values: [0.25, 0.40, 0.65, 1.00], fmt: 'pct' },
  highEnergyDmg: { name: 'Energetic Balance', jp: '気衡', values: [0.10, 0.15, 0.22, 0.32], fmt: 'pct' },
};
export const OPEN_STRIKE_HP = 0.8; // Opening Strike: its bonus counts against enemies above this share of their health
export const LOW_HP = 0.35;       // Cornered Fox: its speed counts below this share of max health
export const AFTERIMAGE_T = 1;    // Afterimage: seconds after a dash during which every hit gets the crit bonus
export const HIGH_ENERGY = 50;    // Energetic Balance: its damage counts above this much energy
// dojo (training hall) and library levels: every enemy there has this share of its health (2026-11-21: -20%)
export const KIND_HP = { dojo: 0.8, library: 0.8 };
export const HIGH_HP = 0.75;      // Unscathed Might: its bonus counts at or above this share of max health
export const IDLE_ENERGY_T = 2;   // Still Breath: seconds without attacking before the energy regen bonus starts

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
// Every wave comes as one big group (stagger = seconds between its enemies) and gets its share of the heavies,
// shield-bearers and other tough enemies, so no wave is only a couple of weak ones.
// 2026-11-21: every level (not bosses) gets WAVES.extra more waves than the pacing below, each wave about
// WAVES.perWave as big as before (the level's enemy budget is topped up so the extra wave isn't just a split)
// reroll tokens every run starts with (one reroll = a new hand on a reward screen; the Tactician's Set adds 2)
export const REROLLS = 2;
// solo: lives a run starts with (the Shinobi Garb gives one more). Dying with a life to spare: you fall, a broken
// heart shows, and you rise back up into the air and land, on full health.
export const SOLO_LIVES = 1;
export const RELIFE = { lie: 1.0, rise: 0.75, hang: 0.2, drop: 0.3, height: 2.4, iframes: 2 };
export const WAVES = { extra: 1, perWave: 0.9 };
export const SPAWN_PACING = [
  { waves: 3, stagger: 0.18, timeout: 16 },
  { waves: 3, stagger: 0.2, timeout: 17 },
  { waves: 3, stagger: 0.2, timeout: 17 },
  { waves: 4, stagger: 0.2, timeout: 16 },
];
// casters (monks, priests, scholars): walk this much faster and attack more often (cooldown / windup multipliers)
export const MAGIC = { speed: 1.6, cooldown: 0.6, windup: 0.8 };
// every hit a player takes from enemies, bosses, projectiles and hazards is multiplied by this
export const ENEMY_DAMAGE_MUL = 0.75;
// admin mode: a run started past level 1 (level select / ?level=N) deals this many times the normal damage
export const ADMIN_DAMAGE = 5;
// regular enemies move this much faster than their listed speed (bosses unchanged)
export const ENEMY_SPEED_MUL = 1.18;
// Large garden pond with a bridge (areas 1-2): chance per level, size in tiles (the bridge crosses the short side).
// The bridge is 2 tiles wide and centred on a tile row/column so every body size can path over it.
// level decorations: amount = share of the listed counts; gap = extra free space (tiles) kept between two decorations
// (plus their own footprints); cluster = chance a decoration may still stand close to another one (small natural groups)
export const DECOR = { amount: 0.82, gap: 1.1, cluster: 0.12, outer: 0.95, outerGap: 1.2 };
export const POND = { chance: 0.6, long: [7, 9], short: [4, 5], bridgeHalf: 1.0 };
// heavy ("super") enemies have this share of their listed health
export const HEAVY_HP_MUL = 0.8;
// heavy enemies walk this much faster, wind up their attacks this much faster and rush through their charges this much faster
export const HEAVY_SPEED = 1.15;
// area 1: the regular (non-heavy) enemies are this much tougher
export const AREA1_HP = 1.15; // (2026-11-21: was 1.25)
// area 3 (snowy castle town, levels 21-30): every regular enemy has this share of its health (2026-11-21)
export const AREA3_HP = 0.85;
// area 1: heavy enemies (sumo, armored samurai) hit this much harder
export const AREA1_HEAVY_DMG = 1.25;
// the plain melee enemies' sweep (bandits, skeletons, Kagero soldiers, dojo fighters): reach and damage multipliers
export const SWEEP = { range: 1.2, dmg: 1.12 };

// Route map between levels: each path shows the reward you get after that level.
// Weights for the reward of a route node; sacrifice chance ramps up through the area to ROUTE.sacMax,
// and every area has at least sacMin and at most sacPerArea sacrifice nodes on its map.
export const ROUTE = {
  options: { stat: 3, element: 2, talent: 2, item: 3, art: 2 },
};
// What a route node can be, per part of an area (the player never sees these parts). Level 1 of areas 1-3 is
// always a town; then sections and intersections alternate: section = levels 2, 4-5, 7-8; intersection = 3, 6, 9;
// area 4 = levels 31-32. stat = core (town), element = imbuement, item = consumable (tea house), art = technique.
export const ROUTE_ODDS = {
  section: { stat: 40, talent: 15, element: 20, item: 15, sacrifice: 5, art: 5 },
  inter:   { sacrifice: 37.5, art: 37.5, element: 7.5, item: 7.5, talent: 5, stat: 5 },
  area4:   { sacrifice: 25, art: 25, element: 15, item: 15, talent: 10, stat: 10 },
};
// Shifting odds for sacrifices and techniques: choosing one multiplies its weight by drop; every route choice
// that isn't one multiplies it by rise (kept between min and max). The other kinds share the rest pro rata.
export const ROUTE_SHIFT = { keys: ['sacrifice', 'art'], drop: 0.7, rise: 1.08, min: 0.45, max: 1.6 };

// ---- Route node indicators ----
// Every fight node rolls a difficulty before the player chooses: fewer/softer enemies on Easy, more,
// harder-hitting and more heavies on Hard. count = enemy budget, heavyW / shieldW = heavy / shield pick weight,
// heavyCap / shieldCap = change to the per-level caps (an Easy level 1-2 of an area has none),
// heavyCap = change to the per-level heavy cap, dmg = enemy damage.
export const DIFFICULTY = [
  // (2026-11-21: Easy and Hard pulled further from Normal; shields now have their own weight and cap change)
  { key: 'easy',      name: 'Easy',      count: 0.8,  heavyW: 0.55, shieldW: 0.6, heavyCap: -1, shieldCap: -1, dmg: 0.85 },
  { key: 'normal',    name: 'Normal',    count: 1.04, heavyW: 1.15, shieldW: 1,   heavyCap: 0,  shieldCap: 0,  dmg: 1.0 },
  { key: 'hard',      name: 'Hard',      count: 1.3,  heavyW: 1.8,  shieldW: 1.5, heavyCap: 1,  shieldCap: 1,  dmg: 1.2 },
];
export const DIFFICULTY_ODDS = [0.25, 0.5, 0.25];
// the run's difficulty, chosen after the equipment (2026-11-21, the user's numbers: same enemy count; health ∓10%, damage ∓20%): enemy count, their max health,
// the damage they deal. Normal is the game as it was.
export const RUN_DIFF_ORDER = ['easy', 'normal', 'hard'];
export const RUN_DIFFICULTY = {
  // nodeOdds: how often route nodes are easy / normal / hard; rewardMul: weights on the reward tiers (common..legendary)
  easy:   { name: 'Easy',   jp: '易', color: '#3f7a4a', count: 1, hp: 0.90, dmg: 0.80, nodeOdds: [0.35, 0.5, 0.15], rewardMul: [0.72, 1, 1.4, 1.55], lines: ['−10% enemy health', '−20% enemy damage', 'Easier paths, better rewards'] },
  normal: { name: 'Normal', jp: '常', color: '#8a6a2a', count: 1,    hp: 1,    dmg: 1,    nodeOdds: null, rewardMul: null, lines: ['The path as it is'] },
  hard:   { name: 'Hard',   jp: '難', color: '#9a2226', count: 1, hp: 1.10, dmg: 1.20, nodeOdds: [0.15, 0.5, 0.35], rewardMul: [0.8, 1, 1.25, 1.4], lines: ['+10% enemy health', '+20% enemy damage', 'Harder paths, better rewards'] },
};
// Nodes whose cards roll a rarity also roll a reward tier [common+, rare+, epic+, legendary]. Harder fights lean a little
// toward better rewards, but not by much: an easy fight can still pay well, a hard one can pay badly.
export const REWARD_ODDS = [
  [0.5, 0.4, 0.08, 0.02], // easy
  [0.35, 0.45, 0.16, 0.04], // normal
  [0.2, 0.4, 0.32, 0.08], // hard
];
// mul = multiplier on the rarity weights [common, rare, epic, legendary]; min = rarity at least one card has
export const REWARD_TIERS = [
  { key: 'common',    name: 'Common+',   mul: [1.3, 1.1, 1, 1],   min: 0 },
  { key: 'rare',      name: 'Rare+',     mul: [1, 1.3, 1.3, 1.3], min: 1 },
  { key: 'epic',      name: 'Epic+',     mul: [1, 1.5, 2, 2.5],   min: 2 },
  { key: 'legendary', name: 'Legendary', mul: [1, 1.5, 2, 3],     min: 3 },
];

// Consumable item cards (amount by rarity):
//  heal: restores health right away (only offered when hurt)
//  energy: restores ki right away (only offered when not full)
//  rush: +x% damage for the first 30 seconds of the next level
export const FULL_HEAL = 9999; // (a heal card of this value fills your health up completely)
export const HEAL_CARD = { name: 'Herbal Tea', jp: '治癒', values: [20, 33, 45, FULL_HEAL], color: '#ff7a8a' };
export const ITEM_CARDS = {
  heal: HEAL_CARD,
  energy: { name: 'Energy Tonic', jp: '気薬', values: [45, 60, 85, 100], color: '#4fc8dc' },
  rush: { name: 'Rice Wine', jp: '戦勢', values: [0.10, 0.15, 0.25, 0.40], color: '#ff8a3c', dur: 30 },
  // trade one of your cards in for this much attack damage
  brew: { name: 'Bitter Brew', jp: '苦茶', values: [0.07, 0.10, 0.15, 0.25], color: '#8a6a3a' },
  // the next unknown route (the follow-up paths first revealed on the next map) is guaranteed: 0 at most Normal danger, 1 at least Rare+ rewards, 2 at least Epic+ rewards, 3 Epic+ rewards and Easy
  map: { name: "Smuggler's Map", jp: '密図', values: [0, 1, 2, 3], color: '#c8a050' },
  // no corrupted levels for this many levels (common .. legendary)
  holy: { name: 'Holy Water', jp: '聖水', values: [3, 5, 8, 13], color: '#7fd0f0' },
};
// Corrupted nodes (corruption.js): the chance a chosen node turns out corrupted, per area [1, 2, 3, 4]
// (area 1 only from level area1From of the area on; never tea houses, training halls or bosses), and the kinds.
export const CORRUPTION = {
  chance: [0.12, 0.18, 0.28, 0.40], area1From: 4, // (raised 2026-11-21: was 7/8/10/10%)
  weights: { mist: 1, storm: 1, bloodmoon: 1 },
  mist: { tilesPerCloud: 22, thick: 0.6 }, // one drifting cloud per this many tiles of arena; this share are thick (no sight through)
  // lightning: every 3.5-6 s near a random player (direct: share that aims right at them, else within spread tiles),
  // a red warning for warn s, then it hits everyone within radius tiles
  // each lightning comes as a burst of burst[0]..burst[1] strikes, gap s apart, each hopping a little further on
  storm: { firstDelay: 4, every: [4.5, 7], burst: [2, 4], gap: [0.28, 0.45], warn: 1.0, radius: 0.95, direct: 0.4, spread: 1.8, hop: [0.9, 1.8], playerDmg: 36, enemyDmg: 80, sheet: [3.5, 8] },
  bloodmoon: { dmgMul: 1.25, dark: 'rgba(12,4,18,0.7)' }, // dark: the night it brings (no sun, so no shadows)
};
// Pickups dropped by enemies: normal / heavy ("super") / boss drop chances
export const DROPS = {
  heal: 10, energy: 15,
  normal: { heal: 0.03, energy: 0.08 },
  heavy: { either: true }, // always drops one: heal or ki, 50/50
  boss: { heal: 1, energy: 0 },
};

// Element upgrades: applied to your weapon; repeated picks stack, and a weapon can carry several elements at once.
export const ELEMENTS = {
  // (retuned 2026-11-19 after the combat sim: lightning was 1/2/3/5 chains at 20-30%, poison a flat 2/4/6/12 damage per second)
  lightning: { name: 'Lightning', jp: '雷', values: [1, 2, 3, 4],        fmt: 'chains', color: '#ffe46a', desc: 'Hits chain to nearby enemies; bigger hits chain harder' },
  // poison: this share of every hit's damage is dealt again as poison over the next 3 s (more hits fill the same poison)
  poison:    { name: 'Poison',    jp: '毒', values: [0.1, 0.17, 0.25, 0.4], fmt: 'pct', color: '#8fe05a', desc: 'A share of the damage comes again as poison over 3s; stronger in groups', cap: 0.8 },
  // syphon has diminishing returns: each card adds value x (1 - current / cap), so the 25% cap is only approached
  syphon:    { name: 'Syphon',    jp: '吸', values: [0.01, 0.023, 0.036, 0.05], fmt: 'pct1', color: '#ff6b8a', desc: 'Heals you for a share of the damage this weapon deals', cap: 0.25, diminish: true },
  // arcane: a share of the damage this weapon deals comes back as energy (fractions carry over)
  arcane:    { name: 'Arcane',    jp: '魔', values: [0.04, 0.08, 0.14, 0.2], fmt: 'pct', color: '#5aa8ff', desc: 'Damage dealt with this weapon restores energy', cap: 0.6 },
  ice:       { name: 'Ice',       jp: '氷', values: [0.07, 0.12, 0.25, 0.40], fmt: 'slow',  color: '#9ee4ff', desc: 'Hits slow enemy movement and attacks for 2s', cap: 0.7 },
  // burn (2026-11-21): a hit sets the ground under the enemy on fire for burnDur s; this share of the hit burns every
  // enemy standing in it, spread over its ticks (another hit on the same enemy feeds the same fire)
  burn:      { name: 'Burn',      jp: '炎', values: [0.12, 0.20, 0.32, 0.50], fmt: 'pct', color: '#ff8a3a', desc: 'Hits set the ground under the enemy on fire, burning everyone in it', cap: 0.8 },
};
// every hit rolls a little luck: ±12% of its damage, and at least ±1
export const DAMAGE_SPREAD = 0.12;
// lightning: each chained hit deals this share of the hit (1 chain: 8%, 2-3: 10%, 4+ (legendary): 12%), and more for a
// big hit: x(1 + hit/20), at most x2 (a 20+ hit chains for double). Nerfed 2026-11-20: was a flat 15/19/24%.
export const chainDamageFor = (chains, hit = 0) => (chains >= 4 ? 0.12 : chains >= 2 ? 0.10 : 0.08) * (1 + Math.min(1, hit / 20));
export const ELEMENT_RULES = { chainRange: 3.5, chainDamage: 0.35, poisonDur: 3, poisonTick: 0.5, slowDur: 2, burnDur: 1.5, burnTick: 0.5, burnRadius: 1.3 };
// poison spreads like a plague: a hit's poison share x (base + per x other poisoned enemies within range, at most max of them)
// (a lone enemy gets 0.65x, a group of four 1.25x)
export const POISON_GROUP = { base: 0.65, per: 0.2, max: 3, range: 3 };

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
  // cd: one cooldown for every rarity (a higher rarity only makes the talent stronger, not faster);
  // every other number is per rarity [common, rare, epic, legendary]
  // arrow rain (2026-11-21): total damage dealt over dur s (5 s since the user asked) to every enemy in a large area, in even ticks (same totals as before: 6/10/16/22 x 15)
  arrowRain: { name: 'Arrow Rain',        jp: '矢雨', cd: 24, desc: 'Arrows rain on a large area for {dur}s', radius: 4.2, dur: 5.0, tick: 0.25, total: [90, 150, 240, 330], targeted: true },
  meditate:  { name: 'Meditate',          jp: '瞑想', cd: 32, desc: 'Restores energy', coopDesc: ' (your partner gets some)', energy: [35, 55, 80, 999], partner: [15, 25, 35, 50] },
  vitalize:  { name: 'Vitalize',          jp: '活力', cd: 46, desc: 'Restores health', coopDesc: ' (your partner gets some)', heal: [10, 17, 28, 40], partner: [6, 10, 15, 24] },
  // shadows: each clone hit = share x your weapon's basic damage per second (ref, before your bonuses) x interval, then
  // your damage bonuses (attack damage, rage, rush, crits) on top; so the clones grow with your weapon and cards
  shadows:   { name: 'Master of Shadows', jp: '影分身', cd: 40, desc: 'Spawn shadows to fight for you', count: [3, 4, 6, 9], dur: 8, interval: 0.55, share: 0.55,
    ref: { katanas: 13, knives: 12, bo: 13, gloves: 15, orb: 10, crossbow: 9, heavy: 13, staff: 7, shield: 7 } },
  // wisdom (2026-11-21, the user's design): for dur s every attack and dash cooldown runs out faster and attacks cost less energy
  wisdom:    { name: 'Wisdom',            jp: '智慧', cd: 40, desc: 'Less cooldown and energy cost for {dur}s', dur: 6, cut: [0.25, 0.35, 0.60, 0.85] },
  // the user's designs (2026-11-21): a smoke cloud you vanish in (enemies lose you, their attacks miss, your hits inside it hurt more),
  // a storm that strengthens every imbuement, and a wind that makes the dash recharge almost at once
  smokeBomb: { name: 'Smoke Bomb',        jp: '煙玉', cd: 28, desc: 'Enemies lose you in smoke for {dur}s', dur: 4, radius: 2.6, bonus: [0.10, 0.15, 0.25, 0.40] },
  elemStorm: { name: 'Elemental Storm',   jp: '元素嵐', cd: 36, desc: 'Your imbuements grow stronger for {dur}s', dur: 5, bonus: [0.30, 0.50, 0.80, 1.20] },
  windStep:  { name: 'Wind Step',         jp: '風歩', cd: 26, desc: 'Your dash recharges almost at once', durs: [3, 4, 7, 10], cut: 0.95 },
  rage:      { name: 'Rage',              jp: '激怒', cd: 44, desc: 'Become enraged for {dur}s', dur: 5, mult: [1.3, 1.5, 1.9, 2.5], atkCd: [0.13, 0.17, 0.23, 0.29] }, // (atkCd: attack cooldowns x (1 - atkCd) while raging; was +15/20/30/40% attack speed, the same thing) // (nerfed 2026-11-19: was 6 s, 1.5-3.5x, cd 40-28)
};
