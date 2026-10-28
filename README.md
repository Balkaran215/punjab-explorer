# Punjab Explorer

A fog-of-war map of Punjab. Every pind starts dark and lights up once you've been there. Your travel path is drawn in a new color after each stop.

- **Record:** Google Maps Timeline on your iPhone. Tap *How to record on iPhone* in the app's ⋯ menu.
- **Import:** tap *Import location file* and pick the Timeline export (`.json`) or a `.gpx` file.
- **Privacy:** your location stays in the browser on that device (IndexedDB). It's never uploaded. Use *Save backup file* / *Load backup file* to move it between phone and computer.

## How it works
- Stop = staying within 150 m for 10+ min. The line gets a new color each time you leave a stop.
- No signal for 10+ min while you moved more than 1 km = dotted "estimated" line. Those stretches don't light up pinds.
- Pinds are Voronoi cells around every OpenStreetMap village/town point, clipped to the Punjab border (`tools/build_pinds.py`).
- Settings are at the top of `app.js`.

## Run locally
    python -m http.server 8000      # then open http://localhost:8000

## Rebuild map data
    py -m venv .venv && .venv/Scripts/pip install shapely numpy requests
    .venv/Scripts/python tools/build_pinds.py
