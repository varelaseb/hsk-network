# AGENTS.md

Spec format: spec-chat

Canonical spec: [docs/specs/hsk-network.spec.html](docs/specs/hsk-network.spec.html). It owns behavior, data rules, and acceptance.

## Layout

- `site/`: published directory, served unchanged by GitHub Pages. `index.html`, `app.js`, `style.css`, `vendor/d3.v7.min.js` (pinned, ISC), `data/graph.json` (built, committed).
- `data/`: vendored HSK 2.0 lists (copied unchanged, source URL and commit noted beside them) and the match override file.
- `site/bubbles/`: HSK bubbles game. `rules.js` is the pure game rules module (exports documented at its top).
- `scripts/build_data.py`: data pipeline. Writes `site/data/graph.json`.
- `tests/`: unittest suite; `tests/bubbles/*.test.mjs`: game rule tests (Node built-in test runner).
- `docs/specs/`: canonical specs. Never published.
- `.github/workflows/`: `ci.yml` (tests), `pages.yml` (deploy `site/`).

## Commands

Python 3 and Node 22+ standard libraries only. Nothing to install, no `package.json`.

- Build data: `python3 scripts/build_data.py`
- Test: `python3 -m unittest discover -s tests -v && node --test 'tests/**/*.test.mjs'`
- Preview: `python3 -m http.server -d site 8000`

## Data refresh

1. Run the build. It downloads CC-CEDICT into an ignored cache; never commit the cache.
2. If it names failing entries, add one override per entry in `data/` (CC-CEDICT Traditional form, pinyin, one-line reason) and rebuild.
3. Run the tests, then commit `site/data/graph.json` deliberately; its diff shows what changed.

## Validation

- Every change: the test command passes (Python suite, then Node rule tests).
- Game rules changes (`site/bubbles/rules.js`): keep it free of DOM, timers, `Math.random`, and storage; add or update a rule test in `tests/bubbles/`.
- Site changes: preview locally and check the spec acceptance criteria touched.
- The site loads only its own files: no CDN, API, key, or third-party request.

## Delivery

- CI: `ci.yml` runs the test command (both suites) on every pull request and push to main.
- Hosting: `pages.yml` publishes `site/` unchanged to GitHub Pages on every push to main via `actions/deploy-pages`. Repo setting Pages source must be "GitHub Actions".
