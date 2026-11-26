// Render the entry's screenshots from the staged scenes in game/src/shots.js.
//
//   node tools/take-screenshots.mjs
//
// It starts the repo's own static server (serve.ts) on a scratch port, opens each scene
// listed in shots.json in a headless Chromium at 1280x800, waits for the game to set
// window.__shotReady, and saves the frame. PNGs that would break the 256 KiB gate are
// re-encoded as JPEG inside the page. The winning bytes are written next to the game as
// base64 text (screenshots/<name>.png.b64 or .jpg.b64) — the only form the entry ships in —
// and the raw frames are kept in the temp dir for a human look. Afterwards, check the
// dossier gates with:  MAKEFUN_OUTPUT_DIR=out node main.ts   (then read out/dossier.json)

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}`;
const MAX_BYTES = 262144;
const VIEWPORT = { width: 1280, height: 800 };

function fail(message) {
  console.error(`take-screenshots: ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

/** Find a Chromium the Playwright cache already holds; the newest build wins. */
function findChromium() {
  const cache = join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(cache)) fail(`no Playwright cache at ${cache}; install a browser or set CHROMIUM_PATH`);
  const candidates = [];
  for (const dir of readdirSync(cache).sort().reverse()) {
    for (const rel of ['chrome-linux/chrome', 'chrome-linux/headless_shell', 'chrome-mac', 'chrome-win/chrome.exe']) {
      const path = join(cache, dir, rel);
      if (existsSync(path)) candidates.push(path);
    }
  }
  if (candidates.length === 0) fail(`no chromium binary under ${cache}`);
  return process.env.CHROMIUM_PATH ?? candidates[0];
}

async function loadPlaywright() {
  try {
    return await import('playwright-core');
  } catch {
    try {
      return await import('playwright');
    } catch {
      fail('playwright-core is not installed for this Node; run: npm i -D playwright-core (or use a Node that can see it)');
    }
  }
}

async function waitForServer(deadlineMs = 20000) {
  const start = Date.now();
  for (;;) {
    try {
      const response = await fetch(`${BASE}/`);
      if (response.ok) return;
    } catch {
      // Not up yet.
    }
    if (Date.now() - start > deadlineMs) fail(`server did not answer on ${BASE} within ${deadlineMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

/** Re-encode PNG bytes as JPEG inside the page (the browser's own encoder), at a quality. */
async function toJpeg(page, pngBuffer, quality) {
  const base64 = pngBuffer.toString('base64');
  const jpegBase64 = await page.evaluate(async ([data, q]) => {
    const image = new Image();
    image.src = `data:image/png;base64,${data}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext('2d').drawImage(image, 0, 0);
    return canvas.toDataURL('image/jpeg', q).split(',')[1];
  }, [base64, quality]);
  return Buffer.from(jpegBase64, 'base64');
}

function wrapBase64(buffer) {
  const text = buffer.toString('base64');
  const lines = [];
  for (let i = 0; i < text.length; i += 100) lines.push(text.slice(i, i + 100));
  return `${lines.join('\n')}\n`;
}

async function main() {
  const shots = JSON.parse(readFileSync(join(root, 'shots.json'), 'utf8'));
  const shotsDir = join(root, 'screenshots');
  mkdirSync(shotsDir, { recursive: true });
  const previewDir = join(tmpdir(), 'kestrel-shots');
  mkdirSync(previewDir, { recursive: true });

  const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
  server.stdout.on('data', (chunk) => process.stdout.write(`[serve] ${chunk}`));
  try {
    await waitForServer();
    const { chromium } = await loadPlaywright();
    const browser = await chromium.launch({
      executablePath: findChromium(),
      args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader'],
    });
    try {
      for (const shot of shots) {
        const page = await browser.newPage({ viewport: VIEWPORT });
        await page.goto(`${BASE}/${shot.query}`, { waitUntil: 'load', timeout: 30000 });
        await page.waitForFunction(() => window.__shotReady === true, null, { timeout: 30000 });
        const shotError = await page.evaluate(() => window.__shotError ?? null);
        if (shotError) fail(`${shot.name}: the game reported ${shotError} (WebGL unavailable?)`);
        let buffer = await page.screenshot({ type: 'png' });
        let finalName = shot.name;
        if (buffer.length > MAX_BYTES) {
          for (const quality of [0.88, 0.78, 0.68]) {
            buffer = await toJpeg(page, buffer, quality);
            if (buffer.length <= MAX_BYTES) break;
          }
          finalName = shot.name.replace(/\.png$/i, '.jpg');
        }
        if (buffer.length > MAX_BYTES) fail(`${shot.name}: still ${buffer.length} bytes after JPEG fallback (gate is ${MAX_BYTES})`);
        const base = finalName.replace(/\.(png|jpe?g)$/i, '');
        for (const stale of [`${base}.png.b64`, `${base}.jpg.b64`, `${base}.jpeg.b64`]) {
          rmSync(join(shotsDir, stale), { force: true });
        }
        writeFileSync(join(shotsDir, `${finalName}.b64`), wrapBase64(buffer));
        writeFileSync(join(previewDir, finalName), buffer);
        console.log(`${finalName}: ${buffer.length} bytes -> screenshots/${finalName}.b64 (preview in ${previewDir})`);
        await page.close();
      }
    } finally {
      await browser.close();
    }
  } finally {
    server.kill('SIGTERM');
  }
  console.log('Done. Now verify the dossier: MAKEFUN_OUTPUT_DIR=out node main.ts');
}

await main();
