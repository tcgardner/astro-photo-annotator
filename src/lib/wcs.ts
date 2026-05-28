import type { WCS } from '../types.js';

export function raDecToPixel(
  objRa: number,
  objDec: number,
  wcs: WCS,
): { x: number; y: number } | null {
  const centerDecRad = (wcs.dec * Math.PI) / 180;
  const orientationRad = (wcs.orientation * Math.PI) / 180;

  // Normalize dRa to [-180, 180] to handle RA wrap-around at 0°/360°
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

  if (x < 0 || x > wcs.width || y < 0 || y > wcs.height) return null;

  return { x: Math.round(x), y: Math.round(y) };
}
