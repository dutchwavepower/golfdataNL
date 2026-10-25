// Haalt de laatste golfmeting van meetboei IJGeul 1 op bij Rijkswaterstaat Waterinfo
// en schrijft die naar data/IJGeul1.json (wordt via GitHub Pages gepubliceerd).
import { mkdir, writeFile } from 'node:fs/promises';

const BASE = 'https://waterinfo.rws.nl/api/point/latestmeasurement?parameterId=';
const STATION = 'ijgeul.1';   // de code die Rijkswaterstaat zelf gebruikt (kleine letters)

async function latest(parameterId) {
  const res = await fetch(BASE + encodeURIComponent(parameterId), {
    headers: { 'User-Agent': 'zuidpier-golfpier (GitHub Actions)', Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`${parameterId}: HTTP ${res.status}`);
  const text = await res.text();
  const re = new RegExp(`"locationCode"\\s*:\\s*"${STATION.replace('.', '\\.')}"\\s*,\\s*"latestValue"\\s*:\\s*(-?[\\d.]+)\\s*,\\s*"dateTime"\\s*:\\s*"([^"]+)"`, 'i');
  const m = text.match(re);
  if (!m) throw new Error(`${parameterId}: geen meting van IJGeul 1 gevonden`);
  return { value: Number(m[1]), dateTime: m[2] };
}

const hs = await latest('golfhoogte');            // in cm
let te = null;                                     // golfperiode is optioneel
try { te = await latest('golfperiode'); } catch (e) { console.warn('Golfperiode niet beschikbaar:', e.message); }

const out = {
  station: 'IJGeul 1',
  bron: 'Rijkswaterstaat Waterinfo',
  hs_m: Math.round(hs.value) / 100,
  hs_cm: hs.value,
  gemeten: hs.dateTime,
  te_s: te ? te.value : null,
  te_gemeten: te ? te.dateTime : null,
  opgehaald: new Date().toISOString(),
};

if (!(out.hs_m > 0 && out.hs_m < 20)) throw new Error('Onwaarschijnlijke golfhoogte: ' + out.hs_cm + ' cm');

await mkdir('data', { recursive: true });
await writeFile('data/IJGeul1.json', JSON.stringify(out, null, 2) + '\n');
console.log('Geschreven:', out);
