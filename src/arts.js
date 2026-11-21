// Weapon arts: route rewards that change how a weapon works. Every weapon has three art slots:
// 'basic' (its basic attack), 'secondary' (its secondary) and 'special' (its special). Each slot has two arts
// that exclude each other, so a weapon carries at most one art per slot. (No passive techniques since 2026-11-20.)
// A Weapon Art route node offers one card per weapon you carry, for a slot that weapon still has free.
// The numbers live here; player.js / enemies.js / game.js check them with player.art(w, key).
// Every description that changes damage says what it comes to (hits x damage, and the normal attack's
// numbers to compare), worked out from the weapon numbers in config.js so the text never drifts.
import { WEAPONS } from './config.js';

export const ART_SLOTS = { basic: { name: 'Basic technique', jp: '基' }, secondary: { name: 'Secondary technique', jp: '副' }, special: { name: 'Special technique', jp: '技' }, unique: { name: 'Passive technique', jp: '極' } }; // ('unique' kept only so old saves still read)

const r = (v) => Math.round(v);
// damage that grows with the player's Attack Damage: written {d:N} in a text, drawn as a white number (cards.js)
const d = (v) => `{d:${+v.toFixed(2)}}`;
const GL = WEAPONS.gloves;
const K = WEAPONS.katanas, C = WEAPONS.crossbow, H = WEAPONS.heavy, N = WEAPONS.knives, S = WEAPONS.staff, B = WEAPONS.bo, SH = WEAPONS.shield, OR = WEAPONS.orb;
const whirl = K.secondary.ticks * K.secondary.dmg; // 5 x 7 (Whirlwind is the secondary now)
const heavyFull = H.secondary.dmg * (1 + H.secondary.chargeDmg); // (the charged cleave is the secondary now)
const flurry = B.special.strikes * B.special.dmg;

