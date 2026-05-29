import type { WCS } from '../types';

/**
 * Convert RA/Dec (degrees) to pixel coordinates on the original image.
 * Returns null if the object falls outside the image bounds.
 */
export function raDecToPixel(
  objRa: number,
  objDec: number,
  wcs: WCS,
): { x: number; y: number } | null {
  const centerDecRad = (wcs.dec * Math.PI) / 180;
  const orientationRad = (wcs.orientation * Math.PI) / 180;

  const rawDRa = objRa - wcs.ra;
  const dRa = ((rawDRa + 540) % 360 - 180) * Math.cos(centerDecRad);
  const dDec = objDec - wcs.dec;

  const r = Math.sqrt(dRa * dRa + dDec * dDec);
  const pxDist = (r * 3600) / wcs.pixscale;
  const angle = Math.atan2(dRa, dDec) - orientationRad;

  const imgCx = wcs.width / 2;
  const imgCy = wcs.height / 2;

  const x = imgCx + wcs.parity * pxDist * Math.sin(angle);
  const y = imgCy - pxDist * Math.cos(angle);

  if (x < 0 || x > wcs.width || y < 0 || y > wcs.height) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

/**
 * Convert pixel coordinates to RA/Dec (degrees).
 * Inverse of raDecToPixel (gnomonic / TAN projection).
 */
export function pixelToRaDec(
  x: number,
  y: number,
  wcs: WCS,
): { ra: number; dec: number } {
  const imgCx = wcs.width / 2;
  const imgCy = wcs.height / 2;
  const centerDecRad = (wcs.dec * Math.PI) / 180;
  const orientationRad = (wcs.orientation * Math.PI) / 180;

  const dx = wcs.parity * (x - imgCx);
  const dy = -(y - imgCy);
  const pxDist = Math.sqrt(dx * dx + dy * dy);
  const r = (pxDist * wcs.pixscale) / 3600;

  const angle = Math.atan2(dx, dy) + orientationRad;
  const dDec = r * Math.cos(angle);
  const dRa = (r * Math.sin(angle)) / Math.cos(centerDecRad);

  const ra = ((wcs.ra + dRa) + 360) % 360;
  const dec = wcs.dec + dDec;
  return { ra, dec };
}
