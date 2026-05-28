export interface WCS {
  ra: number;
  dec: number;
  radius: number;
  pixscale: number;
  orientation: number;
  parity: 1 | -1;
  width: number;
  height: number;
}

export type CatalogPrefix = 'NGC' | 'IC' | 'M' | 'PGC' | 'custom';
export type MarkerStyle = 'circle' | 'crosshair' | 'dot';
export type SolveStatus = 'none' | 'uploading' | 'solving' | 'solved' | 'failed';

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
  preset: 'dense' | 'minimal' | 'circles' | 'crosshairs' | 'custom';
  markerStyle: MarkerStyle;
  circleRadius: number;
  strokeWidth: number;
  fontSize: number;
  catalogColors: Record<string, string>;
  showLabels: boolean;
  labelOffset: { x: number; y: number };
  catalogs: string[];
}

export interface Annotation {
  id: number;
  imagePath: string;
  catalogId: string | null;
  solveStatus: SolveStatus;
  astrometrySubId: number | null;
  wcs: WCS | null;
  markers: Marker[];
  styleOverride: StyleConfig | null;
  createdAt: string;
  updatedAt: string;
}
