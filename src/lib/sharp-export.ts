import sharp from 'sharp';
import path from 'node:path';
import type { Marker, StyleConfig, WCS } from '../types.js';

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function markerColor(marker: Marker, style: StyleConfig): string {
  return style.catalogColors[marker.catalog] ?? '#ffffff';
}

function buildMarkerSvg(marker: Marker, style: StyleConfig, imgWidth: number): string {
  if (!marker.visible) return '';

  const { x, y } = marker;
  const color = markerColor(marker, style);
  const sw = style.strokeWidth;
  // Per-marker overrides take precedence over global style
  const r = marker.overrides?.circleRadius ?? style.circleRadius;
  const fontSize = marker.overrides?.fontSize ?? style.fontSize;
  const lo = marker.overrides?.labelOffset ?? style.labelOffset;
  const nearRightEdge = x > imgWidth * 0.85;
  const labelX = nearRightEdge ? x - r - lo.x : x + r + lo.x;
  const labelAnchor = nearRightEdge ? 'end' : 'start';
  const labelY = y + lo.y;
  const safeLabel = escapeXml(marker.label);

  const labelSvg = style.showLabels
    ? '<text x="' + labelX + '" y="' + labelY + '"'
      + ' font-family="monospace" font-size="' + fontSize + '"'
      + ' fill="' + color + '" text-anchor="' + labelAnchor + '"'
      + ' stroke="black" stroke-width="' + (sw * 0.4) + '"'
      + ' paint-order="stroke fill">' + safeLabel + '</text>'
    : '';

  if (marker.markerStyle === 'crosshair') {
    const size = r;
    const gap = Math.round(r * 0.35);
    return '<g>'
      + '<line x1="' + (x - size) + '" y1="' + y + '" x2="' + (x - gap) + '" y2="' + y + '" stroke="' + color + '" stroke-width="' + sw + '"/>'
      + '<line x1="' + (x + gap) + '" y1="' + y + '" x2="' + (x + size) + '" y2="' + y + '" stroke="' + color + '" stroke-width="' + sw + '"/>'
      + '<line x1="' + x + '" y1="' + (y - size) + '" x2="' + x + '" y2="' + (y - gap) + '" stroke="' + color + '" stroke-width="' + sw + '"/>'
      + '<line x1="' + x + '" y1="' + (y + gap) + '" x2="' + x + '" y2="' + (y + size) + '" stroke="' + color + '" stroke-width="' + sw + '"/>'
      + labelSvg
      + '</g>';
  }

  if (marker.markerStyle === 'dot') {
    return '<g>'
      + '<circle cx="' + x + '" cy="' + y + '" r="' + Math.max(2, Math.round(r / 3)) + '" fill="' + color + '"/>'
      + labelSvg
      + '</g>';
  }

  // default: circle
  return '<g>'
    + '<circle cx="' + x + '" cy="' + y + '" r="' + r + '" fill="none" stroke="' + color + '" stroke-width="' + sw + '"/>'
    + labelSvg
    + '</g>';
}

function buildSvg(markers: Marker[], style: StyleConfig, wcs: WCS): string {
  const { width, height } = wcs;
  const visibleMarkers = markers.filter(m => {
    if (!m.visible) return false;
    if (style.catalogs.length > 0 && !style.catalogs.includes(m.catalog)) return false;
    return true;
  });

  const markerSvgs = visibleMarkers.map(m => buildMarkerSvg(m, style, width)).join('\n');

  return '<svg xmlns="http://www.w3.org/2000/svg"'
    + ' width="' + width + '" height="' + height + '"'
    + ' viewBox="0 0 ' + width + ' ' + height + '">\n'
    + markerSvgs + '\n'
    + '</svg>';
}

export async function exportAnnotatedImage(
  imageData: Buffer,
  outputFormat: 'jpeg' | 'png',
  markers: Marker[],
  style: StyleConfig,
  wcs: WCS,
): Promise<Buffer> {
  const svgString = buildSvg(markers, style, wcs);
  const svgBuffer = Buffer.from(svgString);

  const inst = sharp(imageData).composite([{ input: svgBuffer, gravity: 'northwest' }]);
  return outputFormat === 'jpeg'
    ? inst.jpeg({ quality: 95 }).toBuffer()
    : inst.png().toBuffer();
}

export async function uploadToAstroDB(
  buffer: Buffer,
  filename: string,
  originalFilename: string,
  catalogId: string,
  capturedAt: string | null,
  astroDbUrl: string,
): Promise<{ id: number; fileUrl: string }> {
  const ext = path.extname(filename).toLowerCase();
  const mime = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  form.append('catalog_id', catalogId);
  form.append('filename', filename);
  form.append('original_filename', originalFilename);
  form.append('id_stage', 'annotated');
  form.append('processed_at', new Date().toISOString());
  if (capturedAt) form.append('captured_at', capturedAt);

  const resp = await fetch(astroDbUrl + '/api/images/upload', {
    method: 'POST',
    body: form,
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error('astro-db upload failed ' + resp.status + ': ' + body);
  }

  const json = await resp.json() as { id: number; filename: string; file_url: string };
  return { id: json.id, fileUrl: json.file_url };
}
