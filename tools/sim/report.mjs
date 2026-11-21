// Builds tools/sim/report.html (one self-contained page) from tools/sim/results/*.json.
//   node tools/sim/report.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const load = (s) => { const f = path.join(here, 'results', `${s}.json`); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { results: [] }; };
const sorted = (a) => [...a].sort((x, y) => x - y);
const pct = (a, p) => { const s = sorted(a); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const med = (a) => pct(a, 0.5);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);

const W = load('weapons'), E = load('enemies'), P = load('pairs'), C = load('cards');
const ok = (R) => R.results.filter((r) => !r.err);
const WEAPON_ORDER = ['katanas', 'knives', 'bo', 'orb', 'gloves', 'crossbow', 'heavy', 'staff', 'shield'];
const wname = {}; for (const r of [...ok(W), ...ok(E), ...ok(C)]) if (r.weapon && r.weaponName) wname[r.weapon] = r.weaponName;

// ---- 1. weapons on dummies
const weapons = WEAPON_ORDER.map((w) => {
  const pick = (count, specials) => ok(W).filter((r) => r.weapon === w && (count > 1 ? r.target.count > 1 : r.target.count === 1) && r.specials === specials);
  const sum = (rs) => { const a = rs.map((r) => r.res.dps); return { p10: r1(pct(a, 0.1)), med: r1(med(a)), p90: r1(pct(a, 0.9)), n: a.length }; };
  const styles = {};
  for (const r of pick(1, 'always')) (styles[r.style.tag] = styles[r.style.tag] || []).push(r.res.dps);
  return { key: w, name: wname[w] || w, one: sum(pick(1, 'always')), grp: sum(pick(4, 'always')), oneBasic: sum(pick(1, 'never')), grpBasic: sum(pick(4, 'never')),
    styles: Object.fromEntries(Object.entries(styles).map(([k, a]) => [k, r1(a.reduce((x, y) => x + y, 0) / a.length)])) };
});

// ---- 2. enemies: time to kill per weapon, per room, two playstyles
const styleKey = (r) => (r.style.uptime >= 0.7 ? 'typical' : 'sloppy');
const rooms = [];
for (const r of ok(E)) {
  let R = rooms.find((x) => x.room === r.room); if (!R) rooms.push(R = { room: r.room, enemies: [] });
  if (!R.enemies.find((x) => x.type === r.enemy)) R.enemies.push({ type: r.enemy, name: r.enemyName || r.res.name || r.enemy, hp: r.res.hpPerTarget, heavy: r.heavy, shield: r.shield });
}
const ttk = {}; // ttk[style][weapon][enemy] = seconds (null = no kill in 40 s)
for (const r of ok(E)) { const s = styleKey(r); ((ttk[s] = ttk[s] || {})[r.weapon] = ttk[s][r.weapon] || {})[r.enemy] = r.res.kills ? r1(r.res.ttk) : null; }
const levelOf = { area1: 6, area2: 15, area3: 25, area4: 32, dojo: 15, library: 15 };

// ---- 3. weapon pairs: kills per minute against a mixed group of four
const pairs = {};
for (const r of ok(P)) { const s = styleKey(r); ((pairs[s] = pairs[s] || {})[r.pair] = pairs[s][r.pair] || {})[r.room] = r1(r.res.kpm); }

