# CLAUDE.md

Punjab Explorer: a fog-of-war travel map PWA. The owner is visiting Indian Punjab for about a month (from Oct 2026). Every pind (village) starts dark and lights up once visited, and the travel path changes color after each stop. Plain static site: no build step, no framework, no npm.

Live: https://balkaran215.github.io/punjab-explorer/ (GitHub Pages from `master`, repo `Balkaran215/punjab-explorer`). Pushing to `master` redeploys in about 1 min.

## Key constraint
iPhone gives web apps no background GPS. **Recording is done by Google Maps Timeline** (or Open GPX Tracker). The app is only a viewer that imports those export files. Don't try to "add tracking" without explaining this.

## Files
- `index.html`: layout, HUD, menu, help dialog. Leaflet 1.9.4 from unpkg (pinned).
- `app.js`: everything, in sections:
  - settings consts at the top (stop radius/time, gap thresholds, colors, `KEEP_BOX`)
  - `db`: IndexedDB key-value wrapper (one cached connection). Stores `{points:[[t,lat,lng]], visits:[[start,end,lat,lng]]}`
  - parsers: `parseTimeline` (iPhone array export, Android `semanticSegments`, old Takeout `locations`/`timelineObjects`, own backup `{app:'punjab-explorer'}`), `parseGpx`
  - `mergeData`: filters to `KEEP_BOX`, sorts, drops points < 5 s apart, dedupes visits by start time
  - pind lookup: `buildIndex` grid (0.02°) + `pindAt` point-in-polygon
  - `analyse(until)`: `detectStops` + Timeline visits → `mergeStops` → arrive/leave nodes → colored runs (real vs estimated) and per-pind visits
  - `render()`: restyles pinds, redraws path/stops, updates stats and the day slider
  - live tracking: `startLive`/`stopLive`/`onLivePosition` use `watchPosition` while the app is open, plus a Wake Lock. Fixes over 100 m accuracy are dropped. A point is recorded after moving 15 m or every 60 s while still. Render is throttled to 15 s and saves to 30 s. It auto-resumes on launch if it was left on (`localStorage.live`). iPhone pauses it when the screen locks.
- `style.css`: dark theme tokens in `:root`. `[hidden]{display:none!important}` is needed because of flex/display rules.
- `sw.js`: app files network-first, tiles cache-first. **Bump `APP`/`TILES` cache names when changing cached file lists.**
- `data/punjab_pinds.json`: about 7,900 Voronoi cells (props: `name`, `pa`, `kind`, `district`, `lat`, `lng`). `data/punjab_outline.json`: state border.
- `tools/build_pinds.py`: regenerates data from OSM Overpass (cached in `tools/cache/`, gitignored).
- `tools/make_test_data.py`: writes `tools/test/trip.gpx` and `tools/test/timeline.json` (synthetic Amritsar→Jalandhar and Ludhiana→Moga trips).

## Behaviour rules (current values)
- Stop: within 150 m for ≥ 10 min (also any Timeline `visit`). Stops within 5 min / 300 m merge.
- New path color: after leaving a stop, or after a data gap > 2 h.
- Estimated (dotted) line: gap > 10 min **and** > 1 km. It does **not** light pinds.
- Real lines are sampled every 250 m to light pinds passed through. Hits in the same pind < 30 min apart form one visit.
- All times shown in IST (`Asia/Kolkata`).

## Rendering gotchas
- Separate Leaflet panes/canvas renderers: `fog` (410) < `path` (420) < `stops` (430). Lit pinds call `bringToFront()`, so sharing a renderer with paths hides the path.
- Basemaps: OSM standard + Esri satellite. CARTO tiles now need an API key (they show an "API KEY REQUIRED" watermark), so don't switch back.
- Pind tooltips use a function (`pindTooltip`) so content is built on open. Don't loop over 7.9k layers to set content.

## Environment (Windows)
- No system `python`. Use `.venv/Scripts/python.exe` in this folder (shapely, numpy, requests, pillow), or `py`.
- No node/npm. `gh` is at `C:\Program Files\GitHub CLI\gh.exe` (logged in as Balkaran215).
- `curl` fails on HTTPS here (schannel). Use Python `requests` for network checks.

## Testing
No test framework. To check behaviour:
1. `.venv/Scripts/python.exe -m http.server 8765` from the repo root (background).
2. Make a temporary root-level `_test.html`: copy `index.html` and add a script after `app.js` that waits for `pinds.length && pindLayer`, fetches `tools/test/*` into `File`s, runs `mergeData`/`refreshDays`/`render`, and `console.log`s a JSON summary (`result.stops`, `result.runs`, `result.visited`). **Skip `db.set`**: IndexedDB is extremely slow under headless virtual time.
3. Run headless Chrome with a fresh profile dir each time:
   `chrome.exe --headless=new --user-data-dir=$TEMP/pe-$RANDOM --enable-logging=stderr --v=0 --virtual-time-budget=60000 --dump-dom URL`, and grep stderr for `CONSOLE`. Use `--screenshot=... --window-size=420,860` for a phone view.
4. Expected with both test files: 4 stops, 62 pinds lit, 6 districts, 2 estimated runs.
   Live tracking: override `navigator.geolocation` with `Object.defineProperty` and a fake `watchPosition` that replays fixes, then click `#btn-live`.
   Test pages need `<meta charset="utf-8">`, or `⋯` renders garbled.
5. Delete `_test.html` and stop only that server process (match `http.server 8765` on the command line; never kill all python.exe).

## Conventions
- Match existing style: 2-space JS, single quotes, small helpers, comments only where non-obvious.
- Location data must never leave the device. No analytics, no uploads.
- Commit messages end with the Co-Authored-By line. Push to `master` to deploy.

See `NOTES.md` for status, known limitations and ideas.
