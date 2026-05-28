import { Router } from 'express';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getAnnotatedPaths } from '../db.js';

export const imagesRouter = Router();

const STACKS_DIR = process.env['STACKS_DIR'] ?? '';
const IMAGE_RE = /\.(png|jpe?g)$/i;

function safePath(rel: string): string | null {
  if (!STACKS_DIR) return null;
  const resolved = path.resolve(STACKS_DIR, rel);
  if (!resolved.startsWith(path.resolve(STACKS_DIR))) return null;
  return resolved;
}

// GET /api/images?path=<rel> — browse STACKS_DIR
imagesRouter.get('/', async (req, res) => {
  const rel = typeof req.query['path'] === 'string' ? req.query['path'] : '';
  const dir = safePath(rel);

  if (!dir) {
    res.status(400).json({ error: 'Invalid path' });
    return;
  }

  const entries = await readdir(dir, { withFileTypes: true });

  const folders: string[] = [];
  const imageNames: string[] = [];

  for (const e of entries) {
    if (e.isDirectory()) {
      folders.push(e.name);
    } else if (e.isFile() && IMAGE_RE.test(e.name)) {
      imageNames.push(e.name);
    }
  }

  // Check which images already have annotations
  const relPaths = imageNames.map(name =>
    rel ? path.posix.join(rel.replace(/\\/g, '/'), name) : name,
  );
  const annotated = getAnnotatedPaths(relPaths);

  const images = imageNames.map((name, i) => {
    const imageRel = relPaths[i];
    return {
      name,
      rel: imageRel,
      url: `/stacks/${imageRel.replace(/\\/g, '/')}`,
      hasAnnotations: annotated.has(imageRel),
    };
  });

  res.json({ folders, images });
});

// HEAD /api/images/dimensions?path=<rel> — get image width/height via sharp
// (Not needed — client reads from <img>.naturalWidth/Height)

// Stat endpoint used by editor to confirm a file exists
imagesRouter.get('/stat', async (req, res) => {
  const rel = typeof req.query['path'] === 'string' ? req.query['path'] : '';
  const full = safePath(rel);
  if (!full) { res.status(400).json({ error: 'Invalid path' }); return; }
  try {
    const s = await stat(full);
    res.json({ size: s.size, mtime: s.mtime.toISOString() });
  } catch {
    res.status(404).json({ error: 'Not found' });
  }
});
