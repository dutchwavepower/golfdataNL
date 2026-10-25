// Haalt elke run de laatste metingen bij IJmuiden op en schrijft ze naar data/IJGeul1.json (via GitHub Pages gepubliceerd):
//  - golfhoogte van meetboei IJGeul 1 (Rijkswaterstaat Waterinfo)
//  - wind, windrichting en windstoten op de Zuidpier, waterstand IJmuiden Haven (HMC Infobord IJmuiden)
// Lukt een bron niet, dan blijven die velden leeg; alleen als er helemaal niets binnenkomt, faalt de run.
// Draait in GitHub Actions met Node 20 of nieuwer; geen extra pakketten nodig.
import { mkdir, writeFile } from 'node:fs/promises';

const UA = { 'User-Agent': 'zuidpier-golfpier (GitHub Actions)', Accept: 'application/json' };

// ---------- Waterinfo: golfhoogte IJGeul 1 ----------
async function waterinfo(parameterId) {
  const res = await fetch('https://waterinfo.rws.nl/api/point/latestmeasurement?parameterId=' + encodeURIComponent(parameterId), { headers: UA });
  if (!res.ok) throw new Error(`Waterinfo ${parameterId}: HTTP ${res.status}`);
  const text = await res.text();
  // 'ijgeul.1' is de code die Rijkswaterstaat zelf gebruikt (kleine letters)
  const m = text.match(/"locationCode"\s*:\s*"ijgeul\.1"\s*,\s*"latestValue"\s*:\s*(-?[\d.]+)\s*,\s*"dateTime"\s*:\s*"([^"]+)"/i);
  if (!m) throw new Error(`Waterinfo ${parameterId}: geen meting van IJGeul 1 gevonden`);
  return { value: Number(m[1]), dateTime: m[2] };
}

// ---------- HMC Infobord IJmuiden ----------
const INFOBORD = 'https://waterberichtgeving.rws.nl/dynamisch/infobord/ijmuiden/_tabel_uitgebreid.json';

// windstreek (West, Westnoordwest, NW, ZZW, ...) -> graden waar de wind vandaan komt
const PTS = ['N', 'NNO', 'NO', 'ONO', 'O', 'OZO', 'ZO', 'ZZO', 'Z', 'ZZW', 'ZW', 'WZW', 'W', 'WNW', 'NW', 'NNW'];
function compassDeg(txt) {
  if (!txt) return null;
  let s = txt.trim().toLowerCase();
  s = s.replace(/noord/g, 'N').replace(/oost/g, 'O').replace(/zuid/g, 'Z').replace(/west/g, 'W').replace(/[^NOZWnozwe]/g, '').toUpperCase().replace(/E/g, 'O');
  const i = PTS.indexOf(s);
  return i < 0 ? null : i * 22.5;
}

// "(12:50 LT)" uit de tooltip -> ISO-tijd, met de datum en tijdzone van het bestand
function measuredAt(html, generatedIso) {
  const m = (html || '').match(/\((\d{1,2}):(\d{2}) LT\)/);
  if (!m || !generatedIso) return null;
  const g = new Date(generatedIso), off = generatedIso.slice(19) || 'Z';
  let t = new Date(`${generatedIso.slice(0, 10)}T${m[1].padStart(2, '0')}:${m[2]}:00${off}`);
  if (t - g > 30 * 60 * 1000) t = new Date(t - 24 * 3600 * 1000);   // meting van gisteren (rond middernacht)
  return t.toISOString();
}

async function infobord() {
  const res = await fetch(INFOBORD, { headers: UA });
  if (!res.ok) throw new Error(`Infobord: HTTP ${res.status}`);
  const j = await res.json();
  const gen = j.generatedAt && j.generatedAt.iso8601;
  const rows = j.tables.flatMap(t => t.rows || []);
  const cell = (label, unit, loc) => {
    const r = rows.find(r => !r.merge && (r.labelText || '').trim().startsWith(label) && (unit == null || r.unit === unit));
    const c = r && (r.cells || []).find(c => c.location === loc);
    return c && c.text ? c : null;
  };
  const out = {};
  const w = cell('Windsnelheid', 'ms', 'IJZ1');          // "West 8 bft / 17.6 m/s"
  if (w) {
    const m = w.text.match(/^(.*?)\s*(\d+)\s*bft\s*\/\s*([\d.]+)\s*m\/s/i);
    if (m) {
      out.windrichting = m[1].trim() || null;
      out.wind_van_graden = compassDeg(m[1]);
      out.wind_bft = Number(m[2]);
      out.wind_ms = Number(m[3]);
      out.wind_gemeten = measuredAt(w.html, gen);
    }
  }
  const s = cell('Windstoot', 'ms', 'IJZ1');             // "23.2 m/s"
  if (s) { const m = s.text.match(/([\d.]+)\s*m\/s/); if (m) out.windstoot_ms = Number(m[1]); }
  const h = cell('Waterstand NAP', 'nap', 'IJMH');       // "71 cm"
  if (h) {
    const m = h.text.match(/(-?\d+)\s*cm/);
    if (m) { out.waterstand_nap_m = Number(m[1]) / 100; out.waterstand_gemeten = measuredAt(h.html, gen); }
  }
  const g = cell('Golfhoogte Significant', null, 'SPY1'); // reserve voor de golfhoogte: "482 cm - ..."
  if (g) { const m = g.text.match(/(\d+)\s*cm/); if (m) { out._hs_cm = Number(m[1]); out._hs_gemeten = measuredAt(g.html, gen); } }
  return out;
}

// ---------- samenvoegen ----------
const out = { station: 'IJGeul 1', bron: 'Rijkswaterstaat (Waterinfo en HMC Infobord IJmuiden)' };
let ok = false;

try {
  const hs = await waterinfo('golfhoogte');
  out.hs_m = Math.round(hs.value) / 100; out.hs_cm = hs.value; out.gemeten = hs.dateTime; ok = true;
} catch (e) { console.warn(e.message); }

try {
  const ib = await infobord();
  if (out.hs_m == null && ib._hs_cm) { out.hs_m = ib._hs_cm / 100; out.hs_cm = ib._hs_cm; out.gemeten = ib._hs_gemeten; }
  delete ib._hs_cm; delete ib._hs_gemeten;
  Object.assign(out, { windrichting: null, wind_van_graden: null, wind_bft: null, wind_ms: null, windstoot_ms: null, wind_gemeten: null, waterstand_nap_m: null, waterstand_gemeten: null }, ib);
  if (ib.wind_ms != null || ib.waterstand_nap_m != null) ok = true;
} catch (e) { console.warn(e.message); }

if (out.hs_m != null && !(out.hs_m > 0 && out.hs_m < 20)) { console.warn('Onwaarschijnlijke golfhoogte, weggelaten:', out.hs_cm); out.hs_m = null; }
if (out.wind_ms != null && !(out.wind_ms >= 0 && out.wind_ms < 70)) { out.wind_ms = null; }
if (out.waterstand_nap_m != null && !(Math.abs(out.waterstand_nap_m) < 6)) { out.waterstand_nap_m = null; }
out.opgehaald = new Date().toISOString();

if (!ok) throw new Error('Geen enkele bron gaf bruikbare data');
await mkdir('data', { recursive: true });
await writeFile('data/IJGeul1.json', JSON.stringify(out, null, 2) + '\n');
console.log('Geschreven:', out);
