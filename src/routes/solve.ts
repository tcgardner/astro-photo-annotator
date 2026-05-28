import { Router } from 'express';
import path from 'node:path';
import sharp from 'sharp';
import {
  astrometryLogin,
  astrometryUpload,
  pollSubmission,
  pollJob,
  getCalibration,
} from '../lib/astrometry.js';
import { querySimbadAll } from '../lib/simbad.js';
import {
  upsertAnnotationPath,
  updateAnnotationSolve,
  getAnnotationById,
} from '../db.js';

export const solveRouter = Router();

const STACKS_DIR = process.env['STACKS_DIR'] ?? '';
const API_KEY = process.env['ASTROMETRY_API_KEY'] ?? '';

function fullPath(rel: string): string {
  return path.resolve(STACKS_DIR, rel);
}

// POST /api/solve — upload image, kick off background solve pipeline
solveRouter.post('/', async (req, res) => {
  const { imagePath } = req.body as { imagePath?: string };
  if (!imagePath) { res.status(400).json({ error: 'imagePath required' }); return; }

  const imgFull = fullPath(imagePath);

  // Return cached result if already solved
  const annId = upsertAnnotationPath(imagePath);
  const existing = getAnnotationById(annId);
  if (existing?.solveStatus === 'solved') {
    res.json({
      id: annId,
      status: 'solved',
      wcs: existing.wcs,
      markers: existing.markers,
    });
    return;
  }

  if (!API_KEY) { res.status(500).json({ error: 'ASTROMETRY_API_KEY not configured' }); return; }

  try {
    updateAnnotationSolve(annId, { solveStatus: 'uploading' });
    const session = await astrometryLogin(API_KEY);
    const subId = await astrometryUpload(session, imgFull);
    updateAnnotationSolve(annId, { solveStatus: 'solving', astrometrySubId: subId });

    // Respond immediately — background runs the rest
    res.json({ id: annId, status: 'solving' });

    runPipeline(annId, subId, imagePath, imgFull).catch(err => {
      console.error('[solve] pipeline error:', (err as Error).message);
      updateAnnotationSolve(annId, { solveStatus: 'failed' });
    });
  } catch (err) {
    updateAnnotationSolve(annId, { solveStatus: 'failed' });
    throw err;
  }
});

async function runPipeline(
  annId: number,
  subId: number,
  imagePath: string,
  imgFull: string,
): Promise<void> {
  const jobId = await pollSubmission(subId);
  const jobStatus = await pollJob(jobId);

  if (jobStatus === 'failure') {
    updateAnnotationSolve(annId, { solveStatus: 'failed' });
    return;
  }

  const meta = await sharp(imgFull).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  const wcs = await getCalibration(jobId, imgW, imgH);
  const markers = await querySimbadAll(wcs);

  // Primary catalog ID = first marker's label (closest to field center)
  const primaryLabel = markers[0]?.label ?? null;

  updateAnnotationSolve(annId, {
    solveStatus: 'solved',
    wcs,
    markers,
    catalogId: primaryLabel,
  });

  console.log(`[solve] ${path.basename(imagePath)} → solved, ${markers.length} objects`);
}

// GET /api/solve/:id/status — poll solve status from DB
solveRouter.get('/:id/status', (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const ann = getAnnotationById(id);
  if (!ann) { res.status(404).json({ error: 'Not found' }); return; }

  res.json({
    id: ann.id,
    status: ann.solveStatus,
    wcs: ann.wcs,
    markers: ann.solveStatus === 'solved' ? ann.markers : undefined,
    catalogId: ann.catalogId,
  });
});
