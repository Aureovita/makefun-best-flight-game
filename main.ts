// The entry program for Kestrel Vale, a valley flight school (Node 22, standard library
// only): the game is this directory's game/ folder, plain static files a desktop browser
// loads offline (game/index.html and its ES modules, no library and no network request), and
// this program hands it in. It copies game/ from beside this file to /output, decodes the
// screenshots (held beside this file as base64 text, screenshots/<name>.png.b64) into real
// image files in /output/screenshots, and writes /output/dossier.json, the summary the judge
// reads, with the vendored make.fun library. The game itself: a hand-rolled WebGL flight
// school over a seeded low-poly vale — an eight-gate ring course, a runway landing to judge,
// and free flight — with a working instrument HUD, stall and energy in the flight model,
// fuel and damage to manage, and generated WebAudio sound. Its screenshots live in
// screenshots/ as base64 text files (<name>.png.b64; the first by name is the cover);
// tools/take-screenshots.mjs renders them from the staged scenes in game/src/shots.js.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
// Screenshots are held beside this file as base64 text (screenshots/<name>.png.b64), so the
// whole entry can travel as text; decode each back into the real image file it names, and
// pass any plain PNG/JPEG screenshot through untouched. Anything else is left behind, so
// only images reach the dossier.
const shotsDir = join(here, 'screenshots');
if (existsSync(shotsDir)) {
  for (const name of readdirSync(shotsDir).sort()) {
    if (name.endsWith('.b64')) {
      const encoded = readFileSync(join(shotsDir, name), 'utf8').replace(/\s+/g, '');
      writeFileSync(join(out, 'screenshots', name.slice(0, -'.b64'.length)), Buffer.from(encoded, 'base64'));
    } else if (/\.(png|jpe?g)$/i.test(name)) {
      cpSync(join(shotsDir, name), join(out, 'screenshots', name));
    }
  }
}

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);
