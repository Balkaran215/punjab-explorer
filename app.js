'use strict';

// ---------- settings ----------
const STOP_RADIUS_M = 150;          // staying within this distance...
const STOP_MIN_MS = 10 * 60e3;      // ...for this long counts as a stop
const GAP_MS = 10 * 60e3;           // no signal for longer than this...
const GAP_M = 1000;                 // ...while moving further than this = estimated line
const SAMPLE_M = 250;               // spacing when checking which pinds a line passes through
const SAME_VISIT_MS = 30 * 60e3;    // hits in one pind closer than this = one visit
const NEW_COLOR_GAP_MS = 2 * 3600e3; // no data for this long (e.g. overnight) also starts a new color
const KEEP_BOX = [29.0, 72.8, 33.3, 77.9]; // lat/lng box around Punjab; points outside are ignored
const PATH_COLORS = ['#e6194b', '#f58231', '#3cb44b', '#4363d8', '#911eb4',
  '#f032e6', '#008080', '#c79a00', '#9a6324', '#000075'];
const IST = 'Asia/Kolkata';

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const fmtTime = new Intl.DateTimeFormat('en-IN', { timeZone: IST, hour: 'numeric', minute: '2-digit', hour12: true });
const fmtDate = new Intl.DateTimeFormat('en-IN', { timeZone: IST, weekday: 'short', day: 'numeric', month: 'short' });
const fmtDateTime = (t) => `${fmtDate.format(t)}, ${fmtTime.format(t)}`;
const istDay = (t) => new Date(t + 5.5 * 3600e3).toISOString().slice(0, 10);
const istDayEnd = (day) => Date.parse(`${day}T23:59:59.999+05:30`);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function distM(aLat, aLng, bLat, bLng) {
  const k = Math.PI / 180;
  const x = (bLng - aLng) * k * Math.cos(((aLat + bLat) / 2) * k);
  const y = (bLat - aLat) * k;
  return Math.sqrt(x * x + y * y) * 6371e3;
}

function fmtDuration(ms) {
  const m = Math.round(ms / 60e3);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
}

function toast(msg, ms = 3500) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { el.hidden = true; }, ms);
}

