"""Write synthetic trips to tools/test/ for checking the app.

trip.gpx       day 1: home in Amritsar 30 min -> drive -> shop 15 min -> 40 min no signal -> Jalandhar
timeline.json  day 2: same shape as an iPhone Google Maps Timeline export
"""
import json, pathlib
from datetime import datetime, timedelta, timezone

OUT = pathlib.Path(__file__).parent / "test"
IST = timezone(timedelta(hours=5, minutes=30))

def lerp(a, b, n):
    return [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1)]

t = datetime(2026, 10, 20, 9, 0, tzinfo=IST)
pts = []
home, shop, gap_start, gap_end, jal = (31.6340, 74.8723), (31.5400, 75.0500), (31.4800, 75.1800), (31.3800, 75.4200), (31.3260, 75.5762)
for i in range(31):                      # at home 30 min (tiny jitter)
    pts.append((t, home[0] + (i % 3) * 0.0002, home[1])); t += timedelta(minutes=1)
for p in lerp(home, shop, 20)[1:]:       # drive 20 min
    pts.append((t, *p)); t += timedelta(minutes=1)
for i in range(15):                      # shop 15 min
    pts.append((t, shop[0], shop[1] + (i % 2) * 0.0003)); t += timedelta(minutes=1)
for p in lerp(shop, gap_start, 10)[1:]:  # drive 10 min
    pts.append((t, *p)); t += timedelta(minutes=1)
t += timedelta(minutes=40)               # no signal
for p in lerp(gap_end, jal, 12):         # drive into Jalandhar
    pts.append((t, *p)); t += timedelta(minutes=1)

trk = "\n".join(f'<trkpt lat="{la:.6f}" lon="{lo:.6f}"><time>{tt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}</time></trkpt>' for tt, la, lo in pts)
(OUT / "trip.gpx").write_text(f'<?xml version="1.0"?>\n<gpx version="1.1" creator="test"><trk><trkseg>\n{trk}\n</trkseg></trk></gpx>\n')

d = datetime(2026, 10, 21, 10, 0, tzinfo=IST)
iso = lambda x: x.isoformat(timespec="milliseconds")
ludhiana, moga = (30.9010, 75.8573), (30.8165, 75.1717)
timeline = [
    {"startTime": iso(d), "endTime": iso(d + timedelta(minutes=50)),
     "visit": {"hierarchyLevel": "0", "topCandidate": {"probability": "0.9", "semanticType": "Unknown", "placeID": "x", "placeLocation": f"geo:{ludhiana[0]},{ludhiana[1]}"}}},
    {"startTime": iso(d + timedelta(minutes=50)), "endTime": iso(d + timedelta(minutes=125)),
     "activity": {"start": f"geo:{ludhiana[0]},{ludhiana[1]}", "end": f"geo:{moga[0]},{moga[1]}", "distanceMeters": "68000", "topCandidate": {"type": "in passenger vehicle", "probability": "0.9"}}},
    {"startTime": iso(d + timedelta(minutes=50)), "endTime": iso(d + timedelta(minutes=125)),
     "timelinePath": [{"point": f"geo:{la:.6f},{lo:.6f}", "durationMinutesOffsetFromStartTime": str(i * 5)} for i, (la, lo) in enumerate(lerp(ludhiana, moga, 15))]},
    {"startTime": iso(d + timedelta(minutes=125)), "endTime": iso(d + timedelta(minutes=185)),
     "visit": {"hierarchyLevel": "0", "topCandidate": {"probability": "0.8", "semanticType": "Unknown", "placeID": "y", "placeLocation": f"geo:{moga[0]},{moga[1]}"}}},
]
(OUT / "timeline.json").write_text(json.dumps(timeline, indent=1))
print(len(pts), "gpx points;", len(timeline), "timeline segments")
