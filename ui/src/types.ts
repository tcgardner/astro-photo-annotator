export type CatalogPrefix = 'NGC' | 'IC' | 'M' | 'PGC' | 'custom';
export type MarkerStyle = 'circle' | 'crosshair' | 'dot';
export type SolveStatus = 'none' | 'uploading' | 'solving' | 'solved' | 'failed';
export type PresetName = 'dense' | 'minimal' | 'circles' | 'crosshairs' | 'custom';

export interface Marker {
  id: string;
  label: string;
  catalog: CatalogPrefix;
  ra?: number;
  dec?: number;
  x: number;
  y: number;
  markerStyle: MarkerStyle;
  visible: boolean;
}

export interface StyleConfig {
  preset: PresetName;
  markerStyle: MarkerStyle;
  circleRadius: number;
  strokeWidth: number;
  fontSize: number;
  catalogColors: Record<string, string>;
  showLabels: boolean;
  labelOffset: { x: number; y: number };
  catalogs: string[];
}

export interface WCS {
  ra: number;
  dec: number;
  radius: number;
  pixscale: number;
  orientation: number;
  width: number;
  height: number;
}

export interface Annotation {
  id: number;
  imagePath: string;
  catalogId: string | null;
  solveStatus: SolveStatus;
  wcs: WCS | null;
  markers: Marker[];
  style: StyleConfig;
}