// ---- 4. cards: % more damage than the same weapon without it
const base = {};
for (const r of ok(C).filter((r) => r.kind === 'baseline')) { const k = r.weapon + (r.group ? 'g' : 's'); (base[k] = base[k] || []).push(r.res.dps); }
const cardRows = {}; // key -> { label, kind, rarity, rarityName, weapon (arts), gains: {weapon: {one, grp}} }
for (const r of ok(C).filter((r) => r.kind !== 'baseline')) {
  const key = r.kind === 'art' ? `art:${r.weapon}:${r.card}` : `${r.kind}:${r.card}:${r.rarity}`;
  const row = cardRows[key] = cardRows[key] || { key, label: r.label || r.card, kind: r.kind, rarity: r.rarity ?? null, rarityName: r.rarityName || null, weapon: r.kind === 'art' ? r.weapon : null, slot: r.artSlot || null, text: r.artText || null, raw: {} };
  const g = r.group ? 'grp' : 'one';
  ((row.raw[r.weapon] = row.raw[r.weapon] || { one: [], grp: [] })[g]).push((r.res.dps / med(base[r.weapon + (r.group ? 'g' : 's')]) - 1) * 100);
}
const cards = Object.values(cardRows).map((row) => ({ ...row, raw: undefined, gains: Object.fromEntries(Object.entries(row.raw).map(([w, v]) => [w, { one: Math.round(med(v.one)), grp: Math.round(med(v.grp)) }])) }));

// ---- auto-flags
const flags = [];
const allMed = med(weapons.map((w) => w.one.med));
for (const w of weapons) {
  if (w.one.med > allMed * 1.45) flags.push({ sev: 'high', area: 'Weapon', text: `${w.name} single-target DPS ${w.one.med} is ${Math.round((w.one.med / allMed - 1) * 100)}% above the median weapon (${r1(allMed)}).` });
  if (w.one.med < allMed * 0.55) flags.push({ sev: 'low', area: 'Weapon', text: `${w.name} single-target DPS ${w.one.med} is ${Math.round((1 - w.one.med / allMed) * 100)}% below the median weapon (${r1(allMed)}).` });
  const sp = w.one.p90 / Math.max(0.1, w.one.p10);
  if (sp > 2.5) flags.push({ sev: 'info', area: 'Playstyle', text: `${w.name} swings ${r1(sp)}× between the worst and best playstyles (${w.one.p10} → ${w.one.p90} DPS): it rewards skill a lot.` });
}
const dmgLeg = med(Object.values((cards.find((c) => c.key === 'stat:baseDamage:3') || { gains: {} }).gains).map((g) => g.one)) || 25;
for (const c of cards) {
  const vals = Object.entries(c.gains).map(([w, g]) => [w, Math.max(g.one, g.grp)]);
  const top = vals.sort((a, b) => b[1] - a[1])[0];
  if (!top) continue;
  const tier = c.rarityName ? ` (${c.rarityName})` : '';
  if (top[1] > Math.max(50, dmgLeg * 2.2)) flags.push({ sev: 'high', area: c.kind === 'art' ? 'Technique' : c.kind === 'element' ? 'Imbuement' : 'Card', text: `${c.label}${tier} adds +${top[1]}% damage with the ${wname[top[0]] || top[0]} (a legendary Attack Damage card adds +${Math.round(dmgLeg)}%).` });
}
for (const s of ['typical']) for (const R of rooms) for (const en of R.enemies) {
  const t = WEAPON_ORDER.map((w) => ttk[s]?.[w]?.[en.type]);
  const m = med(t.map((x) => (x == null ? 40 : x)));
  if (m >= 20) flags.push({ sev: 'warn', area: 'Enemy', text: `${en.name} (${R.room}, ${en.hp} HP${en.shield ? ', shield' : ''}) takes a median weapon ${m >= 40 ? 'over 40' : Math.round(m)} s to kill alone.` });
}
const pk = Object.entries(pairs.typical || {}).map(([p, v]) => [p, Object.values(v).reduce((a, b) => a + b, 0) / Object.values(v).length]);
const pkMed = med(pk.map((x) => x[1]));
for (const [p, v] of pk) if (v > pkMed * 1.5) flags.push({ sev: 'high', area: 'Groups', text: `${wname[p] || p} kills ${r1(v)} enemies/min against mixed groups, ${r1(v / pkMed)}× the median weapon.` });
for (const [p, v] of pk) if (v < pkMed * 0.6) flags.push({ sev: 'low', area: 'Groups', text: `${wname[p] || p} kills only ${r1(v)} enemies/min against mixed groups, ${r1(v / pkMed)}× the median weapon.` });
const order = { high: 0, warn: 1, low: 2, info: 3 };
flags.sort((a, b) => order[a.sev] - order[b.sev]);

