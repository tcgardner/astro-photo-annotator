import type { WCS } from '../types.js';

const BASE = 'https://nova.astrometry.net/api';
const POLL_INTERVAL = 5_000;
const POLL_TIMEOUT = 5 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function poll<T>(
  fn: () => Promise<T>,
  check: (r: T) => boolean,
): Promise<T> {
  const deadline = Date.now() + POLL_TIMEOUT;
  while (true) {
    const result = await fn();
    if (check(result)) return result;
    if (Date.now() + POLL_INTERVAL > deadline) throw new Error('Astrometry poll timeout');
    await sleep(POLL_INTERVAL);
  }
}

export async function astrometryLogin(apiKey: string): Promise<string> {
  const body = `request-json=${encodeURIComponent(JSON.stringify({ apikey: apiKey }))}`;
  const resp = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const json = await resp.json() as { status: string; session?: string; message?: string };
  if (json.status !== 'success' || !json.session) {
    throw new Error(`Astrometry login failed: ${json.message ?? json.status}`);
  }
  return json.session;
}

export async function astrometryUpload(
  session: string,
  image: { data: Buffer; filename: string; mime: string },
): Promise<number> {
  const formData = new FormData();
  formData.append(
    'request-json',
    JSON.stringify({ session, publicly_visible: 'n', allow_modifications: 'n', allow_commercial_use: 'n' }),
  );
  formData.append('file', new Blob([new Uint8Array(image.data)], { type: image.mime }), image.filename);

  const resp = await fetch(`${BASE}/upload`, { method: 'POST', body: formData });
  const json = await resp.json() as { status: string; subid?: number };
  if (json.status !== 'success' || json.subid == null) {
    throw new Error(`Astrometry upload failed: ${json.status}`);
  }
  return json.subid;
}

export async function pollSubmission(subId: number): Promise<number> {
  const result = await poll<{ jobs: (number | null)[] }>(
    async () => {
      const resp = await fetch(`${BASE}/submissions/${subId}`);
      return resp.json() as Promise<{ jobs: (number | null)[] }>;
    },
    r => Array.isArray(r.jobs) && r.jobs.some(j => j != null),
  );
  return result.jobs.find(j => j != null)!;
}

export async function pollJob(jobId: number): Promise<'success' | 'failure'> {
  const result = await poll<{ status: string }>(
    async () => {
      const resp = await fetch(`${BASE}/jobs/${jobId}`);
      return resp.json() as Promise<{ status: string }>;
    },
    r => r.status === 'success' || r.status === 'failure',
  );
  return result.status as 'success' | 'failure';
}

export async function getCalibration(jobId: number, imgWidth: number, imgHeight: number): Promise<WCS> {
  const resp = await fetch(`${BASE}/jobs/${jobId}/calibration`);
  if (!resp.ok) throw new Error(`Calibration fetch failed: ${resp.status}`);
  const cal = await resp.json() as {
    ra: number; dec: number; radius: number; pixscale: number; orientation: number; parity: number;
  };
  return {
    ra: cal.ra,
    dec: cal.dec,
    radius: cal.radius,
    pixscale: cal.pixscale,
    orientation: cal.orientation,
    parity: cal.parity < 0 ? -1 : 1,
    width: imgWidth,
    height: imgHeight,
  };
}
