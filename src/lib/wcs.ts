import type { WCS } from '../types.js';

// Diagnostic call counter -- reset to 0 at the start of each solve pipeline run.
// raDecToPixel logs the first WCS_LOG_LIMIT calls per solve so output stays readable.
let _wcsLogCount = 0;
const WCS_LOG_LIMIT = 5;
export function resetWcsLogCounter(): void { _wcsLogCount = 0; }

// Interpretation guide for diagnostic output:
//   pxDist ~0 for every row   -> pixscale likely stored as deg/px, not arcsec/px
//   pxDist >> wcs.width       -> pixscale or radius unit mismatch, objects outside frame
//   ra=NaN or dec=NaN         -> SIMBAD column index resolution is broken
//   pxDist correct but x/y off -> parity or orientation sign error
export function raDecToPixel(
  objRa: number,
  objDec: number,
  wcs: WCS,
): { x: number; y: number } | null {
  const centerDecRad = (wcs.dec * Math.PI) / 180;
  const orientationRad = (wcs.orientation * Math.PI) / 180;

  // Normalize dRa to [-180, 180] to handle RA wrap-around at 0/360
  const rawDRa = objRa - wcs.ra;
  const dRa = ((rawDRa + 540) % 360 - 180) * Math.cos(centerDecRad);
  const dDec = objDec - wcs.dec;

  const r = Math.sqrt(dRa * dRa + dDec * dDec);
  const pxDist = (r * 3600) / wcs.pixscale;
  const angle = Math.atan2(dRa, dDec) - orientationRad;

  const imgCx = wcs.width / 2;
  const imgCy = wcs.height / 2;

  // parity -1 = standard astronomical (north up, east left); +1 = mirrored (east right)
  const x = imgCx + wcs.parity * pxDist * Math.sin(angle);
  const y = imgCy - pxDist * Math.cos(angle);

  if (_wcsLogCount < WCS_LOG_LIMIT) {
    _wcsLogCount++;
    const inBounds = !(x < 0 || x > wcs.width || y < 0 || y > wcs.height);
    console.log(
      '[wcs] call ' + _wcsLogCount + '/' + WCS_LOG_LIMIT +
      '  objRa=' + objRa + ' objDec=' + objDec +
      '  dRa=' + dRa.toFixed(4) + ' dDec=' + dDec.toFixed(4) +
      '  r_deg=' + r.toFixed(4) + ' pxDist=' + pxDist.toFixed(1) +
      '  angle_deg=' + (angle * 180 / Math.PI).toFixed(2) +
      '  x=' + x.toFixed(1) + ' y=' + y.toFixed(1) +
      '  bounds=' + wcs.width + 'x' + wcs.height +
      '  ' + (inBounds ? 'ok' : 'OUT_OF_BOUNDS'),
    );
  }

  if (x < 0 || x > wcs.width || y < 0 || y > wcs.height) return null;

  return { x: Math.round(x), y: Math.round(y) };
}

// Inverse of raDecToPixel: pixel coordinates -> RA/Dec (gnomonic/TAN projection).
export function pixelToRaDec(
  x: number,
  y: number,
  wcs: WCS,
): { ra: number; dec: number } {
  const imgCx = wcs.width / 2;
  const imgCy = wcs.height / 2;
  const centerDecRad = (wcs.dec * Math.PI) / 180;
  const orientationRad = (wcs.orientation * Math.PI) / 180;

  // Invert: forward has x = imgCx + parity*pxDist*sin(a), y = imgCy - pxDist*cos(a)
  const dx = wcs.parity * (x - imgCx);
  const dy = -(y - imgCy);
  const pxDist = Math.sqrt(dx * dx + dy * dy);
  const r = (pxDist * wcs.pixscale) / 3600; // degrees from center

  const angle = Math.atan2(dx, dy) + orientationRad;
  const dDec = r * Math.cos(angle);
  const dRa = (r * Math.sin(angle)) / Math.cos(centerDecRad);

  const ra = ((wcs.ra + dRa) + 360) % 360;
  const dec = wcs.dec + dDec;
  return { ra, dec };
}
