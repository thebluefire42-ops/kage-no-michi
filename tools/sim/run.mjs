// Runs a sim suite in parallel headless Chrome processes and saves the results.
//   node tools/sim/run.mjs <suite> [--shards N]        suites: smoke, weapons, enemies, pairs, cards, vision, all
// Results go to tools/sim/results/<suite>.json; then `node tools/sim/report.mjs` builds the report page.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir, cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const args = process.argv.slice(2);
const suiteArg = args.find((a) => !a.startsWith('--')) || 'smoke';
const shards = +(args[args.indexOf('--shards') + 1] || 0) || Math.max(1, cpus().length - 2);
const PORT = 5197;
const CHROME = [
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => existsSync(p));
if (!CHROME) { console.error('Chrome not found'); process.exit(1); }

const server = spawn(process.execPath, [path.join(root, 'serve.js'), root, String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

function runShard(suite, shard) {
  return new Promise((resolve) => {
    const prof = mkdtempSync(path.join(tmpdir(), 'kgsim-'));
    const url = `http://localhost:${PORT}/tools/sim/sim.html?suite=${suite}&shard=${shard}&of=${shards}`;
    const ch = spawn(CHROME, ['--headless=new', '--mute-audio', '--disable-gpu', '--no-first-run', '--disable-extensions',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      `--user-data-dir=${prof}`, '--virtual-time-budget=100000000', '--dump-dom', url], { stdio: ['ignore', 'pipe', 'ignore'] });
    let buf = '';
    ch.stdout.on('data', (d) => { buf += d; });
    ch.on('close', () => {
      try { rmSync(prof, { recursive: true, force: true }); } catch { /* chrome may still hold it */ }
      const m = buf.match(/SIMJSON([\s\S]*?)SIMEND/);
      if (!m) return resolve({ fatal: `shard ${shard}: no output` });
      // (the DOM dump escapes &, < and >)
      resolve(JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
    });
  });
}

const suites = suiteArg === 'all' ? ['weapons', 'enemies', 'pairs', 'cards', 'vision'] : [suiteArg];
mkdirSync(path.join(here, 'results'), { recursive: true });
try {
  for (const suite of suites) {
    const t0 = Date.now();
    process.stdout.write(`${suite}: ${shards} shards… `);
    const parts = await Promise.all(Array.from({ length: shards }, (_, i) => runShard(suite, i)));
    const fatal = parts.filter((p) => p.fatal);
    if (fatal.length) console.log('\n', fatal.map((f) => f.fatal).join('\n'));
    const results = parts.flatMap((p) => p.results || []).sort((a, b) => a.id - b.id);
    const errs = results.filter((r) => r.err);
    writeFileSync(path.join(here, 'results', `${suite}.json`), JSON.stringify({ suite, at: new Date().toISOString(), results }));
    console.log(`${results.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)} s${errs.length ? `, ${errs.length} errors (first: ${errs[0].err.split('\n')[0]})` : ''}`);
  }
} finally { server.kill(); }
