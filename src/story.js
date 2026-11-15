// The story: who speaks (portrait looks) and every script line.
// Lines: { who, text, coop?: only in co-op, solo?: only solo, act?: cue for the intro cutscene }.
// who 'ally' = Kaze in co-op, Kage when playing alone.
import { LOOKS } from './behaviors.js';
import { MONK_LOOK } from './sacrifice.js';

const PLAYER_PALS = [
  { skin: '#f1c9a5', cloth: '#2c3a5e', cloth2: '#1d2742', sash: '#c0392b', hood: '#232c46', scarf: '#d63a3a', metal: '#e6edf5', wood: '#7a4e2a', accent: '#c0392b' },
  { skin: '#f1c9a5', cloth: '#e6e2d6', cloth2: '#3a4a5e', sash: '#2a7ac0', hood: '#d8d2c2', scarf: '#3a9ae0', metal: '#e6edf5', wood: '#7a4e2a', accent: '#2a7ac0' },
];
export const GENSAI_PAL = { skin: '#e6c09c', cloth: '#1c1418', cloth2: '#7a1420', sash: '#d8a838', accent: '#d8a838', metal: '#f0f4f8', mantle: '#8a1022', wood: '#2a1a12' };
export const KAGERO_PAL = { skin: '#e2b48c', cloth: '#1e1a22', cloth2: '#6a1420', sash: '#c8a050', hat: '#141218', accent: '#b02030', metal: '#e6edf5', wood: '#3a2418', hood: '#16131a', eye: '#ff6a5a' };

// fake enemy for LOOKS functions (idle pose)
const idle = { state: 'chase', pose: null, data: {}, t: 0, tDur: 1, phase: 1 };
const look = (type) => () => ({ ...LOOKS[type](idle, 0), pose: null });

// side: which portrait frame (left = the players' side). voice: blip pitch.
export const CHARACTERS = {
  kage: { name: 'Kage', jp: '影', side: 'left', col: '#1f4fa8', voice: 1.0, rig: () => ({ pal: PLAYER_PALS[0], head: 'hood', scarf: true }) },
  kaze: { name: 'Kaze', jp: '風', side: 'left', col: '#1f4fa8', voice: 1.18, rig: () => ({ pal: PLAYER_PALS[1], head: 'hood', scarf: true }) },
  gensai: { name: 'Regent Gensai', jp: '玄斎', side: 'right', col: '#8a1426', voice: 0.62, rig: () => ({ pal: GENSAI_PAL, head: 'eboshi', armor: true, mantle: true }) },
  captain: { name: 'Captain of the Guard', jp: '隊長', side: 'right', col: '#6a1a24', voice: 0.8, rig: () => ({ pal: KAGERO_PAL, head: 'jingasa' }) },
  hunter: { name: 'Kagero Hunter', jp: '追手', side: 'right', col: '#5a1830', voice: 0.95, rig: () => ({ pal: KAGERO_PAL, head: 'mask' }) },
  assassin: { name: 'Shinobi Assassin', jp: '刺客', side: 'right', col: '#3e2a62', voice: 1.05, rig: look('assassin') },
  ashigaru: { name: 'Ashigaru Captain', jp: '足軽', side: 'right', col: '#6a5420', voice: 0.85, rig: look('spear') },
  kurogane: { name: 'Kurogane', jp: '黒鉄', side: 'right', col: '#3e4452', voice: 0.7, rig: look('ronin_boss') },
  tengu: { name: 'Tengu', jp: '天狗', side: 'right', col: '#9a2a18', voice: 0.9, rig: look('tengu') },
  shuten: { name: 'Shuten', jp: '酒呑', side: 'right', col: '#5a1a5e', voice: 0.5, rig: look('oni_lord') },
  bound: { name: 'Bound Warrior', jp: '亡者', side: 'right', col: '#1e5a62', voice: 0.75, rig: look('ghostspear') },
  fcaptain: { name: 'Fortress Captain', jp: '城番', side: 'right', col: '#6a2a1a', voice: 0.8, rig: look('kgsoldier') },
  honorguard: { name: 'Honor Guard', jp: '親衛', side: 'right', col: '#7a5a14', voice: 0.7, rig: look('kgchampion') },
  monk0: { name: 'Flute Monk', jp: '虚無僧', side: 'right', col: '#5a4428', voice: 0.9, rig: () => ({ ...MONK_LOOK[0] }) },
  monk1: { name: 'Old Hermit', jp: '仙人', side: 'right', col: '#2e5a34', voice: 1.25, rig: () => ({ ...MONK_LOOK[1] }) },
  monk2: { name: 'Pale Monk', jp: '幽僧', side: 'right', col: '#4a4a6a', voice: 0.78, rig: () => ({ ...MONK_LOOK[2] }) },
};