// ---------- storage (IndexedDB, this device only) ----------
const db = {
  open() {
    return this.conn ??= new Promise((resolve, reject) => {
      const req = indexedDB.open('punjab-explorer', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async get(key) {
    const d = await this.open();
    return new Promise((resolve, reject) => {
      const req = d.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async set(key, value) {
    const d = await this.open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  },
};

// Stored shape: { points: [[t, lat, lng]...], visits: [[start, end, lat, lng]...] }
let store = { points: [], visits: [] };

// ---------- file parsers ----------
function parseLatLng(v) {
  if (v == null) return null;
  if (typeof v === 'string') {
    const m = v.match(/(-?\d+(?:\.\d+)?)°?\s*,\s*(-?\d+(?:\.\d+)?)/);
    return m ? [+m[1], +m[2]] : null;
  }
  if (typeof v === 'object') {
    if ('latitudeE7' in v) return [v.latitudeE7 / 1e7, v.longitudeE7 / 1e7];
    if ('latE7' in v) return [v.latE7 / 1e7, v.lngE7 / 1e7];
    return parseLatLng(v.latLng ?? v.LatLng ?? v.point ?? v.placeLocation);
  }
  return null;
}

const parseTime = (v) => (v == null ? NaN : /^\d+$/.test(String(v)) ? +v : Date.parse(v));

function parseTimeline(json) {
  const points = [];
  const visits = [];
  const addPoint = (t, ll) => { if (ll && Number.isFinite(t)) points.push([t, ll[0], ll[1]]); };
  const addVisit = (s, e, ll) => { if (ll && Number.isFinite(s) && Number.isFinite(e)) visits.push([s, e, ll[0], ll[1]]); };

  // Our own backup file
  if (json && json.app === 'punjab-explorer') return { points: json.points || [], visits: json.visits || [] };

  // Newer on-device Timeline export (iPhone: a plain array; Android: {semanticSegments})
  const segments = Array.isArray(json) ? json : json.semanticSegments;
  if (Array.isArray(segments)) {
    for (const seg of segments) {
      const s = parseTime(seg.startTime);
      const e = parseTime(seg.endTime);
      if (seg.visit) addVisit(s, e, parseLatLng(seg.visit.topCandidate?.placeLocation));
      if (seg.activity) {
        addPoint(s, parseLatLng(seg.activity.start));
        addPoint(e, parseLatLng(seg.activity.end));
      }
      for (const p of seg.timelinePath || []) {
        const t = p.time ? parseTime(p.time) : s + (+p.durationMinutesOffsetFromStartTime || 0) * 60e3;
        addPoint(t, parseLatLng(p.point));
      }
    }
  }
  for (const r of json.rawSignals || []) {
    if (r.position) addPoint(parseTime(r.position.timestamp), parseLatLng(r.position.LatLng ?? r.position.latLng));
  }

  // Older Google Takeout: Records.json
  for (const r of json.locations || []) addPoint(parseTime(r.timestamp ?? r.timestampMs), parseLatLng(r));

  // Older Google Takeout: Semantic Location History
  for (const o of json.timelineObjects || []) {
    if (o.placeVisit) {
      const d = o.placeVisit.duration || {};
      addVisit(parseTime(d.startTimestamp ?? d.startTimestampMs), parseTime(d.endTimestamp ?? d.endTimestampMs), parseLatLng(o.placeVisit.location));
    }
    if (o.activitySegment) {
      const a = o.activitySegment;
      const d = a.duration || {};
      addPoint(parseTime(d.startTimestamp ?? d.startTimestampMs), parseLatLng(a.startLocation));
      for (const p of a.simplifiedRawPath?.points || []) addPoint(parseTime(p.timestamp ?? p.timestampMs), parseLatLng(p));
      addPoint(parseTime(d.endTimestamp ?? d.endTimestampMs), parseLatLng(a.endLocation));
    }
  }
  return { points, visits };
}

function parseGpx(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const points = [];
  for (const el of doc.querySelectorAll('trkpt, rtept, wpt')) {
    const t = Date.parse(el.querySelector('time')?.textContent);
    if (Number.isFinite(t)) points.push([t, +el.getAttribute('lat'), +el.getAttribute('lon')]);
  }
  return { points, visits: [] };
}

function inKeepBox(lat, lng) {
  return lat >= KEEP_BOX[0] && lat <= KEEP_BOX[2] && lng >= KEEP_BOX[1] && lng <= KEEP_BOX[3];
}

// Merge new data into the store; returns how many points were new.
function mergeData(incoming) {
  const before = store.points.length;
  const pts = store.points.concat(incoming.points.filter((p) => inKeepBox(p[1], p[2])));
  pts.sort((a, b) => a[0] - b[0]);
  const kept = [];
  for (const p of pts) {
    const last = kept[kept.length - 1];
    // drop exact duplicates and anything logged less than 5 s after the previous point
    if (last && p[0] - last[0] < 5000) continue;
    kept.push([p[0], +p[1].toFixed(6), +p[2].toFixed(6)]);
  }
  const seenVisit = new Set(store.visits.map((v) => v[0]));
  const visits = store.visits.slice();
  for (const v of incoming.visits) {
    if (!seenVisit.has(v[0]) && inKeepBox(v[2], v[3])) { seenVisit.add(v[0]); visits.push(v); }
  }
  visits.sort((a, b) => a[0] - b[0]);
  store = { points: kept, visits };
  return kept.length - before;
}

// ---------- pind lookup (grid index + point in polygon) ----------
const GRID = 0.02;
let pinds = [];          // GeoJSON features
const grid = new Map();  // "x,y" -> [feature index]

function ringContains(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function polyContains(geom, lng, lat) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
  return polys.some((rings) => ringContains(rings[0], lng, lat) && !rings.slice(1).some((h) => ringContains(h, lng, lat)));
}

function buildIndex() {
  pinds.forEach((f, i) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    for (const rings of polys) for (const [x, y] of rings[0]) {
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    }
    for (let gx = Math.floor(minX / GRID); gx <= Math.floor(maxX / GRID); gx++) {
      for (let gy = Math.floor(minY / GRID); gy <= Math.floor(maxY / GRID); gy++) {
        const key = `${gx},${gy}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(i);
      }
    }
  });
}

function pindAt(lat, lng) {
  const cell = grid.get(`${Math.floor(lng / GRID)},${Math.floor(lat / GRID)}`);
  if (!cell) return -1;
  for (const i of cell) if (polyContains(pinds[i].geometry, lng, lat)) return i;
  return -1;
}

// ---------- analysis: stops, path, visited pinds ----------
function detectStops(points) {
  const stops = [];
  let i = 0;
  while (i < points.length) {
    let j = i;
    while (j + 1 < points.length && distM(points[i][1], points[i][2], points[j + 1][1], points[j + 1][2]) < STOP_RADIUS_M) j++;
    if (points[j][0] - points[i][0] >= STOP_MIN_MS) {
      let lat = 0, lng = 0;
      for (let k = i; k <= j; k++) { lat += points[k][1]; lng += points[k][2]; }
      const n = j - i + 1;
      stops.push([points[i][0], points[j][0], lat / n, lng / n]);
      i = j + 1;
    } else {
      i++;
    }
  }
  return stops;
}

function mergeStops(stops) {
  stops.sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const s of stops) {
    const last = out[out.length - 1];
    if (last && s[0] <= last[1] + 5 * 60e3 && distM(last[2], last[3], s[2], s[3]) < STOP_RADIUS_M * 2) {
      last[1] = Math.max(last[1], s[1]);
    } else {
      out.push(s.slice());
    }
  }
  return out;
}

function analyse(until) {
  const points = store.points.filter((p) => p[0] <= until);
  const visits = store.visits.filter((v) => v[0] <= until).map((v) => [v[0], Math.min(v[1], until), v[2], v[3]]);
  const stops = mergeStops(detectStops(points).concat(visits));

  // Timeline of nodes: moving points, plus an arrive/leave pair for every stop.
  const nodes = [];
  let si = 0;
  for (const p of points) {
    while (si < stops.length && stops[si][1] < p[0]) si++;
    if (si < stops.length && p[0] >= stops[si][0] && p[0] <= stops[si][1]) continue; // jitter while stopped
    nodes.push({ t: p[0], lat: p[1], lng: p[2] });
  }
  stops.forEach((s, k) => {
    nodes.push({ t: s[0], lat: s[2], lng: s[3], arrive: k });
    nodes.push({ t: s[1] + 1, lat: s[2], lng: s[3], leave: k });
  });
  nodes.sort((a, b) => a.t - b.t);

  // Walk the nodes into colored runs; a new color starts every time you leave a stop.
  const runs = [];
  const hits = []; // [pindIndex, from, to]
  let color = 0;
  let run = null;
  const stopColor = [];
  for (let k = 1; k < nodes.length; k++) {
    const a = nodes[k - 1];
    const b = nodes[k];
    if (a.leave !== undefined || (b.t - a.t > NEW_COLOR_GAP_MS && a.arrive === undefined)) color++;
    if (b.arrive !== undefined) stopColor[b.arrive] = color;
    if (a.arrive !== undefined && b.leave === a.arrive) { run = null; continue; } // sitting at the stop

    const d = distM(a.lat, a.lng, b.lat, b.lng);
    const estimated = b.t - a.t > GAP_MS && d > GAP_M;
    if (!run || run.color !== color || run.estimated !== estimated) {
      run = { color, estimated, latlngs: [[a.lat, a.lng]], start: a.t };
      runs.push(run);
    }
    run.latlngs.push([b.lat, b.lng]);
    run.end = b.t;

    if (!estimated) {
      const steps = Math.min(400, Math.ceil(d / SAMPLE_M));
      for (let s = 0; s <= steps; s++) {
        const f = steps ? s / steps : 0;
        const i = pindAt(a.lat + (b.lat - a.lat) * f, a.lng + (b.lng - a.lng) * f);
        const t = a.t + (b.t - a.t) * f;
        if (i >= 0) hits.push([i, t, t]);
      }
    }
  }
  if (nodes.length === 1) {
    const i = pindAt(nodes[0].lat, nodes[0].lng);
    if (i >= 0) hits.push([i, nodes[0].t, nodes[0].t]);
  }
  stops.forEach((s) => {
    const i = pindAt(s[2], s[3]);
    if (i >= 0) hits.push([i, s[0], s[1]]);
  });

  // Group hits into visits per pind.
  const visited = new Map(); // pindIndex -> [{arrive, leave, stopped}]
  hits.sort((x, y) => x[1] - y[1]);
  for (const [i, from, to] of hits) {
    if (!visited.has(i)) visited.set(i, []);
    const list = visited.get(i);
    const last = list[list.length - 1];
    if (last && from - last.leave < SAME_VISIT_MS) {
      last.leave = Math.max(last.leave, to);
    } else {
      list.push({ arrive: from, leave: to, stopped: 0 });
    }
  }
  stops.forEach((s) => {
    const list = visited.get(pindAt(s[2], s[3]));
    const v = list && list.find((x) => x.arrive <= s[1] && x.leave >= s[0]);
    if (v) v.stopped += s[1] - s[0];
  });

  return { runs, stops, stopColor, visited, last: nodes[nodes.length - 1] };
}

// ---------- map ----------
const map = L.map('map', { zoomControl: false, preferCanvas: true, minZoom: 7, maxZoom: 17, attributionControl: true });
L.control.zoom({ position: 'topright' }).addTo(map);
const streetTiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors', maxZoom: 19,
}).addTo(map);
const satelliteTiles = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Imagery &copy; Esri', maxZoom: 18,
});
L.control.layers({ Map: streetTiles, Satellite: satelliteTiles }, null, { position: 'topright' }).addTo(map);

// Separate panes so the path always sits above the fog and the stops above the path.
map.createPane('fog').style.zIndex = 410;
map.createPane('path').style.zIndex = 420;
map.createPane('stops').style.zIndex = 430;
const renderer = L.canvas({ padding: 0.3, pane: 'fog' });
const pathRenderer = L.canvas({ padding: 0.3, pane: 'path' });
const stopRenderer = L.canvas({ padding: 0.3, pane: 'stops' });
let pindLayer;
const pathLayer = L.layerGroup().addTo(map);
const stopLayer = L.layerGroup().addTo(map);
let result = { visited: new Map(), runs: [], stops: [], stopColor: [] };
let days = [];

const FOG = { fillColor: '#05070d', fillOpacity: 0.97, color: '#1a2236', weight: 0.6, opacity: 1 };
const LIT = { fillColor: '#ffc65c', fillOpacity: 0.1, color: '#ffb02e', weight: 1.6, opacity: 0.95 };

function pindTooltip(layer) {
  const f = layer.feature;
  const p = f.properties;
  const visits = result.visited.get(p._i);
  if (!visits) {
    return `<div class="locked"><div class="name">??? <span class="pa">unexplored</span></div><div class="district">${esc(p.district || 'Punjab')}</div></div>`;
  }
  const rows = visits.slice(-8).map((v) => {
    const when = istDay(v.arrive) === istDay(v.leave) && v.leave - v.arrive > 60e3
      ? `${fmtDateTime(v.arrive)} – ${fmtTime.format(v.leave)}`
      : fmtDateTime(v.arrive);
    const what = v.stopped ? `stopped ${fmtDuration(v.stopped)}` : 'passed through';
    return `<div class="visit">${when} <i>· ${what}</i></div>`;
  }).join('');
  const more = visits.length > 8 ? `<div class="visit"><i>+ ${visits.length - 8} earlier visits</i></div>` : '';
  return `<div class="name">${esc(p.name)}${p.pa ? `<span class="pa">${esc(p.pa)}</span>` : ''}</div>
    <div class="district">${esc(p.district)} · first visited ${fmtDateTime(visits[0].arrive)}</div>${more}${rows}`;
}

function render() {
  const dayIdx = +$('day').value;
  const until = days.length ? istDayEnd(days[Math.min(dayIdx, days.length - 1)]) : Infinity;
  result = analyse(until);

  pindLayer.setStyle((f) => (result.visited.has(f.properties._i) ? LIT : FOG));
  pindLayer.eachLayer((l) => { if (result.visited.has(l.feature.properties._i)) l.bringToFront(); });

  pathLayer.clearLayers();
  for (const r of result.runs) {
    const c = PATH_COLORS[r.color % PATH_COLORS.length];
    if (!r.estimated) L.polyline(r.latlngs, { renderer: pathRenderer, color: '#fff', weight: 7, opacity: 0.55, interactive: false }).addTo(pathLayer);
    const line = L.polyline(r.latlngs, {
      renderer: pathRenderer, color: c, weight: r.estimated ? 2.5 : 3.5, opacity: r.estimated ? 0.8 : 1,
      dashArray: r.estimated ? '2 9' : null, lineCap: 'round',
    }).addTo(pathLayer);
    line.bindTooltip(r.estimated
      ? `<b>Estimated route</b> (no signal)<br>${fmtDateTime(r.start)} → ${fmtDateTime(r.end)}`
      : `${fmtDateTime(r.start)} → ${fmtTime.format(r.end)}`, { sticky: true, className: 'pind-tip' });
  }

  stopLayer.clearLayers();
  result.stops.forEach((s, k) => {
    const c = PATH_COLORS[(result.stopColor[k] ?? 0) % PATH_COLORS.length];
    const i = pindAt(s[2], s[3]);
    const place = i >= 0 ? pinds[i].properties.name : 'Outside Punjab';
    L.circleMarker([s[2], s[3]], { renderer: stopRenderer, radius: 6, color: c, weight: 3, fillColor: '#fff', fillOpacity: 1 })
      .bindTooltip(`<div class="name">${esc(place)}</div><div class="visit">Stopped ${fmtDateTime(s[0])} – ${fmtTime.format(s[1])}<br><i>${fmtDuration(s[1] - s[0])}</i></div>`, { className: 'pind-tip' })
      .addTo(stopLayer);
  });

  const districts = new Set([...result.visited.keys()].map((i) => pinds[i].properties.district).filter(Boolean));
  $('stat-pinds').textContent = result.visited.size.toLocaleString('en-IN');
  $('stat-districts').textContent = districts.size;
  $('stat-stops').textContent = result.stops.length;
  $('stat-bar').style.width = `${Math.max(result.visited.size ? 0.5 : 0, (100 * result.visited.size) / pinds.length)}%`;
  $('day-label').textContent = days.length
    ? (dayIdx >= days.length - 1 ? `${fmtDate.format(Date.parse(days[days.length - 1]))} (latest)` : fmtDate.format(Date.parse(days[dayIdx])))
    : '';
}

function refreshDays() {
  const set = new Set(store.points.map((p) => istDay(p[0])).concat(store.visits.map((v) => istDay(v[0]))));
  days = [...set].sort();
  const slider = $('day');
  slider.max = Math.max(0, days.length - 1);
  slider.value = slider.max;
  $('timeline').hidden = days.length < 2;
}

// ---------- UI ----------
async function importFiles(files) {
  let added = 0;
  let failed = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      const data = text.trimStart().startsWith('<') ? parseGpx(text) : parseTimeline(JSON.parse(text));
      added += mergeData(data);
    } catch (e) {
      console.error(e);
      failed++;
    }
  }
  await db.set('data', store);
  refreshDays();
  render();
  toast(failed ? `Couldn't read ${failed} file(s). Added ${added} points.` : added ? `Added ${added.toLocaleString()} new points.` : 'No new points in Punjab found in that file.');
  if (added && result.last) map.flyTo([result.last.lat, result.last.lng], Math.max(map.getZoom(), 11));
}

$('file').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; });
$('backup').addEventListener('change', (e) => { importFiles([...e.target.files]); e.target.value = ''; $('menu').hidden = true; });
$('day').addEventListener('input', render);
$('btn-menu').addEventListener('click', () => { $('menu').hidden = !$('menu').hidden; });
$('btn-locate').addEventListener('click', () => {
  $('menu').hidden = true;
  if (result.last) map.flyTo([result.last.lat, result.last.lng], 13); else toast('Import a location file first.');
});
$('btn-export').addEventListener('click', () => {
  $('menu').hidden = true;
  const blob = new Blob([JSON.stringify({ app: 'punjab-explorer', ...store })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `punjab-explorer-backup-${istDay(Date.now())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
});
$('btn-help').addEventListener('click', () => { $('menu').hidden = true; $('help').showModal(); });
$('help-close').addEventListener('click', () => $('help').close());
$('btn-clear').addEventListener('click', () => { $('menu').hidden = true; $('confirm-clear').showModal(); });
$('clear-no').addEventListener('click', () => $('confirm-clear').close());
$('clear-yes').addEventListener('click', async () => {
  store = { points: [], visits: [] };
  await db.set('data', store);
  $('confirm-clear').close();
  refreshDays();
  render();
  toast('All data erased from this device.');
});

// ---------- start ----------
(async function init() {
  const [pindData, outline, saved] = await Promise.all([
    fetch('data/punjab_pinds.json').then((r) => r.json()),
    fetch('data/punjab_outline.json').then((r) => r.json()),
    db.get('data').catch(() => null),
  ]);
  pinds = pindData.features;
  pinds.forEach((f, i) => { f.properties._i = i; });
  buildIndex();
  $('stat-total').textContent = pinds.length.toLocaleString('en-IN');

  // Black out everything outside Punjab.
  const holes = (outline.geometry.type === 'Polygon' ? [outline.geometry.coordinates] : outline.geometry.coordinates).map((p) => p[0]);
  L.geoJSON({ type: 'Polygon', coordinates: [[[0, -10], [140, -10], [140, 70], [0, 70], [0, -10]], ...holes] }, {
    renderer, interactive: false, style: { fillColor: '#000', fillOpacity: 0.97, color: '#ffc65c', weight: 1.5, opacity: 0.6 },
  }).addTo(map);

  pindLayer = L.geoJSON(pindData, {
    renderer,
    style: FOG,
    onEachFeature: (f, layer) => {
      layer.bindTooltip(pindTooltip, { sticky: true, className: 'pind-tip', direction: 'top', offset: [0, -8] });
      layer.on('click', () => layer.openTooltip());
    },
  }).addTo(map);

  const bounds = L.geoJSON(outline).getBounds();
  map.fitBounds(bounds);
  map.setMaxBounds(bounds.pad(0.6));

  if (saved) store = saved;
  refreshDays();
  render();
  if (!store.points.length && !store.visits.length) {
    try { if (!localStorage.getItem('seenHelp')) { $('help').showModal(); localStorage.setItem('seenHelp', '1'); } } catch { /* storage blocked */ }
  }
})();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
