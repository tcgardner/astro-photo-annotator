import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imagesRouter } from './routes/images.js';
import { annotationsRouter } from './routes/annotations.js';
import { settingsRouter } from './routes/settings.js';
import { solveRouter } from './routes/solve.js';
import { getDb, resetStuckSolves } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env['PORT'] ?? '3003', 10);

getDb();
resetStuckSolves();

const app = express();
app.use(express.json());

app.use('/api/images', imagesRouter);
app.use('/api/annotations', annotationsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/solve', solveRouter);

const uiDist = path.resolve(__dirname, '..', 'ui', 'dist');
app.use(express.static(uiDist));
app.get('*path', (_req, res) => {
  res.sendFile(path.join(uiDist, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Astro Photo Annotator running on http://localhost:${PORT}`);
});