export const ARTS = {
  katanas: {
    flowingStep:   { slot: 'basic', name: 'Flowing Step', jp: '流歩', text: 'Basic kills restore 10 energy', desc: 'Killing enemies with {X} grants 10 {energy}', ki: 10 },
    crossedBlades: { slot: 'basic', name: 'Crossed Blades', jp: '十字斬', text: 'Blade-tip hits +25% damage', desc: '+25% {damage} at blade-tip with {X}', tipMul: 1.25 },
    stormDancer:   { slot: 'secondary', name: 'Storm Dancer', jp: '嵐舞', text: 'Wider whirlwind that pulls enemies in', desc: '{Y} has +40% range and pulls enemies inside it towards you', durMul: 1, tickMul: 1.0, radiusMul: 1.4, pull: 22, pullRange: 0 }, // (pullRange 0 since 2026-11-21: only enemies in the whirlwind's own area are pulled, was +4.5 tiles beyond it)
    singleGale:    { slot: 'secondary', name: 'Single Gale', jp: '一颯', text: `Whirlwind: one ${d(whirl * 1.25)} damage cut`, desc: '{Y}: +25% {damage} in fewer cuts', dmgMul: 1.25, radiusMul: 1.15 },
  },
  crossbow: {
    // (key kept as steadyHands so saved picks still work; it is Twin Bolts now)
    steadyHands:   { slot: 'basic', name: 'Twin Bolts', jp: '双矢', text: 'Basic shoots 2 bolts at once', desc: `Every basic shot looses two bolts side by side, ${d(C.basic.dmg)} damage each`, count: 2, gap: 0.24 },
    snapShot:      { slot: 'basic', name: 'Snap Shot', jp: '速射', text: `−30% range, ${d(C.basic.dmg)} → ${d(19)} dmg`, desc: `Bolts fly 30% shorter but deal ${d(19)} instead of ${d(C.basic.dmg)} damage`, rangeMul: 0.7, dmgMul: 19 / C.basic.dmg },
    volley:        { slot: 'special', name: 'Volley', jp: '連弩', text: 'Special fires 3 bolts', desc: `Three piercing bolts in a fan, each a full ${d(C.special.dmg)} damage bolt (normal: 1 bolt)`, count: 3, spread: 11, dmgMul: 1 },
    harpoon:       { slot: 'special', name: 'Harpoon Shot', jp: '銛', text: 'Pins enemies for 3 s', desc: 'Every enemy the bolt pierces is pinned in place for 3 s (bosses are slowed)', dur: 3, bossSlow: 0.5 },
  },
  heavy: {
    quickCharge:   { slot: 'secondary', name: 'Quick Charge', jp: '迅溜', text: 'Charges 45% faster', desc: 'The cleave is fully charged much sooner (same damage)', chargeMul: 0.55 },
    deepCharge:    { slot: 'secondary', name: 'Deep Charge', jp: '深溜', text: 'Slower charge, +60% damage', desc: `Slower charge, +60% {damage}: full charge ${d(heavyFull)} → ${d(heavyFull * 1.6)}`, chargeMul: 1.5, dmgMul: 1.6 },
    faultLine:     { slot: 'special', name: 'Fault Line', jp: '地割', text: 'Slam sends a shockwave forward', desc: `The landing also splits the ground ahead: +${d(H.special.dmg * 0.95)} damage in a line (slam: ${d(H.special.dmg)})`, len: 6, width: 0.9, dmgMul: 0.95 },
    ironBody:      { slot: 'special', name: 'Iron Body', jp: '鉄身', text: 'Slam: no damage for 1.5 s', desc: 'Nothing can hurt you for a moment after you leap', dur: 1.5 },
  },
  knives: {
    ricochet:      { slot: 'basic', name: 'Ricochet', jp: '跳刃', text: 'Basic blades bounce to 1 more', desc: '{X} blade hits leap to 1 more enemy', bounces: 1, range: 4 },
    thirdCrit:     { slot: 'basic', name: 'Third Strike', jp: '三ノ刃', text: 'Every 3rd hit crits', desc: 'Every third hit with {X} is a crit' },
    fanStorm:      { slot: 'secondary', name: 'Fan Storm', jp: '扇嵐', text: 'Wider fan, 13 blades', desc: `Makes {Y} ${r((115 / N.secondary.spread - 1) * 100)}% wider, and increases blades thrown ${N.secondary.count} -> 13`, count: 13, spread: 115, lifeMul: 1.25 },
    swiftStorm:    { slot: 'special', name: 'Gale of Blades', jp: '疾刃', text: 'A longer storm', desc: '{B} lasts 50% longer', durMul: 1.5 }, // (2026-11-21: was faster blades that pushed back)
    longStorm:     { slot: 'special', name: 'Stilled Moment', jp: '止刻', text: 'Blade Storm lasts twice as long', desc: '{B} duration increased by +100%', durMul: 2 },
    fanBounce:     { slot: 'secondary', name: 'Ricochet Fan', jp: '跳扇', text: 'Fan blades bounce to 1 more', desc: '{Y} blade hits leap to 1 more enemy', bounces: 1, range: 4 },
  },
  staff: {
    wideBurst:     { slot: 'basic', name: 'Wide Blessing', jp: '広祓', text: '+40% burst area', desc: 'The spirit burst covers a much wider area', radiusMul: 1.4 },
    sacredPool:    { slot: 'basic', name: 'Sacred Pool', jp: '聖泉', text: 'Bursts leave a pool for 3 s', desc: `A holy pool stays behind: ${d(S.basic.dmg * 0.16)} damage every 0.5 s for 3 s (+${d(S.basic.dmg * 0.16 * 6)} per burst)`, dur: 3, tick: 0.5, dmgMul: 0.16 },
    lifeSpring:    { slot: 'special', name: 'Life Spring', jp: '命泉', text: 'Heal zone: 2x healing, wider', desc: `The heal becomes a 40% wider zone that heals 2x as much over 3 s (${S.special.heal * 2} instead of ${S.special.heal})`, dur: 3, tick: 0.5, mul: 2, radiusMul: 1.4 },
    sanctuary:     { slot: 'special', name: 'Sanctuary', jp: '聖域', text: 'Wider heal that slows enemies', desc: 'A larger healing circle that also slows enemies inside it', radiusMul: 1.5, slow: 0.5, slowDur: 3 },
  },
  bo: {
    peakForm:      { slot: 'basic', name: 'Peak Form', jp: '極型', text: 'Max combo: 1.5x damage', desc: `At full combo (5): +50% {damage}, ${d(B.basic.dmg)} → ${d(B.basic.dmg * 1.5)}`, dmgMul: 1.5 },
    longReach:     { slot: 'basic', name: 'Long Reach', jp: '長棒', text: '+10% range per combo level', desc: 'Each combo level increases attack range by +10% (max 50%)', per: 0.1, max: 0.5 },
    flowState:     { slot: 'secondary', name: 'Flow State', jp: '流転', text: 'Vault landing: max combo', desc: 'Landing from {Y} instantly sets combo to 5' },
    vaultStrike:   { slot: 'secondary', name: 'Vaulting Strike', jp: '越撃', text: 'The vault hits enemies passed over', desc: `{Y} deals ${d(20)} damage to every enemy you vault over`, dmg: 20, radius: 0.75 },
    longFlurry:    { slot: 'special', name: 'Endless Flurry', jp: '千連', text: 'Thousand Strikes +30% longer', desc: '{B} takes 30% longer', mul: 1.3 },
    heavyFlurry:   { slot: 'special', name: 'Crushing Flurry', jp: '重連', text: 'Fewer, much heavier strikes', desc: `{B} does 6 hits instead of ${B.special.strikes}, +200% {damage} each`, strikes: 6, dmgMul: 3 },
  },
  gloves: {
    tremor:    { slot: 'basic', name: 'Tremor', jp: '震脚', text: 'Stomp reaches twice as far', desc: `{X} stomp reaches 100% further and hits for ${d(GL.basic.stompDmg + 3)} instead of ${d(GL.basic.stompDmg)} (+${r((3 / GL.basic.stompDmg) * 100)}%)`, rMul: 2, dmgAdd: 3 },
    shatter:   { slot: 'basic', name: 'Shatter', jp: '砕石', text: 'The rock splits into 4 shards', desc: `{X} punches rocks into four shards, dealing ${d(GL.basic.dmg * 0.55)} damage each`, count: 4, spread: 26, dmgMul: 0.55 },
    twinCrag:  { slot: 'secondary', name: 'Twin Rocks', jp: '双岩', text: 'Two rocks rise instead of one', desc: '{Y}: a second rock strikes the nearest enemy' },
    breakCrag: { slot: 'secondary', name: 'Breaking Rocks', jp: '破岩', text: 'Rock hits leave enemies vulnerable', desc: 'Enemies hit by {Y} become vulnerable (+20% damage taken) for 4s', vulnDur: 4, vulnMul: 1.2 },
    gather:    { slot: 'special', name: "Earth's Embrace", jp: '抱土', text: 'Locked enemies are pulled in', desc: '{B} pulls enemies inwards and groups them', pull: 0.45 },
    crush:     { slot: 'special', name: 'Crushing Stone', jp: '圧石', text: 'Locked enemies take damage', desc: `Enemies locked in by {B} take ${d(6)} damage per second`, dps: 6 },
  },
  orb: {
    wailingBurst:  { slot: 'basic', name: 'Wailing Burst', jp: '哭散', text: 'Wisps also hit 2 nearby', desc: '{X} also hits the 2 nearest enemies', radius: 2.5, extra: 2 },
    wanderingSouls:{ slot: 'basic', name: 'Wandering Souls', jp: '漂魂', text: '3 orbs circle you and tether', desc: 'Three spirit orbs drift around you and tether enemies hit', count: 3, radius: 2.7, spin: 0.9, every: 1.2, dmgMul: 0.5 },
    farDrop:       { slot: 'secondary', name: 'Soul Hurl', jp: '遠投', text: 'Soul Drop thrown at an enemy', desc: '{Y} is thrown at an enemy instead of under you', range: 6 },
    spiritFont:    { slot: 'secondary', name: 'Spirit Font', jp: '霊泉', text: 'Spirits in the burst: heal + empower', desc: 'Spirits hit by {Y} are healed by 33% max health, and gain +33% {damage} and speed for 5s', heal: 0.33, dmgMul: 1.33, spdMul: 1.33, dur: 5 },
    twinSouls:     { slot: 'special', name: 'Twin Souls', jp: '双魂', text: 'Calls 2 spirits', desc: '{B} now raises the last two fallen, instead of one', count: 2 },
    soulBond:      { slot: 'special', name: 'Soul Bond', jp: '魂絆', text: 'Spirits heal you for 3% of their damage', desc: 'Damage done by your spirits heals you for 3% of damage dealt', heal: 0.03 },
  },
  shield: {
    charge:        { slot: 'basic', name: 'Charging Bash', jp: '突進', text: 'Longer bash dash', desc: 'The bash carries you 60% further', dashMul: 1.6 },
    mirror:        { slot: 'basic', name: 'Mirror Polish', jp: '鏡面', text: 'Deflections split into 4', desc: 'Every projectile you turn back splits into 4 at different angles, each at full damage', split: 4, spread: 0.32 },
    longGuard:     { slot: 'special', name: 'Long Guard', jp: '長守', text: 'Bulwark lasts 60% longer', desc: 'Stay behind the shield longer and store more', durMul: 1.6 },
    wideRelease:   { slot: 'special', name: 'Lion\'s Roar', jp: '獅吼', text: '+50% release range', desc: `The released shockwave reaches 50% further: ${SH.special.radius} → ${+(SH.special.radius * 1.5).toFixed(1)} tiles`, radiusMul: 1.5 },
  },
};

