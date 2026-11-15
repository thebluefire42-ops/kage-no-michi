# Kage no Michi — Path of Shadows

An isometric ninja roguelike that runs in the browser. Banished from the Kagerō clan by the usurper Regent Gensai, you fight your way home through 33 levels: spring rice paddies, an autumn mountain pass, a snowy castle town at night, and finally the Kagerō fortress itself. Bosses wait at levels 10, 20 and 30, and Gensai in his grand hall at level 33. Between levels a scroll map of the area opens: pick one of two paths to the next level, and each path shows its reward for clearing it: a Blessing (1 of 3 stat upgrades, incl. Ki Focus for cheaper specials), an Imbuement (1 of 2 weapon elements incl. Wind for faster cooldowns), a Talent (1 of 2), Supplies (Heal, Ki Tonic or Battle Rush) or a Sacrifice from the wandering monk (1-2 per area, more likely later in it). Bosses always give a Blessing. There is no attack-speed stat: each attack's own cooldown sets how often you can use it, and each weapon has its own move speed (slow weapons ~95%, fast ones ~107%; weapon select shows each attack's damage, cooldown, reach and ki cost; both weapons can attack at the same time). Enemies can drop heal (+10) and ki (+25) orbs: 3% / 8% for normal enemies, heavy ones always drop one of the two (50/50), and bosses always drop a heal. You start with 70 health (all enemy damage is scaled by ENEMY_DAMAGE_MUL = 0.85); regeneration and talent cooldowns pause once a level's last enemy is down.

The story is told in an opening cutscene and short retro-style dialogues (script in `src/story.js`). Confirm advances the text; Start/Esc skips.

- **Play:** single player, local co-op (keyboard + controller, or two controllers), or online co-op (host a game key / share an invite link).
- **Controls:** Xbox 360 controller (left stick move, right stick aim, LB/LT and RB/RT attacks, A dash) or keyboard and mouse (WASD, mouse aim, Q/E and left/right mouse, Space dash).
- All art is drawn in code. Music lives in `music/` (menu theme + one track per area, crossfaded into itself at the loop point); sound effects are synthesized.
- Music: each area plays the tense version of its song (music/biome_N_tense; the fortress uses area 3's), from the opening cutscene on; loops skip the intro and quiet breakdowns (cue points in MUSIC_CUES in src/audio.js). Fights still trigger the tense screen effect (crimson-pulsing edges, cinematic bars, embers); rules in MUSIC_TENSE in src/config.js. Special attacks you lack the ki for are grayed out on the HUD with a ki bar filling toward the cost.
- Later areas add extra enemy attacks on top of each enemy's base behaviour (src/extras.js): foxfire, dives, conch shockwaves, ice volleys, freezing breath, soul blasts, combos, sweeps, heavy bolts, kunai fans, war chants and shield quakes.
- The monk's Sacrifice screen has its own ominous reveal (heartbeat, blood-red vignette, cards burning in); upgrade cards show one plain effect line and a now ➜ after readout.
- Weapon select has a start-level picker (up / down, or the arrows), so a run can begin at any of the 33 levels.
- Co-op: a downed partner can be revived for 15 s. A partner who falls returns 3 levels later; their corner of the HUD shows the level.

## Run locally

```
node serve.js
```

Then open http://localhost:5180. (`serve.js` supports range requests, which the music streaming needs.)

Test shortcuts: `?level=N` starts at a level (1 plays the intro cutscene, 31-32 the fortress, 33 the Gensai fight), `?monk=1` brings the wandering monk after any level, `?god=1` makes you invulnerable, `?weapons=katanas,knives` skips weapon select. F3 shows a debug overlay.

## Online co-op

Online play is peer-to-peer (WebRTC). [PeerJS](https://peerjs.com)'s free service is only used to connect the two players. Very strict networks (some corporate or school networks) can block direct connections.

Tunable numbers are in `src/config.js`.
