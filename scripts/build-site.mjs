// Assembles _site/ for GitHub Pages: landing page + runtime files of every game (no docs/specs/tools/screenshots).
// Plain Node, no dependencies. Usage: node scripts/build-site.mjs
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { dirname, join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '_site');
const G = (p) => join(ROOT, 'games', p);

// corner: where the "All games" link sits, picked so it stays clear of each game's HUD.
const GAMES = [
  { id: 'halcyon-drift', src: G('halcyon-drift/explorer'), include: ['index.html', 'style.css', 'src', 'assets'], corner: 'bottom-center' },
  { id: 'black-powder', src: G('black-powder'), include: ['index.html', 'style.css', 'src'], corner: 'top-left-offset' },
  {
    id: 'fogbound-walk', src: G('fogbound-walk'), corner: 'top-left',
    // root-level scripts + only the assets referenced at runtime (beast.js, textures.js)
    include: [
      'index.html',
      ...readdirSync(G('fogbound-walk')).filter((f) => extname(f) === '.js'),
      'assets/fleshbeast.glb', 'assets/fleshbeast_anim_v6.glb', 'assets/refmatch', 'assets/refmatch2',
    ],
  },
  {
    id: 'hive-walker', src: G('hive-walker'), corner: 'bottom-center',
    include: ['index.html', 'js', ...readdirSync(G('hive-walker/model')).filter((f) => f.endsWith('.glb')).map((f) => 'model/' + f)],
  },
  { id: 'tank-combat', src: G('tank-combat'), vite: true, corner: 'bottom-center' },
];

const CORNERS = {
  'top-left': 'top:8px;left:8px',
  'top-left-offset': 'top:8px;left:296px',
  'top-center': 'top:6px;left:50%;transform:translateX(-50%)',
  'bottom-left': 'bottom:8px;left:8px',
  'bottom-center': 'bottom:6px;left:50%;transform:translateX(-50%)',
};

// Tiny link back to the hub; hidden while the pointer is locked so it never gets in the way of play.
function backLink(corner) {
  return `
<a id="all-games-link" href="../" style="position:fixed;${CORNERS[corner]};z-index:2147483000;font:11px/1 system-ui,Segoe UI,Arial,sans-serif;letter-spacing:.04em;color:#cfd6e4;background:rgba(10,12,18,.55);border:1px solid rgba(255,255,255,.18);border-radius:4px;padding:5px 8px;text-decoration:none;opacity:.55;pointer-events:auto">&larr; All games</a>
<script>(function(){var a=document.getElementById('all-games-link');function s(){a.style.display=document.pointerLockElement?'none':''}document.addEventListener('pointerlockchange',s);a.addEventListener('mouseenter',function(){a.style.opacity=1});a.addEventListener('mouseleave',function(){a.style.opacity=.55})})();</script>
`;
}

function injectBackLink(dir, corner) {
  const f = join(dir, 'index.html');
  const html = readFileSync(f, 'utf8');
  if (!html.includes('</body>')) throw new Error(`no </body> in ${f}`);
  writeFileSync(f, html.replace('</body>', backLink(corner) + '</body>'));
}

const log = (m) => console.log(`[build-site] ${m}`);

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

// landing page
cpSync(join(ROOT, 'site'), OUT, { recursive: true });
writeFileSync(join(OUT, '.nojekyll'), '');
log('landing page copied');

for (const g of GAMES) {
  const dest = join(OUT, g.id);
  if (g.vite) {
    if (!existsSync(join(g.src, 'node_modules'))) execSync('npm ci', { cwd: g.src, stdio: 'inherit' });
    execSync('npm run build', { cwd: g.src, stdio: 'inherit' });
    cpSync(join(g.src, 'dist'), dest, { recursive: true });
  } else {
    mkdirSync(dest, { recursive: true });
    for (const rel of g.include) {
      const from = join(g.src, rel);
      if (!existsSync(from)) throw new Error(`${g.id}: missing ${rel}`);
      cpSync(from, join(dest, rel), { recursive: true });
    }
  }
  injectBackLink(dest, g.corner);
  log(`${g.id} done`);
}

// summary
let bytes = 0, files = 0;
(function walk(d) { for (const e of readdirSync(d)) { const p = join(d, e), s = statSync(p); if (s.isDirectory()) walk(p); else { bytes += s.size; files++; } } })(OUT);
log(`_site ready: ${files} files, ${(bytes / 1048576).toFixed(1)} MB`);