// Technique texts carry tokens: {X} {Y} {B} the button of the basic / secondary / special, {energy} the energy icon,
// {d:N} damage that scales with Attack Damage. artDmgMul: what a player's damage numbers are multiplied by.
export const artDmgMul = (p) => (p && p.stats ? (p.stats.baseDamage || 1) * (p.dmgMul || 1) : 1);
export const fmtDmg = (v) => { const x = Math.round(v * 10) / 10; return x >= 10 ? `${Math.round(x)}` : `${x}`; };
// a plain-text version (menus, hints): buttons by name, numbers already scaled
export function artPlain(str, p = null, pad = true) {
  const K = pad ? { X: 'X', Y: 'Y', B: 'B' } : { X: 'LMB', Y: 'RMB', B: 'Q' };
  return String(str).replace(/\{(X|Y|B)\}/g, (_, b) => K[b]).replace(/\{s:([^}]+)\}/g, '$1').replace(/\{w:([^}]+)\}/g, '$1').replace(/\{energy\}/g, 'energy').replace(/\{damage\}/g, 'damage').replace(/\{health\}/g, 'health').replace(/\{move\}/g, 'move speed').replace(/\{crit\}/g, 'crit chance').replace(/\{critdmg\}/g, 'crit damage').replace(/\{atkcd\}/g, 'attack cooldown').replace(/\{d:([\d.]+)\}/g, (_, n) => fmtDmg(+n * artDmgMul(p)));
}

// the arts a weapon could still take: one for every slot it hasn't filled yet
export function artOptions(w) {
  const A = ARTS[w.key] || {}, have = w.arts || {};
  return Object.keys(A).filter((k) => !have[A[k].slot]);
}
