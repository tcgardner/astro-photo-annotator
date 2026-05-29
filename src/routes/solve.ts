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
import { resetWcsLogCounter, raDecToPixel } from '../lib/wcs.js';
import {
  upsertAnnotationPath,
  updateAnnotationSolve,
  resetAnnotationSolve,
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
  console.log('[solve] starting for imageId=%s annId=%d', imageId, annId);

  if (!API_KEY) { res.status(500).json({ error: 'ASTROMETRY_API_KEY not configured' }); return; }

  resetAnnotationSolve(annId);

  try {
    updateAnnotationSolve(annId, { solveStatus: 'uploading' });
    const image = await downloadImage(imageId);
    const session = await astrometryLogin(API_KEY);
    const subId = await astrometryUpload(session, image);
    updateAnnotationSolve(annId, { solveStatus: 'solving', astrometrySubId: subId });

    res.json({ id: annId, status: 'solving' });

    runPipeline(annId, subId, image).catch(err => {
      const e = err as Error & { cause?: unknown };
      console.error('[solve] pipeline error:', e.message, e.cause ?? '');
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
  console.log('[solve] polling submission subId=%d', subId);
  const jobId = await pollSubmission(subId);

  console.log('[solve] polling job jobId=%d', jobId);
  const jobStatus = await pollJob(jobId);

  if (jobStatus === 'failure') {
    updateAnnotationSolve(annId, { solveStatus: 'failed' });
    return;
  }

  console.log('[solve] fetching calibration jobId=%d', jobId);
  const meta = await sharp(image.data).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  const wcs = await getCalibration(jobId, imgW, imgH);
  console.log('[solve] WCS calibration:', JSON.stringify(wcs));

  console.log('[solve] querying SIMBAD');
  resetWcsLogCounter();
  const markers = await querySimbadAll(wcs);

  const primaryLabel = markers[0]?.label ?? null;

  updateAnnotationSolve(annId, { solveStatus: 'solved', wcs, markers, catalogId: primaryLabel });
  console.log('[solve] ' + image.filename + ' solved, ' + markers.length + ' objects');
}

// GET /api/solve/:id/debug -- inspect raw WCS and recomputed pixel coords for first 5 markers
solveRouter.get('/:id/debug', (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const ann = getAnnotationById(id);
  if (!ann) { res.status(404).json({ error: 'Not found' }); return; }
  if (!ann.wcs) { res.status(400).json({ error: 'Not solved' }); return; }

  const sampleMarkers = ann.markers.slice(0, 5).map(m => ({
    label: m.label,
    ra: m.ra,
    dec: m.dec,
    storedX: m.x,
    storedY: m.y,
    computedPixel: (m.ra !== undefined && m.dec !== undefined)
      ? raDecToPixel(m.ra, m.dec, ann.wcs!)
      : null,
  }));

  res.json({ wcs: ann.wcs, sampleMarkers });
});

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
