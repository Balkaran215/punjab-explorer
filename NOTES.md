# Notes

## Status (2026-10-28)
- v1 is live and tested with synthetic GPX and iPhone-format Timeline data, at desktop and phone sizes.
- Not yet tested with a **real** Google Maps Timeline export. That's the first thing to check when the owner sends one. Export formats change, and `parseTimeline` is the likely place to fix.

## Known limitations
- **Pind coverage:** OSM has about 7,900 named places in Punjab, against about 12,500 census villages. Where villages are missing, one cell covers several villages and takes the nearest mapped name. Better source: SHRUG / Development Data Lab 2011 village polygons (free, needs sign-up), which `build_pinds.py` could use instead of Voronoi cells.
- **Estimated lines are straight.** They don't follow roads.
- **No sync between devices.** Data lives in each browser's IndexedDB, and the backup file is the manual sync.
- **Timeline accuracy:** Google's path points can be sparse or snapped, so a quick drive past a village may miss lighting it.
- **Places outside Punjab** (Chandigarh, Himachal border) are kept as points inside `KEEP_BOX` but can't light up (there's no cell for them).

## Ideas (not built)
- "Track live" button: `navigator.geolocation.watchPosition` while the app is open, to add precise points.
- Route estimated gaps along roads (OSRM public API), still drawn dotted.
- Permanent name labels on lit pinds at high zoom.
- Share image: render the explored map to a PNG to show people.
- Per-day stats (km travelled, new pinds that day) in the slider panel.
- Achievement-style messages ("First pind in Moga district!").
