import { Router } from 'express';
import { getSetting, upsertSetting } from '../db.js';
import type { StyleConfig } from '../types.js';

export const settingsRouter = Router();

// GET /api/settings
settingsRouter.get('/', (_req, res) => {
  const raw = getSetting('default_style');
  res.json({
    defaultStyle: raw ? (JSON.parse(raw) as StyleConfig) : null,
  });
});

// PUT /api/settings
settingsRouter.put('/', (req, res) => {
  const { defaultStyle } = req.body as { defaultStyle?: StyleConfig };
  if (!defaultStyle) {
    res.status(400).json({ error: 'defaultStyle is required' });
    return;
  }
  upsertSetting('default_style', JSON.stringify(defaultStyle));
  res.json({ ok: true });
});
