import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imagesRouter } from './routes/images.js';
import { annotationsRouter } from './routes/annotations.js';
import { settingsRouter } from './routes/settings.js';
import { solveRouter } from './routes/solve.js';
import { getDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env['PORT'] ?? '3003', 10);
const STACKS_DIR = process.env['STACKS_DIR'] ?? '';

// Initialise DB on startup
getDb();

const app = express();
app.use(express.json());

// Static file serving for images in STACKS_DIR
if (STACKS_DIR) {
  app.use('/stacks', express.static(STACKS_DIR, { dotfiles: 'deny' }));
}

// API routes
app.use('/api/images', imagesRouter);
app.use('/api/annotations', annotationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/solve', solveRouter);

// Serve built UI in production
const uiDist = path.resolve(__dirname, '..', 'ui', 'dist');
app.use(express.static(uiDist));
app.get('*', (_req, res) => {
  res.sendFile(path.join(uiDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Astro Photo Annotator running on http://localhost:${PORT}`);
  if (!STACKS_DIR) console.warn('Warning: STACKS_DIR not set');
});
