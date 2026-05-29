import Database from 'better-sqlite3';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Annotation, Marker, StyleConfig, WCS } from './types.js';
import { PRESETS, DEFAULT_PRESET_NAME } from './presets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;

  const dbPath = process.env['DB_PATH']
    ? path.resolve(process.env['DB_PATH'])
    : path.resolve(__dirname, '..', 'annotator.db');

  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  initSchema(_db);
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS annotations (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      image_path          TEXT UNIQUE NOT NULL,
      catalog_id          TEXT,
      solve_status        TEXT NOT NULL DEFAULT 'none',
      astrometry_sub_id   INTEGER,
      wcs_json            TEXT,
      markers_json        TEXT,
      style_json          TEXT,
      created_at          TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.prepare(`
    INSERT OR IGNORE INTO settings (key, value)
    VALUES ('default_style', ?)
  `).run(JSON.stringify(PRESETS[DEFAULT_PRESET_NAME]));
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function getSetting(key: string): string | null {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    { value: string } | undefined;
  return row?.value ?? null;
}

export function upsertSetting(key: string, value: string): void {
  getDb().prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
}

export function getDefaultStyle(): StyleConfig {
  const raw = getSetting('default_style');
  return raw ? (JSON.parse(raw) as StyleConfig) : PRESETS[DEFAULT_PRESET_NAME];
}

// ── Annotations ──────────────────────────────────────────────────────────────

interface AnnotationRow {
  id: number;
  image_path: string;
  catalog_id: string | null;
  solve_status: string;
  astrometry_sub_id: number | null;
  wcs_json: string | null;
  markers_json: string | null;
  style_json: string | null;
  created_at: string;
  updated_at: string;
}

function rowToAnnotation(row: AnnotationRow): Annotation {
  return {
    id: row.id,
    imagePath: row.image_path,
    catalogId: row.catalog_id,
    solveStatus: row.solve_status as Annotation['solveStatus'],
    astrometrySubId: row.astrometry_sub_id,
    wcs: row.wcs_json ? (JSON.parse(row.wcs_json) as WCS) : null,
    markers: row.markers_json ? (JSON.parse(row.markers_json) as Marker[]) : [],
    styleOverride: row.style_json ? (JSON.parse(row.style_json) as StyleConfig) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAnnotationByPath(imagePath: string): Annotation | null {
  const row = getDb()
    .prepare('SELECT * FROM annotations WHERE image_path = ?')
    .get(imagePath) as AnnotationRow | undefined;
  return row ? rowToAnnotation(row) : null;
}

export function getAnnotationById(id: number): Annotation | null {
  const row = getDb()
    .prepare('SELECT * FROM annotations WHERE id = ?')
    .get(id) as AnnotationRow | undefined;
  return row ? rowToAnnotation(row) : null;
}

export function createAnnotation(imagePath: string): number {
  const result = getDb()
    .prepare(`INSERT INTO annotations (image_path) VALUES (?)`)
    .run(imagePath);
  return Number(result.lastInsertRowid);
}

export function upsertAnnotationPath(imagePath: string): number {
  const existing = getAnnotationByPath(imagePath);
  if (existing) return existing.id;
  return createAnnotation(imagePath);
}

export function updateAnnotationSolve(
  id: number,
  data: {
    solveStatus: string;
    astrometrySubId?: number | null;
    wcs?: WCS | null;
    markers?: Marker[] | null;
    catalogId?: string | null;
  },
): void {
  getDb()
    .prepare(`
      UPDATE annotations
      SET solve_status      = ?,
          astrometry_sub_id = COALESCE(?, astrometry_sub_id),
          wcs_json          = CASE WHEN ? IS NOT NULL THEN ? ELSE wcs_json END,
          markers_json      = CASE WHEN ? IS NOT NULL THEN ? ELSE markers_json END,
          catalog_id        = COALESCE(?, catalog_id),
          updated_at        = datetime('now')
      WHERE id = ?
    `)
    .run(
      data.solveStatus,
      data.astrometrySubId ?? null,
      data.wcs !== undefined ? 'x' : null,
      data.wcs != null ? JSON.stringify(data.wcs) : null,
      data.markers !== undefined ? 'x' : null,
      data.markers != null ? JSON.stringify(data.markers) : null,
      data.catalogId ?? null,
      id,
    );
}

export function resetAnnotationSolve(id: number): void {
  getDb()
    .prepare(`
      UPDATE annotations
      SET solve_status      = 'none',
          astrometry_sub_id = NULL,
          wcs_json          = NULL,
          markers_json      = NULL,
          updated_at        = datetime('now')
      WHERE id = ?
    `)
    .run(id);
}

export function resetStuckSolves(): void {
  getDb()
    .prepare(`UPDATE annotations SET solve_status = 'failed' WHERE solve_status IN ('solving', 'uploading')`)
    .run();
}

export function updateAnnotationMarkers(id: number, markers: Marker[]): void {
  getDb()
    .prepare(`UPDATE annotations SET markers_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(JSON.stringify(markers), id);
}

export function updateAnnotationStyle(id: number, style: StyleConfig | null): void {
  getDb()
    .prepare(`UPDATE annotations SET style_json = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(style ? JSON.stringify(style) : null, id);
}

export function updateAnnotationCatalogId(id: number, catalogId: string): void {
  getDb()
    .prepare(`UPDATE annotations SET catalog_id = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(catalogId, id);
}

export function getAnnotatedPaths(imagePaths: string[]): Set<string> {
  if (imagePaths.length === 0) return new Set();
  const placeholders = imagePaths.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT image_path FROM annotations WHERE image_path IN (${placeholders}) AND solve_status = 'solved'`)
    .all(...imagePaths) as { image_path: string }[];
  return new Set(rows.map(r => r.image_path));
}
