// Weapon arts: route rewards that change how a weapon works. Every weapon has three art slots:
// 'basic' (its basic attack), 'special' (its special) and 'unique' (a passive). Each slot has two arts
// that exclude each other, so a weapon carries at most one art per slot (three in all).
// A Weapon Art route node offers one card per weapon you carry, for a slot that weapon still has free.
// The numbers live here; player.js / enemies.js / game.js check them with player.art(w, key).
export const ART_SLOTS = { basic: { name: 'Basic technique', jp: '基' }, special: { name: 'Special technique', jp: '技' }, unique: { name: 'Passive technique', jp: '極' } };

export const ARTS = {
  katanas: {
    flowingStep:   { slot: 'basic', name: 'Flowing Step', jp: '流歩', text: '3rd cut lunges and crits', desc: 'The third slash of a rhythm steps far in and always crits', lunge: 0.6 },
    crossedBlades: { slot: 'basic', name: 'Crossed Blades', jp: '十字斬', text: '3rd cut hits all around', desc: 'The third slash also cuts every enemy around you', radius: 2.1, dmgMul: 1.0 },
    stormDancer:   { slot: 'special', name: 'Storm Dancer', jp: '嵐舞', text: 'Longer, faster, pulls enemies', desc: 'Whirlwind lasts longer, spins faster and drags enemies in', durMul: 1.6, tickMul: 1.0, pull: 9, pullRange: 2.2 },
    singleGale:    { slot: 'special', name: 'Single Gale', jp: '一颯', text: 'Whirlwind: one heavy cut', desc: 'One great sweeping cut instead of five small ones', dmgMul: 1.6, radiusMul: 1.15 },
    endlessTempo:  { slot: 'unique', name: 'Endless Tempo', jp: '無尽', text: 'Kills refund energy and cooldowns', desc: 'Every katana kill: +6 energy, and its cooldowns drop by 40%', ki: 6, cdCut: 0.4 },
    sharpEdge:     { slot: 'unique', name: 'Sharp Edge', jp: '鋭刃', text: '+75% crit damage', desc: 'Critical hits with the katanas deal +75% extra damage', critDmg: 0.75 },
  },
  crossbow: {
    steadyHands:   { slot: 'basic', name: 'Steady Hands', jp: '静手', text: 'Full draw: +80% damage', desc: 'A fully drawn bolt deals +80% damage', dmgMul: 1.8 },
    snapShot:      { slot: 'basic', name: 'Snap Shot', jp: '速射', text: '−40% range, +45% damage', desc: 'Bolts fly 40% shorter but deal +45% damage', rangeMul: 0.6, dmgMul: 1.45 },
    volley:        { slot: 'special', name: 'Volley', jp: '連弩', text: 'Special fires 3 bolts', desc: 'Three piercing bolts in a fan instead of one', count: 3, spread: 11, dmgMul: 0.75 },
    harpoon:       { slot: 'special', name: 'Harpoon Shot', jp: '銛', text: 'Entangles enemies for 1 s', desc: 'Every enemy the bolt pierces is pinned in place (bosses are slowed)', dur: 1, bossSlow: 0.5 },
    quickReload:   { slot: 'unique', name: 'Quick Reload', jp: '早装', text: 'Dash resets its cooldowns', desc: 'Dashing reloads the crossbow: both attacks ready again' },
    huntersMark:   { slot: 'unique', name: "Hunter's Mark", jp: '標', text: 'Marked: +20% damage taken', desc: 'Bolts mark their target for 4 s; it takes +20% from everything else', dur: 4, mul: 1.2 },
  },
  heavy: {
    quickCharge:   { slot: 'basic', name: 'Quick Charge', jp: '迅溜', text: 'Charges 45% faster', desc: 'The cleave is ready to fall much sooner', chargeMul: 0.55 },
    deepCharge:    { slot: 'basic', name: 'Deep Charge', jp: '深溜', text: 'Slower charge, +60% damage', desc: 'Takes longer to charge, but every cleave hits harder', chargeMul: 1.5, dmgMul: 1.6 },
    faultLine:     { slot: 'special', name: 'Fault Line', jp: '地割', text: 'Slam sends a shockwave forward', desc: 'The landing also splits the ground in a line ahead of you', len: 6, width: 0.9, dmgMul: 0.8 },
    ironBody:      { slot: 'special', name: 'Iron Body', jp: '鉄身', text: 'Slam: no damage for 1.5 s', desc: 'Nothing can hurt you for a moment after you leap', dur: 1.5 },
    steadfast:     { slot: 'unique', name: 'Steadfast', jp: '不動', text: '−25% damage while charging', desc: 'Hold your ground: take less damage while you charge a blow', mul: 0.75 },
    berserker:     { slot: 'unique', name: 'Berserker', jp: '狂戦', text: 'Up to +200% damage at low HP', desc: 'The lower your health, the harder it hits (+200% at 10% HP)', max: 2, at: 0.1 },
  },
  knives: {
    ricochet:      { slot: 'basic', name: 'Ricochet', jp: '跳刃', text: 'Kunai bounce to 1 more enemy', desc: 'A kunai that hits leaps on to another enemy within 4 tiles', bounces: 1, range: 4 },
    thirdCrit:     { slot: 'basic', name: 'Third Strike', jp: '三ノ刃', text: 'Every 3rd kunai crits', desc: 'Every third kunai thrown is always a critical hit' },
    fanStorm:      { slot: 'special', name: 'Fan Storm', jp: '扇嵐', text: 'More kunai, wider fan', desc: 'Kunai Fan throws 11 kunai in a wider, longer spread', count: 11, spread: 115, lifeMul: 1.25 },
    fanBounce:     { slot: 'special', name: 'Ricochet Fan', jp: '跳扇', text: 'Fan kunai each bounce once', desc: 'Every kunai of the fan leaps on to one more enemy within 4 tiles', bounces: 1, range: 4 },
    nerveStrike:   { slot: 'unique', name: 'Nerve Strike', jp: '経絡', text: 'Crits stun for 0.5 s', desc: 'Critical kunai hits stun enemies; bosses are slowed instead', dur: 0.5, bossSlow: 0.4 },
    lightFeet:     { slot: 'unique', name: 'Light Feet', jp: '軽身', text: '+35% move speed', desc: 'Travelling light: run much faster with the kunai', move: 1.35 },
  },
  staff: {
    wideBurst:     { slot: 'basic', name: 'Wide Blessing', jp: '広祓', text: '+40% burst area', desc: 'The spirit burst covers a much wider area', radiusMul: 1.4 },
    sacredPool:    { slot: 'basic', name: 'Sacred Pool', jp: '聖泉', text: 'Bursts leave a pool for 3 s', desc: 'A holy pool stays behind, dealing 20% damage every 0.5 s', dur: 3, tick: 0.5, dmgMul: 0.2 },
    lifeSpring:    { slot: 'special', name: 'Life Spring', jp: '命泉', text: 'Heal zone: 1.5x over 3 s', desc: 'The heal becomes a zone that heals 1.5x as much over time', dur: 3, tick: 0.5, mul: 1.5 },
    sanctuary:     { slot: 'special', name: 'Sanctuary', jp: '聖域', text: 'Wider heal that slows enemies', desc: 'A larger healing circle that also slows enemies inside it', radiusMul: 1.5, slow: 0.5, slowDur: 3 },
    overflow:      { slot: 'unique', name: 'Overflow', jp: '溢', text: 'Overheal up to +20', desc: 'Healing can raise your health 20 above its maximum', over: 20 },
    kiFlow:        { slot: 'unique', name: 'Energy Flow', jp: '気流', text: 'Hits and heals restore energy', desc: 'Each enemy the staff hits gives +2 energy; healing an ally gives +8', perHit: 2, perHeal: 8 },
  },
  bo: {
    peakForm:      { slot: 'basic', name: 'Peak Form', jp: '極型', text: 'Max combo: double damage', desc: 'Strikes at full combo (5) hit twice as hard', dmgMul: 2 },
    longReach:     { slot: 'basic', name: 'Long Reach', jp: '長棒', text: '+25% basic range', desc: 'The staff reaches further with every strike', rangeMul: 1.25 },
    longFlurry:    { slot: 'special', name: 'Endless Flurry', jp: '千連', text: 'Thousand Strikes +50% longer', desc: 'The flurry lasts half as long again, with more strikes', mul: 1.5 },
    heavyFlurry:   { slot: 'special', name: 'Crushing Flurry', jp: '重連', text: 'Fewer, much heavier strikes', desc: 'Six crushing blows instead of twelve quick ones', strikes: 6, dmgMul: 2.6 },
    flowState:     { slot: 'unique', name: 'Flow State', jp: '流転', text: 'Dash: instant max combo', desc: 'Dashing sets the bo combo straight to 5' },
    evasion:       { slot: 'unique', name: 'Evasion', jp: '見切', text: '+15% dodge chance', desc: 'Sometimes a blow simply misses you', dodge: 0.15 },
  },
  shield: {
    charge:        { slot: 'basic', name: 'Charging Bash', jp: '突進', text: 'Longer bash dash', desc: 'The bash carries you much further', dashMul: 1.6 },
    mirror:        { slot: 'basic', name: 'Mirror Polish', jp: '鏡面', text: 'Reflections +25% damage', desc: 'Projectiles you turn back hit harder', reflectMul: 1.25 },
    longGuard:     { slot: 'special', name: 'Long Guard', jp: '長守', text: 'Bulwark lasts 60% longer', desc: 'Stay behind the shield longer and store more', durMul: 1.6 },
    wideRelease:   { slot: 'special', name: 'Lion\'s Roar', jp: '獅吼', text: '+50% release area', desc: 'The released shockwave reaches much further', radiusMul: 1.5 },
    evasion:       { slot: 'unique', name: 'Deflection', jp: '受流', text: '+15% dodge chance', desc: 'Sometimes a blow glances off you', dodge: 0.15 },
    vigor:         { slot: 'unique', name: 'Lion\'s Heart', jp: '獅心', text: '+20 max health', desc: 'Your maximum health rises by 20', hp: 20 },
  },
};

// the arts a weapon could still take: one for every slot it hasn't filled yet
export function artOptions(w) {
  const A = ARTS[w.key] || {}, have = w.arts || {};
  return Object.keys(A).filter((k) => !have[A[k].slot]);
}
