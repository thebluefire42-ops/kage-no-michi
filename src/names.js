// Generated place and people names for route nodes: towns (Training), temples (the monk's own name)
// and libraries. All names are made up for the game.
import { seededRng } from './util.js';

// 100 small towns and villages
export const TOWN_NAMES = [
  'Akabane-juku', 'Aoyagi', 'Asahidai', 'Ayumi-machi', 'Chiyogaoka', 'Daimon-mura', 'Ebisu-no-sato', 'Fujikawa', 'Fukuzumi', 'Funabashi-juku',
  'Futamata', 'Hanazono', 'Haruhi', 'Hasunuma', 'Hayasaka', 'Higashiyama', 'Hikarizaka', 'Hinokuchi', 'Hirose', 'Hoshimi',
  'Ichinose', 'Iguchi-mura', 'Inaba', 'Ishigaki', 'Iwakura', 'Izumizawa', 'Kagamida', 'Kakinoki', 'Kamegawa', 'Kanzaki',
  'Karasuyama', 'Kasumi-machi', 'Kawabata', 'Kayano', 'Kirigaoka', 'Kitamura', 'Kobayashi-juku', 'Komorebi', 'Kosugi', 'Kumoide',
  'Kurosawa-mura', 'Kusunoki', 'Maeda', 'Matsubara', 'Midorino', 'Minamisato', 'Mitarai', 'Miyanoshita', 'Mizuho', 'Mochizuki',
  'Momozono', 'Moriyama', 'Nagatoro', 'Nakazato', 'Namiki', 'Narumi-juku', 'Nishikawa', 'Nobori-mura', 'Nonaka', 'Oborozuki',
  'Ochiai', 'Ogawara', 'Okubo', 'Omotesando-mura', 'Onodera', 'Otogi', 'Rengeji-machi', 'Ryuugasaki', 'Sakuradai', 'Sanjo-juku',
  'Sasayama', 'Sekigawa', 'Senbon', 'Shibukawa', 'Shimizu-machi', 'Shiraume', 'Shizukawa', 'Sugano', 'Suzumori', 'Tachibana',
  'Takanosu', 'Tamagawa', 'Tanabata-mura', 'Tatsumi', 'Tobishima', 'Tokiwa', 'Tsubakidai', 'Tsukimino', 'Uenohara', 'Umegaoka',
  'Urayasu-mura', 'Wakaba', 'Warabi-juku', 'Yamabuki', 'Yanagase', 'Yatsuhashi', 'Yoshino-sato', 'Yumesaki', 'Yukimura', 'Zenkoji-machi',
];

// what follows 'Library of …'
export const LIBRARY_NAMES = [
  'the Silent Pine', 'Ten Thousand Scrolls', 'the Moon Pavilion', 'Falling Ink', 'the Hidden Brush', 'the Crane Hall',
  'the Willow Shade', 'Old Kanzaki', 'the Eastern Wind', 'Stone Lanterns', 'the Sleeping Dragon', 'Lotus Rain',
  'the Nine Rivers', 'the Quiet Bell', 'Plum Blossom Hill', 'the Bamboo Gate', 'the Morning Mist', 'Master Sōhaku',
  'the Jade Inkstone', 'the Four Seasons', 'Autumn Lamps', 'the White Heron', 'the Endless Path', 'the Paper Moon',
];

// the wandering monks keep their personality; each temple gives its monk his own name
// (0 = the flute monk, 1 = the old hermit, 2 = the pale monk)
export const MONK_NAMES = [
  ['Kūzen', 'Sōfu', 'Mukan', 'Reiboku', 'Kyochiku', 'Shinsui', 'Hōan', 'Jakutei', 'Fūgetsu', 'Kansui'],
  ['Gentetsu', 'Hakuun', 'Sengai', 'Tōkō', 'Rakuzan', 'Daigaku', 'Kokuzan', 'Chōmei', 'Seppō', 'Ganshō'],
  ['Mugetsu', 'Yūrei', 'Shōkū', 'Hyōsen', 'Setsugen', 'Kōrei', 'Tokugen', 'Rensei', 'Shiun', 'Byakuya'],
];
export const monkIndexForArea = (area) => Math.min(area, 2);

// picks a name from a list without repeating within one area map (used is a Set of names)
export function pickName(list, rng, used) {
  const free = list.filter((n) => !used.has(n));
  const pool = free.length ? free : list;
  const n = pool[Math.floor(rng() * pool.length)];
  used.add(n);
  return n;
}
export { seededRng };
