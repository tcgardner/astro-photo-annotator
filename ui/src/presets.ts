import type { StyleConfig } from './types';

export const PRESETS: Record<string, StyleConfig> = {
  dense: {
    preset: 'dense',
    markerStyle: 'circle',
    circleRadius: 8,
    strokeWidth: 1,
    fontSize: 10,
    catalogColors: { NGC: '#ff8080', IC: '#ff8080', M: '#8080ff', PGC: '#888888', custom: '#00ffff' },
    showLabels: true,
    labelOffset: { x: 4, y: -4 },
    catalogs: [],
  },
  minimal: {
    preset: 'minimal',
    markerStyle: 'circle',
    circleRadius: 14,
    strokeWidth: 2,
    fontSize: 13,
    catalogColors: { NGC: '#ff4444', IC: '#ff4444', M: '#ff4444', PGC: '#ff4444', custom: '#ff4444' },
    showLabels: true,
    labelOffset: { x: 6, y: -6 },
    catalogs: ['M', 'NGC', 'IC'],
  },
  circles: {
    preset: 'circles',
    markerStyle: 'circle',
    circleRadius: 12,
    strokeWidth: 2,
    fontSize: 12,
    catalogColors: { NGC: '#ff8888', IC: '#ff8888', M: '#ff8888', PGC: '#00cccc', custom: '#00cccc' },
    showLabels: true,
    labelOffset: { x: 5, y: -5 },
    catalogs: [],
  },
  crosshairs: {
    preset: 'crosshairs',
    markerStyle: 'crosshair',
    circleRadius: 10,
    strokeWidth: 2,
    fontSize: 11,
    catalogColors: { NGC: '#ffffff', IC: '#ffffff', M: '#ffffff', PGC: '#ffffff', custom: '#ffffff' },
    showLabels: true,
    labelOffset: { x: 6, y: -6 },
    catalogs: ['M', 'NGC', 'IC'],
  },
};

export const PRESET_NAMES = ['dense', 'minimal', 'circles', 'crosshairs'] as const;
