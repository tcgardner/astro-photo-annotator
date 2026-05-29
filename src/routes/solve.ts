import { Router } from 'express';
import sharp from 'sharp';
import {
  astrometryLogin,
  astrometryUpload,
  pollSubmission,
  pollJob,
  getCalibration,
} from '../lib/astrometry.js';
import { querySimbadAll } from '../lib/simbad.js';
import { resetWcsLogCounter } from '../lib/wcs.js';
import {
  upsertAnnotationPath,
  updateAnnotationSolve,
  getAnnotationById,
} from '../db.js';

export const solveRouter = Router();

const ASTRO_DB_URL = process.env['ASTRO_DB_URL'] ?? 'http://localhost:3001';
const API_KEY = process.env['ASTROMETRY_API_KEY'] ?? '';

async function downloadImage(
  imageId: number,
): Promise<{ data: Buffer; mime: string; filename: string }> {
  const resp = await fetch(ASTRO_DB_URL + '/api/images/' + imageId + '/file');
  if (!resp.ok) throw new Error('Failed to download image ' + imageId + ': ' + resp.status);
  const data = Buffer.from(await resp.arrayBuffer());
  const mime = resp.headers.get('content-type') ?? 'image/jpeg';
  const ext = mime.includes('png') ? '.png' : '.jpg';
  return { data, mime, filename: 'image_' + imageId + ext };
}

// POST /api/solve -- download from astro-db, submit to Astrometry.net, run pipeline in background
solveRouter.post('/', async (req, res) => {
  const { imageId } = req.body as { imageId?: number };
  if (!imageId) { res.status(400).json({ error: 'imageId required' }); return; }

  const imagePath = String(imageId);

  const annId = upsertAnnotationPath(imagePath);
  const existing = getAnnotationById(annId);
  if (existing?.solveStatus === 'solved') {
    res.json({ id: annId, status: 'solved', wcs: existing.wcs, markers: existing.markers });
    return;
  }

  if (!API_KEY) { res.status(500).json({ error: 'ASTROMETRY_API_KEY not configured' }); return; }

  try {
    updateAnnotationSolve(annId, { solveStatus: 'uploading' });
    const image = await downloadImage(imageId);
    const session = await astrometryLogin(API_KEY);
    const subId = await astrometryUpload(session, image);
    updateAnnotationSolve(annId, { solveStatus: 'solving', astrometrySubId: subId });

    res.json({ id: annId, status: 'solving' });

    runPipeline(annId, subId, image).catch(err => {
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
  image: { data: Buffer; filename: string },
): Promise<void> {
  const jobId = await pollSubmission(subId);
  const jobStatus = await pollJob(jobId);

  if (jobStatus === 'failure') {
    updateAnnotationSolve(annId, { solveStatus: 'failed' });
    return;
  }

  const meta = await sharp(image.data).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  const wcs = await getCalibration(jobId, imgW, imgH);
  console.log('[solve] WCS calibration:', JSON.stringify(wcs));
  resetWcsLogCounter();
  const markers = await querySimbadAll(wcs);

  const primaryLabel = markers[0]?.label ?? null;

  updateAnnotationSolve(annId, { solveStatus: 'solved', wcs, markers, catalogId: primaryLabel });
  console.log('[solve] ' + image.filename + ' solved, ' + markers.length + ' objects');
}

// GET /api/solve/:id/status -- poll solve status from DB
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
