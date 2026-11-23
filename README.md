# Game Prototypes

A monorepo of playable three.js browser game prototypes, published together as one GitHub Pages site
(https://tokko.github.io/game-prototypes/) with a landing page that links to each game.

## Games

| Game | Source | Site path | Run locally |
| --- | --- | --- | --- |
| Halcyon Drift (Solar System Explorer) | `games/halcyon-drift/explorer/` | `/halcyon-drift/` | static, serve the folder |
| Halcyon Drift orbital prototype (not deployed) | `games/halcyon-drift/prototype/` | none | static, serve the folder |
| The Amber Field (Napoleonic battle) | `games/black-powder/` | `/black-powder/` | static, serve the folder |
| Fogbound Walk (first-person horror walk) | `games/fogbound-walk/` | `/fogbound-walk/` | static, serve the folder |
| Hive Walker (war-walker action) | `games/hive-walker/` | `/hive-walker/` | static, serve the folder |
| Tank Combat Sim | `games/tank-combat/` | `/tank-combat/` | Vite: `npm ci && npm run dev` |

The static games are plain ES modules with no build step; three.js comes from jsDelivr through an importmap, so you
need an internet connection. To run one on its own, serve its folder with any static server, for example:

    python -m http.server 8000 --directory games/black-powder

and open http://localhost:8000/. Tank Combat Sim uses the `three` npm package and Vite:

    cd games/tank-combat
    npm ci
    npm run dev        # dev server
    npm run build      # production build into dist/ (base './', works from any subpath)

Each game has its own README or in-game help with controls. Needs a desktop browser with WebGL2.

## Building and previewing the whole site

Requires Node 20+ (CI uses 22). No dependencies at the repo root.

    npm run build      # assembles _site/ (landing page + every game)
    npm run serve      # serves _site/ at http://localhost:8080/

`scripts/build-site.mjs` copies only the runtime files of each game (no docs, specs, tools, tests, screenshots or
unused assets), runs the Tank Combat Sim build (installing its dependencies on first run), copies the landing page
from `site/`, and injects a small "All games" link into each game page (hidden while the pointer is locked).
`_site/` is gitignored.

The landing page lives in `site/` (`index.html`, `style.css`, `thumbs/`). To add a game, add a card there and an entry
to the `GAMES` list in `scripts/build-site.mjs`.

## Deployment

`.github/workflows/pages.yml` builds the site and deploys `_site/` with GitHub Pages on every push to `main` (or
manually via "Run workflow"). In the repository settings, set Pages > Source to "GitHub Actions". All game paths are
relative, so the site works under the `/game-prototypes/` project subpath.
