import { Router } from 'express';
import { getAnnotatedPaths } from '../db.js';

export const imagesRouter = Router();

const ASTRO_DB_URL = process.env['ASTRO_DB_URL'] ?? 'http://localhost:3001';

interface AstroDbImage {
  id: number;
  filename: string;
  catalog_id: string;
  common_name: string | null;
}

// GET /api/images — list all images from astro-db
imagesRouter.get('/', async (_req, res) => {
  const upstream = await fetch(`${ASTRO_DB_URL}/api/images`);
  if (!upstream.ok) {
    res.status(502).json({ error: 'Failed to fetch images from astro-db' });
    return;
  }
  const rows = await upstream.json() as AstroDbImage[];

  const ids = rows.map(r => String(r.id));
  const annotated = getAnnotatedPaths(ids);

  const images = rows.map(r => ({
    id: r.id,
    catalog_id: r.catalog_id,
    filename: r.filename,
    common_name: r.common_name,
    url: `/api/images/${r.id}/file`,
    hasAnnotations: annotated.has(String(r.id)),
  }));

  res.json({ images });
});

// GET /api/images/:id/file — proxy image file from astro-db
imagesRouter.get('/:id/file', async (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const upstream = await fetch(`${ASTRO_DB_URL}/api/images/${id}/file`);
  if (!upstream.ok) {
    res.status(upstream.status).json({ error: 'Image not found in astro-db' });
    return;
  }

  const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(Buffer.from(await upstream.arrayBuffer()));
});