export const SCRIPTS = {
  // ------------------------------------------------ intro (two scenes; acts drive the cutscene)
  intro: [
    { who: 'gensai', text: 'Kneel lower, Kage. You kneel before the new master of the Kagero.' },
    { who: 'kage', text: 'Master Soen named no successor. His blood is still on the temple floor, Gensai.' },
    { who: 'gensai', text: 'The old man was soft. Under me, the Kagero will be feared, not pitied.' },
    { who: 'kage', text: 'Feared? You burn our villages and sell our people\'s rice to warlords.' },
    { who: 'kaze', coop: true, text: 'Then you will have to banish me too. I stand with Kage.' },
    { who: 'gensai', act: 'seize', text: 'For treason, I strip you of your name. Soldiers, take this filth far from my lands.' },
    { who: 'captain', act: 'toRoad', text: 'Far enough. The regent\'s word, exile, so listen well.' },
    { who: 'captain', act: 'shove', text: 'Set one foot in Kagero lands again and you will be slaughtered like a dog. You, and anyone who shelters you.' },
    { who: 'kaze', coop: true, act: 'soldiersLeave', text: '…They\'re gone. What now, Kage?' },
    { who: 'kage', act: 'rise', text: 'Now we go back. I will free our people from Gensai… and bring honor back to the Kagero.' },
  ],

  // ------------------------------------------------ area 1: Gensai's hunters
  level1: [
    { who: 'kage', text: 'Haruno… still far from home. Gensai\'s hunters won\'t be far behind.' },
  ],
  level2: [
    { who: 'hunter', text: 'There! The exile! The regent pays gold for that head!' },
    { who: 'kage', text: 'Gensai pays in lies. Come and collect, then.' },
  ],
  // ------------------------------------------------ area previews: the area's boss steps out of the gate
  preview_ronin_boss: [{ who: 'kurogane', text: 'So the exile crawls home. Run, little shadow… I will be waiting at the end of this road.' }],
  preview_tengu: [{ who: 'tengu', text: 'Mortals in my mountains again. Climb, then. I will be watching from the peak.' }],
  preview_oni_lord: [{ who: 'shuten', text: 'These are the regent\'s lands now. Walk on, and burn at my gate.' }],
  preview_gensai: [{ who: 'gensai', text: 'You actually made it to my walls. Every blade in this fortress knows your face. Come, Kage.' }],

  level4: [
    { who: 'assassin', text: 'We trained together, Kage. Nothing personal.' },
    { who: 'kage', text: 'It always was for Gensai.' },
  ],
  level7: [
    { who: 'ashigaru', text: 'By the regent\'s order: any village that shelters the exile will burn!' },
    { who: 'ally', text: 'Then every soldier you send is one less torch. Come on!' },
  ],
  boss_ronin_boss: [
    { who: 'kurogane', text: 'Gensai paid me a chest of gold for you, little shadow.' },
    { who: 'kage', text: 'Then you were cheated.' },
  ],
  ronin_boss_after: [
    { who: 'kurogane', text: 'Heh… the regent has eyes in the mountains too… you will never reach…' },
    { who: 'kage', text: 'Over the mountains, then.' },
  ],

  // ------------------------------------------------ area 2: wild yokai
  // cutscene before level 11 (cutscene2.js): walking out of the rice fields into Momiji Pass.
  // at: the line waits until the players have walked that far; delay: seconds before the box shows
  area2: [
    { who: 'kage', at: 0.42, text: 'The rice fields end here. Gensai\'s hunters won\'t follow us into the mountains.' },
    { who: 'kaze', coop: true, text: 'Momiji Pass… they say only yokai and wild things live past the old marker.' },
    { who: 'kage', at: 1.22, text: 'Momiji Pass. Master Soen walked this road once, long before there was a regent.' },
    { who: 'kaze', coop: true, at: 1.62, text: 'Even the deer keep their distance. Out here we are just two more wanderers.' },
    { who: 'kage', solo: true, at: 1.62, text: 'Even the deer keep their distance. Out here I am just one more wanderer.' },
    { who: 'kage', at: 2.0, text: 'We will not stop. Not for hunters, not for yokai, not for the regent\'s armies.' },
    { who: 'kaze', coop: true, text: 'Not until we stand in the Kagero halls again.' },
    { who: 'kage', text: '…and the honor of our clan is restored. I swear it on Master Soen\'s name.' },
    { who: 'tengu', act: 'tengu', delay: 1.9, text: 'KRAAA! Kaa! Kaa-kaa!' },
    { who: 'kage', text: 'A tengu…!' },
    { who: 'tengu', text: 'Kaa… little shadows, strolling into my mountains as if they owned them. Kraa-ha-ha!' },
    { who: 'tengu', text: 'Climb, then! Climb to my peak… kaa… and I will pluck the feathers from your pride!' },
    { who: 'tengu', act: 'tenguLeave', text: 'KAAA-KAAA!' },
    { who: 'kaze', coop: true, delay: 1.4, text: 'He flew toward the peak. Every yokai in this pass must answer to him.' },
    { who: 'kage', solo: true, delay: 1.4, text: 'Toward the peak. Every yokai in this pass must answer to him.' },
    { who: 'kage', act: 'walkOn', coop: true, text: 'Then the peak is where we are going. Come on, Kaze.' },
    { who: 'kage', act: 'walkOn', solo: true, text: 'Then the peak is where I am going.' },
  ],
  level11: [
    { who: 'kage', text: 'Momiji Pass. No hunter follows this far. Only yokai… and the wind.' },
    { who: 'kaze', coop: true, text: 'The yokai don\'t care whose side we are on. Stay sharp.' },
  ],
  level14: [
    { who: 'ally', text: 'The yokai are restless. Something is poisoning the land.' },
    { who: 'kage', solo: true, text: 'Gensai\'s pact reaches even here.' },
  ],
  level17: [
    { who: 'hunter', text: 'Even the mountain won\'t hide you, exile!' },
    { who: 'kage', text: 'You climbed all this way to die? Gensai must pay well.' },
  ],
  boss_tengu: [
    { who: 'tengu', text: 'Mortals climb my peak uninvited.' },
    { who: 'kage', text: 'I seek only the path home.' },
    { who: 'tengu', text: 'Then earn it.' },
  ],
  tengu_after: [
    { who: 'tengu', text: 'Your heart is true, shadow-child. Beyond lies your clan… guarded by the dead and the damned.' },
  ],

  // ------------------------------------------------ area 3: Gensai's protectors
  level21: [
    { who: 'kage', text: 'Kagero lands… Gensai has bound the fallen to guard his walls.' },
    { who: 'kaze', coop: true, text: 'Our own ancestors, made into his watchdogs. Unforgivable.' },
  ],
  level24: [
    { who: 'bound', text: 'The regent\'s will holds us. Turn back… or join us.' },
    { who: 'kage', text: 'I will set you free.' },
  ],
  boss_oni_lord: [
    { who: 'shuten', text: 'I am the gate guardian of the Kagero. The regent\'s pact binds me.' },
    { who: 'kage', text: 'Then I will break it.' },
  ],
  oni_lord_after: [
    { who: 'shuten', text: 'The gate… is yours…' },
    { who: 'kage', text: 'The fortress. Gensai is inside.' },
  ],

  // ------------------------------------------------ area 4: the fortress
  level31: [
    { who: 'fcaptain', text: 'The exile is inside the walls! Sound the alarm! No one leaves alive!' },
    { who: 'kage', text: 'These halls were my home.' },
  ],
  level32: [
    { who: 'honorguard', text: 'None reach the regent\'s hall. None.' },
    { who: 'ally', text: 'Then we will be the first.' },
  ],
  boss_gensai: [
    { who: 'gensai', text: 'You were warned, exile. You would be slaughtered.' },
    { who: 'kage', text: 'And you were warned the Kagero is not yours.' },
    { who: 'kaze', coop: true, text: 'Two of us, Gensai. Count them.' },
    { who: 'gensai', text: 'Guards! Bring me their heads!' },
  ],
  gensai_death: [
    { who: 'gensai', text: 'Kill me, then… it changes nothing.' },
    { who: 'gensai', text: 'My allies in the capital will not stop… not until all of Japan kneels… and their power has no end.' },
    { who: 'gensai', text: 'They will come for the Kagero… and for you.' },
    { who: 'kage', text: 'Then let them come. The Kagero will stand ready.' },
  ],

  // ------------------------------------------------ the wandering monks
  monk0: [{ who: 'monk0', text: '…The flute gives its breath and asks nothing back. Give something, and walk lighter.' }],
  monk1: [{ who: 'monk1', text: 'Heh! An exile with a fat purse of pride! Trade me a little of it for some real strength, eh?' }],
  monk2: [{ who: 'monk2', text: 'I too served the Kagero, until the regent\'s fire took me. Take my bargain… and finish what I could not.' }],
  // the same monks at their own temples ({name} = the monk's name, {temple} = 'Temple of …')
  temple0: [
    { who: 'monk0', text: '…You cleared the steps of the {temple}. I am {name}. The flute kept silent while you fought.' },
    { who: 'monk0', text: 'The flute gives its breath and asks nothing back. Give something here, and walk lighter.' },
  ],
  temple1: [
    { who: 'monk1', text: 'Heh! Swept my courtyard clean, did you? Welcome to the {temple}! Old {name} thanks you!' },
    { who: 'monk1', text: 'Now then, an exile with a fat purse of pride… trade me a little of it for some real strength, eh?' },
  ],
  temple2: [
    { who: 'monk2', text: 'The {temple} has not heard a living voice in years. I am {name}… what is left of him.' },
    { who: 'monk2', text: 'I too served the Kagero, until the regent\'s fire took me. Take my bargain… and finish what I could not.' },
  ],
};

// the lines of a script for this team (co-op/solo filtered, 'ally' resolved)
// vars: {key: value} fills {key} in the text; vars.names = {who: plate name} renames a speaker
export function storyLines(id, coop, vars = null) {
  const S = SCRIPTS[id];
  if (!S) return [];
  const fill = (t) => (vars ? t.replace(/\{(\w+)\}/g, (m, k) => (vars[k] !== undefined ? vars[k] : m)) : t);
  return S.filter((l) => (!l.coop || coop) && (!l.solo || !coop)).map((l) => {
    const who = l.who === 'ally' ? (coop ? 'kaze' : 'kage') : l.who;
    const out = { ...l, who, text: fill(l.text) };
    if (vars && vars.names && vars.names[who]) out.name = vars.names[who];
    return out;
  });
}
