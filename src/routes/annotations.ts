import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import {
  getAnnotationByPath,
  getAnnotationById,
  upsertAnnotationPath,
  updateAnnotationMarkers,
  updateAnnotationStyle,
  updateAnnotationCatalogId,
  getDefaultStyle,
} from '../db.js';
import sharp from 'sharp';
import { exportAnnotatedImage, uploadToAstroDB } from '../lib/sharp-export.js';
import type { Marker, StyleConfig } from '../types.js';

export const annotationsRouter = Router();

const ASTRO_DB_URL = process.env['ASTRO_DB_URL'] ?? 'http://localhost:3001';

function resolveStyle(styleOverride: StyleConfig | null): StyleConfig {
  return styleOverride ?? getDefaultStyle();
}

// GET /api/annotations?imagePath=<id>
annotationsRouter.get('/', (req, res) => {
  const imagePath = typeof req.query['imagePath'] === 'string' ? req.query['imagePath'] : '';
  if (!imagePath) { res.status(400).json({ error: 'imagePath required' }); return; }

  const ann = getAnnotationByPath(imagePath);
  const defaultStyle = getDefaultStyle();

  if (!ann) {
    res.json({ annotation: null, defaultStyle, resolvedStyle: defaultStyle });
    return;
  }

  res.json({
    annotation: { ...ann, style: resolveStyle(ann.styleOverride) },
    defaultStyle,
    resolvedStyle: resolveStyle(ann.styleOverride),
  });
});

// PUT /api/annotations/:id — update markers and/or style
annotationsRouter.put('/:id', (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const ann = getAnnotationById(id);
  if (!ann) { res.status(404).json({ error: 'Not found' }); return; }

  const body = req.body as { markers?: Marker[]; style?: StyleConfig | null; catalogId?: string };

  if (body.markers !== undefined) updateAnnotationMarkers(id, body.markers);
  if ('style' in body) updateAnnotationStyle(id, body.style ?? null);
  if (body.catalogId !== undefined) updateAnnotationCatalogId(id, body.catalogId);

  res.json({ ok: true });
});

// POST /api/annotations — create annotation record for an image
annotationsRouter.post('/', (req, res) => {
  const { imagePath } = req.body as { imagePath?: string };
  if (!imagePath) { res.status(400).json({ error: 'imagePath required' }); return; }

  const id = upsertAnnotationPath(imagePath);
  res.status(201).json({ id });
});

// POST /api/annotations/:id/markers — add a manually-placed marker
annotationsRouter.post('/:id/markers', (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const ann = getAnnotationById(id);
  if (!ann) { res.status(404).json({ error: 'Not found' }); return; }

  const body = req.body as Omit<Marker, 'id'>;
  const marker: Marker = { ...body, id: randomUUID() };
  updateAnnotationMarkers(id, [...ann.markers, marker]);

  res.status(201).json(marker);
});

// POST /api/annotations/:id/export — composite annotations onto image, upload to astro-db
annotationsRouter.post('/:id/export', async (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const ann = getAnnotationById(id);
  if (!ann) { res.status(404).json({ error: 'Not found' }); return; }

  const style = resolveStyle(ann.styleOverride);
  const catalogId = (ann.catalogId ?? 'unknown').replace(/\s+/g, '');

  // Download source image from astro-db (ann.imagePath holds the astro-db image ID)
  const upstream = await fetch(`${ASTRO_DB_URL}/api/images/${ann.imagePath}/file`);
  if (!upstream.ok) {
    res.status(502).json({ error: 'Failed to fetch source image from astro-db' });
    return;
  }
  const imageBuffer = Buffer.from(await upstream.arrayBuffer());
  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
  const outputFormat: 'jpeg' | 'png' = contentType.includes('png') ? 'png' : 'jpeg';
  const ext = outputFormat === 'jpeg' ? '.jpg' : '.png';
  const annotatedFilename = `${catalogId}_annotated${ext}`;
  const originalFilename = `${catalogId}${ext}`;

  // Use WCS dimensions when available (they match the solved image), otherwise read from sharp
  let svgWidth: number;
  let svgHeight: number;
  if (ann.wcs) {
    svgWidth = ann.wcs.width;
    svgHeight = ann.wcs.height;
  } else {
    const meta = await sharp(imageBuffer).metadata();
    svgWidth = meta.width ?? 0;
    svgHeight = meta.height ?? 0;
  }

  const buffer = await exportAnnotatedImage(imageBuffer, outputFormat, ann.markers, style, svgWidth, svgHeight);
  const result = await uploadToAstroDB(buffer, annotatedFilename, originalFilename, catalogId, null, ASTRO_DB_URL);

  res.json({ astroDbImageId: result.id, fileUrl: `${ASTRO_DB_URL}${result.fileUrl}` });
});