// ---- vision checks: the design intent for each weapon and card type, tested against the numbers
const V = load('vision');
const vr = ok(V);
const avg = (rs, f = (r) => r.res.dps) => (rs.length ? rs.reduce((a, r) => a + f(r), 0) / rs.length : null);
const T = (test, extra = () => true) => vr.filter((r) => r.test === test && extra(r));
const medOne = med(weapons.map((w) => w.one.med)), medGrp = med(weapons.map((w) => w.grp.med));
const verdict = (good, near) => (good ? 'on' : near ? 'near' : 'off');
const f1 = (x) => (x == null ? '–' : (Math.round(x * 10) / 10).toString());
const pctS = (x) => `${x >= 0 ? '+' : ''}${Math.round(x)}%`;
const vision = [];
if (vr.length) {
  const flowMed = med(WEAPON_ORDER.map((w) => avg(T('flow', (r) => r.weapon === w))));
  { // bo
    const c0 = avg(T('bo-combo0')), c5 = avg(T('bo-combo5'));
    const basicMed = med(WEAPON_ORDER.map((w) => avg(T('flow-basic', (r) => r.weapon === w))));
    const messyMed = med(WEAPON_ORDER.map((w) => avg(T('messy', (r) => r.weapon === w))));
    const boClean = avg(T('flow', (r) => r.weapon === 'bo')), boMessy = avg(T('messy', (r) => r.weapon === 'bo'));
    const fullShare = (rs) => { const h = rs.reduce((a, r) => a + (r.res.bo ? r.res.bo.hi[1] : 0), 0), n = rs.reduce((a, r) => a + (r.res.bo ? r.res.bo.lo[1] + r.res.bo.mid[1] + r.res.bo.hi[1] : 0), 0); return n ? h / n : 0; };
    vision.push({ key: 'bo', title: 'Bo Stick', claim: 'Bad at low combo, strong at high combo. Damage stays the same; the combo only speeds up the swings, and a miss resets it.', verdict: verdict(c0 <= 0.8 * basicMed && c5 >= 1.3 * basicMed && boMessy / messyMed < boClean / flowMed, c0 <= basicMed && c5 >= 1.15 * basicMed),
      evidence: [`Basic attacks held at no combo (slowest swing): ${f1(c0)} DPS (${f1(c0 / basicMed)}× the median weapon's basic attacks, ${f1(basicMed)})`, `Basic attacks held at full combo (fastest swing): ${f1(c5)} DPS (${f1(c5 / basicMed)}×)`, `Clean play: ${f1(boClean)} DPS (${f1(boClean / flowMed)}× median), ${Math.round(fullShare(T('flow', (r) => r.weapon === 'bo')) * 100)}% of blows at full combo`, `Messy play (loose aim reacting 0.25 s late, moving target, misses reset the combo): ${f1(boMessy)} DPS (${f1(boMessy / messyMed)}× median), ${Math.round(fullShare(T('messy', (r) => r.weapon === 'bo')) * 100)}% of blows at full combo`],
      want: 'Basic attacks: no combo at most 0.8× and full combo at least 1.3× those of the median weapon; messy play hurts the bo more than the median weapon.' });
  }
  { // knives
    const nd1 = avg(T('knives-nodash', (r) => r.target.count === 1)), d1 = avg(T('knives-dash', (r) => r.target.count === 1)), nd4 = avg(T('knives-nodash', (r) => r.target.count > 1)), d4 = avg(T('knives-dash', (r) => r.target.count > 1));
    vision.push({ key: 'knives', title: 'Throwing Knives', claim: 'Bad without using the dash tactically, good when dashing through fully stacked enemies.', verdict: verdict(nd1 <= 0.75 * medOne && d4 >= 1.1 * medGrp, nd1 <= 0.9 * medOne && d4 >= medGrp),
      evidence: [`Never dashing through: ${f1(nd1)} DPS on one target (${f1(nd1 / medOne)}× median), ${f1(nd4)} on a group`, `Dashing through the stacked kunai: ${f1(d1)} DPS on one target, ${f1(d4)} on a group of four (${f1(d4 / medGrp)}× the median group DPS ${f1(medGrp)})`],
      want: 'Without the dash at most 0.75× the median; dashing through a stacked group at least 1.1×.' });
  }
  { // orb
    const solo = weapons.find((w) => w.key === 'orb').one.med;
    const kp = (test, w) => avg(T(test, (r) => r.weapon === w), (r) => r.res.kpm);
    const rel = (test) => kp(test, 'orb') / Math.max(0.01, med(WEAPON_ORDER.filter((w) => w !== 'orb').map((w) => kp(test, w))));
    const light = rel('orb-light'), heavy = rel('orb-heavy'), climb = heavy / Math.max(0.01, light);
    const hv = T('orb-heavy', (r) => r.weapon === 'orb'), share = (k) => avg(hv, (r) => (r.res.src[k] || 0) / Math.max(1, Object.values(r.res.src).reduce((a, b) => a + b, 0)));
    vision.push({ key: 'orb', title: 'Restless Spirit Orb', claim: 'Bad on its own, but good when raising strong enemies and tethering enemies for other weapons, spirits and a co-op partner.', verdict: verdict(solo <= 0.85 * medOne && climb >= 1.25 && heavy >= 0.9, solo <= medOne && climb >= 1.1),
      evidence: [`Alone on one dummy: ${f1(solo)} DPS (${f1(solo / medOne)}× median)`, `Area-2 groups of regular enemies: ${f1(light)}× the median weapon's kills per minute`, `Area-2 groups with heavies (their spirits fight on, taking constant chip damage): ${f1(heavy)}× the median (standing ${f1(climb)}× better)`, `With heavies around, spirits deal ${Math.round(share('spirit') * 100)}% and tethers ${Math.round(share('tether') * 100)}% of the orb's damage`, 'Tethers deal damage over time only (no extra damage taken since 2026-11-20); a co-op partner is not simulated.'],
      want: 'Alone at most 0.85× the median; with heavies around, its standing at least 1.25× better than against regular enemies, and near the median weapon (0.9×+).' });
  }
  { // crossbow
    const a0 = avg(T('crossbow-aim0')), a14 = avg(T('crossbow-aim14')), a25 = avg(T('crossbow-aim25'));
    const cb = weapons.find((w) => w.key === 'crossbow');
    vision.push({ key: 'crossbow', title: 'Crossbow', claim: 'Long range, strong with good aim and reliable on single targets; a bit slower than other weapons and needs to charge.', verdict: verdict(a0 >= medOne && a25 <= 0.75 * a0, a0 >= 0.9 * medOne && a25 <= 0.85 * a0),
      evidence: [`From 6 tiles: ${f1(a0)} DPS with sharp aim (${f1(a0 / medOne)}× median), ${f1(a14)} sloppy, ${f1(a25)} wild`, `Across all playstyles on one target: ${f1(cb.one.med)} median DPS`],
      want: 'Sharp aim at least the median weapon; wild aim at least 25% lower.' });
  }
  { // heavy
    const per = WEAPON_ORDER.map((w) => { const rs = ok(W).filter((r) => r.weapon === w && r.target.count === 1 && r.specials === 'always' && r.res.hits); const d = avg(rs, (r) => r.res.src[w] || 0), h = avg(rs, (r) => (r.res.hits || {})[w] || 0); return { w, perHit: h ? d / h : 0, rate: h / 40 }; });
    const hv = per.find((p) => p.w === 'heavy'), byHit = [...per].sort((a, b) => b.perHit - a.perHit), melee = per.filter((p) => ['katanas', 'bo', 'heavy', 'shield'].includes(p.w)).sort((a, b) => a.rate - b.rate);
    vision.push({ key: 'heavy', title: 'Heavy Sword', claim: 'High damage, but very slow and vulnerable while charging.', verdict: verdict(byHit[0].w === 'heavy' && melee[0].w === 'heavy', byHit.slice(0, 2).some((p) => p.w === 'heavy')),
      evidence: [`${f1(hv.perHit)} damage per hit (${byHit.findIndex((p) => p.w === 'heavy') + 1}. of 8; next: ${wname[byHit.find((p) => p.w !== 'heavy').w]} ${f1(byHit.find((p) => p.w !== 'heavy').perHit)})`, `${f1(hv.rate)} hits per second (slowest melee: ${wname[melee[0].w]} ${f1(melee[0].rate)})`, 'Vulnerability while charging is not measured: the sim\'s enemies do not attack.'],
      want: 'Highest damage per hit and the slowest melee attack rate.' });
  }
  { // shield
    const pa = T('shield-pressure-always'), pn = T('shield-pressure-never');
    const up = avg(pa) / Math.max(0.1, avg(pn)), rel = avg(pa, (r) => r.res.release) / Math.max(1, avg(pa, (r) => r.res.dps * 40)), taken = avg(pa, (r) => r.res.taken);
    vision.push({ key: 'shield', title: 'Shishi Shield', claim: 'A defensive option; the special does good damage when used wisely after absorbing a lot.', verdict: verdict(up >= 1.3 && rel >= 0.25, up >= 1.15),
      evidence: [`Under pressure (three enemies, a 12 hit every 1.6 s each, ${Math.round(taken)} hits taken): ${f1(avg(pa))} DPS with Bulwark vs ${f1(avg(pn))} without (${pctS((up - 1) * 100)})`, `Bulwark releases deal ${Math.round(rel * 100)}% of its damage`, `With nothing hitting it: ${f1(weapons.find((w) => w.key === 'shield').one.med)} DPS (defence is not counted)`],
      want: 'Under pressure the Bulwark adds at least 30%, and its releases deal at least a quarter of the damage.' });
  }
  { // katanas
    const tip = avg(T('katanas-tip')), close = avg(T('katanas-close')), k = weapons.find((w) => w.key === 'katanas');
    const allRound = k.one.med >= 0.8 * medOne && k.one.med <= 1.3 * medOne;
    vision.push({ key: 'katanas', title: 'Dual Katanas', claim: 'A decent all-rounder; strong when hitting with the blade tip and using specials on many enemies.', verdict: verdict(allRound && tip >= 1.2 * close && k.grp.med >= 1.1 * medGrp, allRound && tip >= 1.1 * close),
      evidence: [`One target: ${f1(k.one.med)} DPS (${f1(k.one.med / medOne)}× median)`, `Blade tip vs too close: ${f1(tip)} vs ${f1(close)} DPS (${pctS((tip / close - 1) * 100)})`, `Group of four with specials: ${f1(k.grp.med)} DPS (${f1(k.grp.med / medGrp)}× median)`],
      want: 'Within 0.8–1.3× the median on one target, the tip at least 20% better, and at least 1.1× the median on groups.' });
  }
}
{ // core stat cards: mediocre commons, strong legendaries
  const STATS = [['baseDamage', 'Attack Damage'], ['critChance', 'Crit Chance'], ['critDamage', 'Crit Damage']];
  const g = (stat, r) => { const c = cards.find((x) => x.key === `stat:${stat}:${r}`); return c ? med(Object.values(c.gains).map((v) => (v.one + v.grp) / 2)) : null; };
  const rows = STATS.map(([s, n]) => ({ n, c: g(s, 0), l: g(s, 3) })).filter((r) => r.c != null);
  const okN = rows.filter((r) => r.c >= 4 && r.c <= 8 && r.l >= 20).length;
  const ek = cards.find((x) => x.key === 'stat:kiCost:3'), ekv = ek ? med(Object.values(ek.gains).map((v) => (v.one + v.grp) / 2)) : null;
  if (rows.length) vision.push({ key: 'stats', title: 'Core stat cards', claim: 'Mediocre common cards (about +6%), strong legendary cards (+20% or more).', verdict: verdict(okN === rows.length, okN >= rows.length - 1),
    evidence: rows.map((r) => `${r.n}: common ${pctS(r.c)}, legendary ${pctS(r.l)} damage`).concat([`Energy Cost (legendary ${ekv == null ? '–' : pctS(ekv)} damage) and Dash Cooldown buy specials and dashes, not damage: not judged here.`]),
    want: 'Damage cards: common +4% to +8%, legendary at least +20% (median weapon, one target and groups).' });
}
{ // imbuements, each against its own vision (legendary cards from the cards suite, gains per weapon, one target / group of four)
  const el = (name, q = 3) => cards.find((c) => c.kind === 'element' && c.key === `element:${name}:${q}`);
  const G = (c, k) => (c ? Object.fromEntries(Object.entries(c.gains).map(([w, v]) => [w, v[k]])) : {});
  const mv = (o) => med(Object.values(o));
  { // poison: strong when hitting multiple enemies
    const c = el('poison'), one = mv(G(c, 'one')), grp = mv(G(c, 'grp'));
    if (c) vision.push({ key: 'poison', title: 'Poison', claim: 'Strong when hitting multiple enemies.', verdict: verdict(grp >= 1.4 * Math.max(1, one) && grp >= 30, grp >= 1.2 * Math.max(1, one)),
      evidence: [`Legendary on one target: ${pctS(one)} (median weapon)`, `Legendary on a group of four: ${pctS(grp)}`],
      want: 'On a group at least 1.4× its single-target gain, and at least +30%.' });
  }
  { // lightning: strong against groups or with big hits
    const c = el('lightning'), g = G(c, 'grp'), grp = mv(g);
    const BIG = ['heavy', 'crossbow', 'gloves'], SMALL = ['katanas', 'knives', 'bo'];
    const big = med(BIG.map((w) => g[w] ?? 0)), small = med(SMALL.map((w) => g[w] ?? 0));
    if (c) vision.push({ key: 'lightning', title: 'Lightning', claim: 'Strong against multiple enemies, or with high single-hit damage.', verdict: verdict(grp >= 25 && grp <= 55 && big >= 1.3 * Math.max(1, small), grp >= 20 && big >= 1.1 * Math.max(1, small)),
      evidence: [`Legendary on a group of four: ${pctS(grp)} (median weapon; was +71% before the nerf)`, `Big-hit weapons (heavy, crossbow, gloves): ${pctS(big)} · fast small-hit weapons (katanas, knives, bo): ${pctS(small)}`, 'Chains need a second enemy, so it adds nothing to a lone target.'],
      want: 'Legendary +25% to +55% on groups, and big hitters gain at least 1.3× what fast small hitters gain.' });
  }
  { // arcane: strong for high energy usage builds
    const at = (w, sp, on) => avg(T(`arcane-${sp}-${on}`, (r) => r.weapon === w));
    const up = (sp) => WEAPON_ORDER.map((w) => [w, (at(w, sp, 'on') / Math.max(0.1, at(w, sp, 'off')) - 1) * 100]);
    const withSp = up('always'), noSp = up('never'), ws = med(withSp.map((x) => x[1])), ns = med(noSp.map((x) => x[1]));
    const top = [...withSp].sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (vr.some((r) => r.test && r.test.startsWith('arcane-'))) vision.push({ key: 'arcane', title: 'Arcane', claim: 'Strong for builds that use a lot of energy.', verdict: verdict(ws >= 15 && ws >= 2.5 * Math.max(1, ns), ws >= 10 && ws >= 1.5 * Math.max(1, ns)),
      evidence: [`Legendary, using specials (spending energy): ${pctS(ws)} (median weapon)`, `Legendary, basic attacks only: ${pctS(ns)}`, `Best with specials: ${top.map(([w, v]) => `${wname[w] || w} ${pctS(v)}`).join(', ')}`],
      want: 'With specials at least +15% and 2.5× its gain without specials.' });
  }
  { // wind: allround strong
    const c = el('wind'), g = Object.entries(c ? c.gains : {}).map(([w, v]) => [w, (v.one + v.grp) / 2]), m = med(g.map((x) => x[1]));
    const okW = g.filter((x) => x[1] >= 10).length, low = g.filter((x) => x[1] < 10);
    if (c) vision.push({ key: 'wind', title: 'Wind', claim: 'All-round strong for most builds, especially ones with strong attacking abilities.', verdict: verdict(okW >= g.length - 1 && m >= 15, okW >= g.length - 3),
      evidence: [`Legendary: ${pctS(m)} on the median weapon`, `At least +10% on ${okW} of ${g.length} weapons${low.length ? ` (below: ${low.map(([w, v]) => `${wname[w] || w} ${pctS(v)}`).join(', ')})` : ''}`],
      want: 'Legendary at least +10% on all but one weapon, and +15% on the median weapon.' });
  }
}
if (false) { // (the old combined imbuement check, kept for reference)
  const EL = [...new Set(cards.filter((c) => c.kind === 'element').map((c) => c.label))];
  const rows = EL.map((label) => { const r = cards.filter((c) => c.kind === 'element' && c.label === label); const at = (q) => r.find((c) => c.rarity === q); const best = (c) => Object.values(c.gains).map((v) => Math.max(v.one, v.grp)); const rare = at(1), leg = at(3); if (!rare || !leg) return null; const lr = med(best(rare)), ll = med(best(leg)), lb = best(leg); return { label, lr, ll, spread: Math.max(...lb) - Math.min(...lb) }; }).filter(Boolean);
  const okN = rows.filter((r) => r.ll >= 1.3 * Math.max(1, r.lr) && r.spread >= 15).length;
  if (rows.length) vision.push({ key: 'imbue', title: 'Imbuements', claim: 'Good depending on rarity and build synergy.', verdict: verdict(okN === rows.length, okN >= rows.length - 1),
    evidence: rows.map((r) => `${r.label}: rare ${pctS(r.lr)} → legendary ${pctS(r.ll)}; legendary differs by ${Math.round(r.spread)} points between weapons`),
    want: 'Legendary at least 1.3× rare, and at least 15 points of difference between the best and worst weapon for it.' });
}
{ // techniques: no option in a slot simply better than the other
  const A = cards.filter((c) => c.kind === 'art');
  let pairsN = 0, dominated = [];
  for (const w of WEAPON_ORDER) for (const slot of ['basic', 'secondary', 'special']) {
    const two = A.filter((c) => c.weapon === w && c.slot === slot); if (two.length !== 2) continue;
    const gv = two.map((c) => c.gains[w] || { one: 0, grp: 0 });
    if (gv.some((v) => Math.abs(v.one) <= 2 && Math.abs(v.grp) <= 2)) continue; // one of them only shows in real fights
    pairsN++;
    for (const [i, j] of [[0, 1], [1, 0]]) if (gv[i].one >= gv[j].one + 25 && gv[i].grp >= gv[j].grp + 25) dominated.push(`${two[i].label} beats ${two[j].label} on every target (${wname[w]})`);
  }
  vision.push({ key: 'arts', title: 'Techniques', claim: 'Depend on build and preferred playstyle: no technique should simply beat its alternative.', verdict: verdict(dominated.length === 0, dominated.length <= 1),
    evidence: [`${pairsN} technique pairs could both be measured on dummies`].concat(dominated.length ? dominated : ['No technique beats its alternative by 25+ points on both one target and groups']),
    want: 'In each slot, neither option beats the other by 25 points on both one target and groups.' });
}

const data = { at: C.at || W.at, vision, counts: { weapons: ok(W).length, enemies: ok(E).length, pairs: ok(P).length, cards: ok(C).length, vision: vr.length }, weapons, rooms, levelOf, ttk, pairs, cards, flags, wname, order: WEAPON_ORDER };
const tpl = readFileSync(path.join(here, 'report.template.html'), 'utf8');
writeFileSync(path.join(here, 'report.html'), tpl.replace('/*__DATA__*/null', JSON.stringify(data)));
console.log(`report.html: ${flags.length} flags, ${cards.length} card rows`);
