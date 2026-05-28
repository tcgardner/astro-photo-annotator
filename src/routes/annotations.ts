import { Router } from 'express';
import path from 'node:path';
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
import { exportAnnotatedImage, uploadToAstroDB } from '../lib/sharp-export.js';
import type { Marker, StyleConfig } from '../types.js';

export const annotationsRouter = Router();

const STACKS_DIR = process.env['STACKS_DIR'] ?? '';
const ASTRO_DB_URL = process.env['ASTRO_DB_URL'] ?? 'http://localhost:3001';

function resolveStyle(styleOverride: StyleConfig | null): StyleConfig {
  return styleOverride ?? getDefaultStyle();
}

// GET /api/annotations?imagePath=<rel>
annotationsRouter.get('/', (req, res) => {
  const imagePath = typeof req.query['imagePath'] === 'string' ? req.query['imagePath'] : '';
  if (!imagePath) { res.status(400).json({ error: 'imagePath required' }); return; }

  const ann = getAnnotationByPath(imagePath);
  const defaultStyle = getDefaultStyle();

  if (!ann) {
    res.json({
      annotation: null,
      defaultStyle,
      resolvedStyle: defaultStyle,
    });
    return;
  }

  res.json({
    annotation: {
      ...ann,
      style: resolveStyle(ann.styleOverride),
    },
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

  const body = req.body as {
    markers?: Marker[];
    style?: StyleConfig | null;
    catalogId?: string;
  };

  if (body.markers !== undefined) updateAnnotationMarkers(id, body.markers);
  if ('style' in body) updateAnnotationStyle(id, body.style ?? null);
  if (body.catalogId !== undefined) updateAnnotationCatalogId(id, body.catalogId);

  res.json({ ok: true });
});

// POST /api/annotations — create annotation record for a path (without solving)
annotationsRouter.post('/', (req, res) => {
  const { imagePath } = req.body as { imagePath?: string };
  if (!imagePath) { res.status(400).json({ error: 'imagePath required' }); return; }

  const id = upsertAnnotationPath(imagePath);
  res.status(201).json({ id });
});

// POST /api/annotations/:id/markers — add a single manually-placed marker
annotationsRouter.post('/:id/markers', (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const ann = getAnnotationById(id);
  if (!ann) { res.status(404).json({ error: 'Not found' }); return; }

  const body = req.body as Omit<Marker, 'id'>;
  const marker: Marker = { ...body, id: randomUUID() };
  const markers = [...ann.markers, marker];
  updateAnnotationMarkers(id, markers);

  res.status(201).json(marker);
});

// POST /api/annotations/:id/export — composite + upload to astro-db
annotationsRouter.post('/:id/export', async (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const ann = getAnnotationById(id);
  if (!ann) { res.status(404).json({ error: 'Not found' }); return; }
  if (!ann.wcs) { res.status(400).json({ error: 'Image not plate-solved yet' }); return; }

  const style = resolveStyle(ann.styleOverride);
  const imgFull = path.resolve(STACKS_DIR, ann.imagePath);
  const origBasename = path.basename(ann.imagePath);
  const ext = path.extname(origBasename);
  const stem = path.basename(origBasename, ext);
  const annotatedFilename = `${stem}_annotated${ext}`;

  const catalogId = (ann.catalogId ?? 'unknown').replace(/\s+/g, '');

  const buffer = await exportAnnotatedImage(imgFull, ann.markers, style, ann.wcs);
  const result = await uploadToAstroDB(
    buffer,
    annotatedFilename,
    origBasename,
    catalogId,
    null,
    ASTRO_DB_URL,
  );

  res.json({ astroDbImageId: result.id, fileUrl: `${ASTRO_DB_URL}${result.fileUrl}` });
});
