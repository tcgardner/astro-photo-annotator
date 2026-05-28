import type { WCS } from '../types.js';

export function raDecToPixel(
  objRa: number,
  objDec: number,
  wcs: WCS,
): { x: number; y: number } | null {
  const centerDecRad = (wcs.dec * Math.PI) / 180;
  const orientationRad = (wcs.orientation * Math.PI) / 180;

  const dRa = (objRa - wcs.ra) * Math.cos(centerDecRad);
  const dDec = objDec - wcs.dec;

  const r = Math.sqrt(dRa * dRa + dDec * dDec);
  const pxDist = (r * 3600) / wcs.pixscale;
  const angle = Math.atan2(dRa, dDec) - orientationRad;

  const imgCx = wcs.width / 2;
  const imgCy = wcs.height / 2;

  const x = imgCx + pxDist * Math.sin(angle);
  const y = imgCy - pxDist * Math.cos(angle);

  if (x < 0 || x > wcs.width || y < 0 || y > wcs.height) return null;

  return { x: Math.round(x), y: Math.round(y) };
}
