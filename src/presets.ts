import type { StyleConfig } from './types.js';

export const PRESETS: Record<string, StyleConfig> = {
  dense: {
    preset: 'dense',
    markerStyle: 'circle',
    circleRadius: 50,
    strokeWidth: 4,
    fontSize: 16,
    catalogColors: { NGC: '#ff8080', IC: '#ff8080', M: '#8080ff', PGC: '#888888', custom: '#00ffff' },
    showLabels: true,
    labelOffset: { x: 8, y: -8 },
    catalogs: [],
  },
  minimal: {
    preset: 'minimal',
    markerStyle: 'circle',
    circleRadius: 40,
    strokeWidth: 4,
    fontSize: 16,
    catalogColors: { NGC: '#ff4444', IC: '#ff4444', M: '#ff4444', PGC: '#ff4444', custom: '#ff4444' },
    showLabels: true,
    labelOffset: { x: 10, y: -10 },
    catalogs: ['M', 'NGC', 'IC'],
  },
  circles: {
    preset: 'circles',
    markerStyle: 'circle',
    circleRadius: 40,
    strokeWidth: 4,
    fontSize: 16,
    catalogColors: { NGC: '#ff8888', IC: '#ff8888', M: '#ff8888', PGC: '#00cccc', custom: '#00cccc' },
    showLabels: true,
    labelOffset: { x: 8, y: -8 },
    catalogs: [],
  },
  crosshairs: {
    preset: 'crosshairs',
    markerStyle: 'crosshair',
    circleRadius: 40,
    strokeWidth: 4,
    fontSize: 16,
    catalogColors: { NGC: '#ffffff', IC: '#ffffff', M: '#ffffff', PGC: '#ffffff', custom: '#ffffff' },
    showLabels: true,
    labelOffset: { x: 10, y: -10 },
    catalogs: ['M', 'NGC', 'IC'],
  },
};

export const DEFAULT_PRESET_NAME = 'dense';
