import type { CatalogPrefix, Marker } from '../types.js';
import { raDecToPixel } from './wcs.js';
import type { WCS } from '../types.js';
import { randomUUID } from 'node:crypto';

const SIMBAD_TAP = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';

const STELLAR_TYPES = [
  'Star', '*', 'PM*', 'V*', 'RB', 'EB', 'LP*', 'Mi*', 'sg*', 'HB*', 's*b', 's*r',
];

interface SimbadRow {
  mainId: string;
  otype: string;
  ra: number;
  dec: number;
  majAxis: number | null;
}

function parseCatalog(mainId: string): CatalogPrefix {
  const s = mainId.trim();
  if (/^NGC\s*/i.test(s)) return 'NGC';
  if (/^IC\s*/i.test(s)) return 'IC';
  if (/^M\s+\d+/i.test(s)) return 'M';
  if (/^PGC\s*/i.test(s)) return 'PGC';
  return 'custom';
}

function normalizeId(mainId: string): string {
  return mainId
    .replace(/^(NGC|IC|M|PGC)\s+/i, (_, prefix) => prefix.toUpperCase())
    .trim();
}

export async function querySimbadAll(wcs: WCS): Promise<Marker[]> {
  const stellarList = STELLAR_TYPES.map(t => "'" + t + "'").join(',');
  const adql = [
    'SELECT TOP 20 main_id, otype, ra, dec, galdim_majaxis,',
    "  DISTANCE(POINT('ICRS',ra,dec),POINT('ICRS'," + wcs.ra + "," + wcs.dec + ")) AS dist",
    'FROM basic',
    'WHERE CONTAINS(',
    "  POINT('ICRS',ra,dec),",
    "  CIRCLE('ICRS'," + wcs.ra + "," + wcs.dec + "," + wcs.radius + ")",
    ')=1',
    'AND otype NOT IN (' + stellarList + ')',
    'AND ra IS NOT NULL',
    'AND dec IS NOT NULL',
    "AND (main_id LIKE 'NGC %' OR main_id LIKE 'IC %' OR main_id LIKE 'M %' OR main_id LIKE 'PGC %')",
    'ORDER BY galdim_majaxis DESC, dist ASC',
  ].join(' ');

  const params = new URLSearchParams({
    REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: adql,
  });

  const resp = await fetch(SIMBAD_TAP + '?' + params);
  if (!resp.ok) throw new Error('SIMBAD query failed: ' + resp.status);

  const json = await resp.json() as { metadata?: { name: string }[]; data?: unknown[][] };
  if (!json.data || json.data.length === 0) return [];

  // Resolve column positions from metadata rather than assuming fixed order
  const meta = json.metadata ?? [];
  const col = (name: string) => meta.findIndex(m => m.name === name);
  const mainIdIdx = col('main_id');
  const raIdx = col('ra');
  const decIdx = col('dec');
  const majAxisIdx = col('galdim_majaxis');

  if (raIdx === -1 || decIdx === -1 || mainIdIdx === -1) {
    console.error('[simbad] unexpected column layout:', meta.map(m => m.name));
    return [];
  }

  console.log('[simbad] columns:', meta.map(m => m.name).join(', '));
  console.log('[simbad] rows returned:', json.data.length);

  const markers: Marker[] = [];

  for (const [i, row] of json.data.entries()) {
    const mainId = String(row[mainIdIdx]);
    const ra = Number(row[raIdx]);
    const dec = Number(row[decIdx]);
    const majAxis = majAxisIdx >= 0 && row[majAxisIdx] != null ? Number(row[majAxisIdx]) : null;

    if (i < 3) {
      const majStr = majAxis !== null ? majAxis + ' arcmin' : 'null';
      console.log('[simbad] row ' + i + ': main_id=' + mainId + ' ra=' + ra + ' dec=' + dec + ' majAxis=' + majStr);
    }

    const coords = raDecToPixel(ra, dec, wcs);
    if (!coords) continue;

    const catalog = parseCatalog(mainId);
    const label = normalizeId(mainId);

    markers.push({
      id: randomUUID(),
      label,
      catalog,
      ra,
      dec,
      x: coords.x,
      y: coords.y,
      markerStyle: 'circle',
      visible: true,
    });
  }

  return markers;
}
