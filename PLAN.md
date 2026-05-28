# Astro Photo Annotator — Implementation Plan

## What this replaces

`astro-image-annotator/process-dso.ts` is a CLI-only batch script that:
- Plate solves each image via Astrometry.net
- Finds **one** DSO (the closest in the field center) via SIMBAD
- Stamps a single text label on the cropped image and saves it

This new app **fully replaces** it. The `astro-image-annotator/` directory will be deleted after the new app is complete. The replacement is a web-based interactive multi-object annotation editor supporting dense catalog labels, colored circles, crosshairs, per-image style configuration, and server-side export.

---

## Design Decisions

### 1. Stack — New standalone Express + React/Vite app

**Decision:** New standalone project in `astro-photo-annotator/`, same pattern as `seestar-imaging-logger` and `astro-db`.

**Rationale:** The existing tools follow a consistent shape — npm workspaces with an Express server in `src/` and a React/Vite/Tailwind UI in `ui/`. Adding this as a new sibling project keeps concerns isolated and matches what already works.

**Stack:**
- Express 5 server (`src/`) with `tsx` for dev
- React 18 + Vite 5 + Tailwind 3 UI (`ui/`)
- TypeScript everywhere, ESM, Node >= 24
- `concurrently` for `dev:all`
- Port **3003**

---

### 2. Image source — Direct filesystem with subdirectory navigation

**Decision:** The Express server reads from `STACKS_DIR` and exposes a folder-browsing API. The UI uses breadcrumb navigation, not a flat list.

**Rationale:** `STACKS_DIR` has subdirectories (e.g. per-target or per-session folders). A flat list would be unusable at scale. The browser starts at the `STACKS_DIR` root and lets the user drill into subdirectories.

**Folder browsing API:**
- `GET /api/images?path=` — lists the root of STACKS_DIR
- `GET /api/images?path=<relative/subpath>` — lists that subdirectory
- Each response entry is either `{ type: 'dir', name }` or `{ type: 'image', name, size, mtime, hasAnnotations }`
- `GET /api/images/file?path=<relative/path/to/image.jpg>` — serves the image file

`imageId` throughout the system is the **relative path from STACKS_DIR** (URL-encoded), e.g. `2025-10%2FNGC7000.jpg`. This uniquely identifies an image across subdirectories.

**Config (`.env`):**
```
STACKS_DIR=C:\Users\tcgar\astro\astrophoto\stacks
ASTROMETRY_API_KEY=gvdyxlfhhkjqdhdc
ASTRO_DB_URL=http://localhost:3001
PORT=3003
DB_PATH=./annotator.db
```

---

### 3. Annotation mechanism — Auto plate solve + full manual editing

**Decision:** Auto via Astrometry.net + SIMBAD is the primary workflow. Manual editing is a first-class capability, not a fallback.

**Plate solve → annotate flow:**
1. User navigates to an image in the browser, opens it in the editor
2. Clicks **Plate Solve** — server submits to Astrometry.net (polls until done, ~30–120s)
3. Server fetches calibration (RA, Dec, radius, pixscale, orientation) + runs SIMBAD query for all non-stellar objects in the field (TOP 200, ordered by distance from field center)
4. Server converts each object's RA/Dec → pixel (x, y) using WCS gnomonic projection
5. Returns structured annotation list; user sees markers auto-placed on the image
6. User edits: toggle visibility, drag to reposition, click X to delete, click empty space to add new markers
7. User configures style, then exports

**Manual editing interactions (SVG-based):**

| Action | How |
|--------|-----|
| Add marker | Click on empty image area → inline popover for label + marker style → confirm drops marker |
| Select marker | Click on existing marker element |
| Move marker | Drag selected marker to new position (updates x, y in state) |
| Delete marker | Click × button on selected marker, or press Delete key |
| Edit label | Double-click marker label |

The SVG overlay covers the full image area. Each marker is a `<g>` element with `pointer-events: all`. Drag is tracked via `onMouseDown` / `onMouseMove` / `onMouseUp` on the SVG root, with the active drag target identified by ID. Pixel coords are scaled between display size and original image dimensions on every state update.

If an image has not been plate solved, all markers must be placed manually (no auto-populate step).

---

### 4. Annotation persistence — SQLite, global default + per-image override

**Decision:** Annotations are saved to a local SQLite database (`annotator.db`). A `settings` table holds the global default `StyleConfig`. A per-image `style` column in the `annotations` table holds an override that, if present, takes precedence; if absent, the global default is used.

**Rationale:** Re-plate-solving takes 30–120 seconds per image. Saving to SQLite lets users close the app and resume editing without re-solving. A global default style removes friction for new sessions — the user sets it once and every new image starts with it. Per-image overrides are then saved only when the user actually changes something, leaving the column `NULL` for images that match the global default.

**Style resolution order (server-enforced, client mirrors it):**
```
per-image style (annotations.style) → global default (settings.value WHERE key='defaultStyle')
```
The `GET /api/annotations/:imageId` response always returns a resolved `style` field — the client never needs to implement the fallback itself.

**Schema:**
```sql
CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value      TEXT               -- JSON value
);
-- Seed row on first run:
-- INSERT OR IGNORE INTO settings VALUES ('defaultStyle', '<Dense preset JSON>');

CREATE TABLE annotations (
  image_path  TEXT PRIMARY KEY,   -- relative path from STACKS_DIR
  catalog_id  TEXT,               -- e.g. "NGC7000" — set from plate solve, editable before export
  plate_solve TEXT,               -- JSON: { ra, dec, radius, pixscale, orientation, jobId }
  objects     TEXT,               -- JSON: AnnotationObject[]
  style       TEXT,               -- JSON: StyleConfig override — NULL means use global default
  updated_at  TEXT
);
```

```typescript
interface AnnotationObject {
  id: string;
  label: string;            // e.g. "NGC 1499", "M 45", "PGC 14702"
  catalog: 'NGC' | 'IC' | 'M' | 'PGC' | 'custom';
  ra?: number;              // degrees, from SIMBAD — absent for manually placed markers
  dec?: number;
  x: number;                // pixel coords on the original image
  y: number;
  markerStyle: 'circle' | 'crosshair' | 'dot';
  visible: boolean;
}

interface StyleConfig {
  preset: 'dense' | 'minimal' | 'circles' | 'crosshairs' | 'custom';
  markerStyle: 'circle' | 'crosshair' | 'dot';
  circleRadius: number;           // px on original image
  strokeWidth: number;
  fontSize: number;
  catalogColors: Record<string, string>;  // catalog prefix → CSS color
  showLabels: boolean;
  labelOffset: { x: number; y: number };
}
```

---

### 5. Annotation style — global default, presets, and per-image overrides

**Global default:** Stored in `settings` as `key = 'defaultStyle'`, value is a full `StyleConfig` JSON blob. Editable from a dedicated **Settings panel** in the app (accessible via a gear icon in the nav). On first launch, the global default is seeded to the Dense preset.

**New annotation session flow:**
1. User opens an image that has no saved annotation record
2. Editor loads with style pre-filled from the global default
3. User can change style at any time; style changes are saved as a per-image override on the next auto-save
4. If the user never changes the style, no per-image override is written (the `style` column stays `NULL`)

**Returning to an annotated image:**
- If `annotations.style` is non-NULL: use it (per-image override)
- If `annotations.style` is NULL: fetch and apply `settings.defaultStyle`

The `GET /api/annotations/:imageId` response always returns a resolved `style` — the client never implements the fallback itself.

**Presets** are named shortcuts that populate all `StyleConfig` fields at once. They appear in both the Settings panel (to set the global default) and the per-image StylePanel (to reset to a known starting point). Four named presets match the styles observed in the reference images. Selecting a preset fills all style fields, which the user can then override individually. The final resolved style is what gets saved per image.

| Preset | Marker | Catalogs shown | Colors |
|--------|--------|----------------|--------|
| **Dense** | dot / crosshair | M, NGC, IC, PGC | NGC/IC red, PGC white/gray, M yellow |
| **Minimal** | circle | M, NGC, IC only | Red/coral, labels only for named objects |
| **Circles** (PixInsight-style) | circle (sized by object) | M, NGC, IC, PGC | Cyan circles, pink/red labels |
| **Crosshairs** | crosshair | M, NGC, IC | Red, clean |

**Per-catalog default colors:**
| Catalog | Default |
|---------|---------|
| M (Messier) | `#FFD700` (gold) |
| NGC / IC | `#FF6B6B` (coral red) |
| PGC | `#CCCCCC` (light gray) |
| custom | `#00FFFF` (cyan) |

**Label placement:** right of marker by default; auto-flipped to left if within 15% of the right image edge.

---

### 6. Annotation overlay — SVG over `<img>` for editing

**Decision:** SVG layer overlaid on a `<img>` tag in the editor; server-side `sharp` + SVG composite for export.

**Rationale:** SVG makes each marker an individual DOM element — click/drag/delete are straightforward without manual hit-testing. For export, `sharp` composites an SVG onto the full-resolution original image, the same approach already used in `process-dso.ts`. This gives precise interactive editing and lossless full-res export.

The SVG viewport matches the displayed image dimensions. All `x`, `y` values in state are stored in **original pixel coordinates**; the SVG `viewBox` is set to the original image dimensions so the browser scales automatically. This means no coordinate scaling math on the client — only on the server at export time.

```
<div style="position: relative; width: fit-content">
  <img src="/api/images/file?path=..." style="display: block" />
  <svg
    viewBox="0 0 {origW} {origH}"
    style="position: absolute; inset: 0; width: 100%; height: 100%"
  >
    {objects.map(obj => <MarkerGroup key={obj.id} {...obj} />)}
  </svg>
</div>
```

---

### 7. Export — Sharp composite in memory, uploaded to astro-db

**Decision:** `POST /api/export/:imageId` — server generates SVG from the saved annotation state, composites it onto the original image with `sharp` into an in-memory buffer, then POSTs that buffer to astro-db's `POST /api/images/upload` endpoint. No local file is written; astro-db owns storage.

**Rationale:** Keeping astro-db as the single source of truth for processed images means the annotated export appears automatically in the astro-db Images tab and in messier-poster tiles without any extra sync step. Sharp produces the composite in memory cleanly even for large files, so there's no need for a local staging path.

**Export flow:**
1. Load annotation record (objects + resolved style) from `annotator.db`
2. Generate a full-resolution SVG string from the annotation objects and style
3. `sharp(originalImagePath).composite([svgBuffer])` → JPEG/PNG `Buffer` in memory
4. POST multipart form to `ASTRO_DB_URL/api/images/upload`:

```
file            — the sharp output buffer (field name: "file")
catalog_id      — from the annotation session (e.g. "NGC7000")
filename        — "<basename>_annotated.<ext>"
original_filename — basename of the source file from STACKS_DIR
id_stage        — "annotated"
processed_at    — ISO 8601 timestamp of the export
captured_at     — (optional) from annotation metadata if known
```

The astro-db endpoint (`images.ts:16`) requires `file`, `catalog_id`, `filename`, `original_filename`, `id_stage`, and `processed_at`; it returns `{ id, filename, file_url }` on success.

5. Return `{ astroDbImageId, fileUrl }` to the client so the UI can show a confirmation link to the astro-db image.

**`catalog_id` sourcing:** The annotation session must record which DSO the image is of. After plate solving, the primary DSO name (top SIMBAD result, e.g. `"NGC 7000"`) is stored in the annotation record as `catalog_id`. The user can edit it before exporting. The annotator normalises it to astro-db's convention (e.g. `"NGC7000"`) before upload.

---

## File Structure

```
astro-photo-annotator/
├── src/
│   ├── server.ts                   # Express app, mounts all routers
│   ├── routes/
│   │   ├── images.ts               # GET /api/images, GET /api/images/file
│   │   ├── annotations.ts          # GET/POST /api/annotations/:imageId
│   │   ├── settings.ts             # GET/PUT /api/settings
│   │   ├── plate-solve.ts          # POST /api/plate-solve
│   │   └── export.ts               # POST /api/export/:imageId
│   ├── lib/
│   │   ├── astrometry.ts           # Astrometry.net login/upload/poll (ported from process-dso.ts)
│   │   ├── simbad.ts               # SIMBAD TAP query — all objects in field
│   │   ├── wcs.ts                  # RA/Dec → pixel conversion (gnomonic projection)
│   │   └── sharp-export.ts         # SVG → sharp composite → in-memory buffer → astro-db upload
│   └── db.ts                       # better-sqlite3 setup + annotations CRUD + settings CRUD
├── ui/
│   ├── src/
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   ├── pages/
│   │   │   ├── BrowserPage.tsx     # folder tree + breadcrumb navigation, image grid
│   │   │   ├── EditorPage.tsx      # annotation editor layout
│   │   │   └── SettingsPage.tsx    # global default style editor (gear icon in nav)
│   │   ├── components/
│   │   │   ├── FolderBrowser.tsx   # breadcrumb + directory listing
│   │   │   ├── ImageGrid.tsx       # grid of image thumbnails
│   │   │   ├── AnnotationCanvas.tsx # <img> + <svg> overlay + drag/drop interaction
│   │   │   ├── MarkerGroup.tsx     # SVG <g> for a single annotation object
│   │   │   ├── AddMarkerPopover.tsx # inline popover for label + style on new marker
│   │   │   ├── ObjectList.tsx      # sidebar list of annotation objects
│   │   │   ├── StylePanel.tsx      # preset picker + per-image style overrides
│   │   │   └── PlateSolveButton.tsx
│   │   ├── hooks/
│   │   │   ├── useAnnotations.ts   # load/save annotation state
│   │   │   ├── usePlateSolve.ts    # submit + poll plate solve
│   │   │   └── useDrag.ts          # SVG drag-and-drop logic
│   │   └── types.ts
│   ├── package.json
│   ├── vite.config.ts              # proxy /api → localhost:3003
│   └── tsconfig.json
├── .env
├── .env.example
├── package.json
├── tsconfig.json
└── start.ps1
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/images?path=<rel>` | List folder contents at `<rel>` within STACKS_DIR — returns dirs and image files |
| `GET` | `/api/images/file?path=<rel>` | Serve image file for `<img src>` |
| `GET` | `/api/annotations/:imageId` | Load annotation record; `style` is always resolved (per-image override ?? global default) |
| `POST` | `/api/annotations/:imageId` | Save annotation state (upsert); omit `style` to keep per-image override unchanged |
| `GET` | `/api/settings` | Return all settings (includes `defaultStyle` as a `StyleConfig`) |
| `PUT` | `/api/settings` | Body: `{ defaultStyle: StyleConfig }`. Upserts the global default style |
| `POST` | `/api/plate-solve` | Body: `{ imageId }`. Submits to Astrometry.net, polls, queries SIMBAD, returns `AnnotationObject[]` with pixel coords |
| `POST` | `/api/export/:imageId` | Composites annotations onto image in memory via sharp, uploads buffer to `ASTRO_DB_URL/api/images/upload`, returns `{ astroDbImageId, fileUrl }` |

`imageId` is the relative path from STACKS_DIR, URL-encoded (e.g. `2025-10%2FNGC7000.jpg`).

---

## WCS Pixel Conversion (wcs.ts)

Astrometry.net's calibration returns:
- `ra`, `dec` — field center (degrees)
- `pixscale` — arcseconds per pixel
- `orientation` — degrees east of north (position angle of up)
- `radius` — field radius (degrees)

Gnomonic (TAN) projection, object RA/Dec → pixel (x, y):

```
Δra  = (obj_ra  - center_ra) * cos(center_dec_rad)   // degrees
Δdec = obj_dec  - center_dec                          // degrees
r    = sqrt(Δra² + Δdec²)                             // degrees from center
px_dist = r * 3600 / pixscale                         // pixels from center
angle   = atan2(Δra, Δdec) - orientation_rad
x = img_cx + px_dist * sin(angle)
y = img_cy - px_dist * cos(angle)
```

Objects where `x < 0 || x > width || y < 0 || y > height` are discarded before returning to the client.

---

## Build Steps

1. **Delete `astro-image-annotator/`** — confirm with user, then remove the directory
2. **Scaffold `astro-photo-annotator/`** — `package.json` (workspaces: `["ui"]`), `tsconfig.json`, `.env`, `.env.example`, `start.ps1`
3. **Scaffold `ui/`** — React/Vite/Tailwind (same config shape as seestar-imaging-logger UI)
4. **Port to `src/lib/astrometry.ts`** — reuse login/upload/poll from `process-dso.ts`
5. **Implement `src/lib/simbad.ts`** — expand from top-1 to TOP 200 all non-stellar objects in field
6. **Implement `src/lib/wcs.ts`** — gnomonic projection
7. **Implement `src/db.ts`** — SQLite schema (both tables), seed `defaultStyle` row, `getAnnotation` / `upsertAnnotation` with fallback logic, `getSetting` / `upsertSetting`
8. **Implement Express routes** — images (folder browse + file serve), annotations (get/save with style resolution), settings (get/put), plate-solve, export
9. **Implement `src/lib/sharp-export.ts`** — generate SVG from annotation state, composite onto original image via sharp into an in-memory buffer, POST multipart to `ASTRO_DB_URL/api/images/upload` with required fields (`catalog_id`, `filename`, `original_filename`, `id_stage: "annotated"`, `processed_at`)
10. **Implement `BrowserPage`** — `FolderBrowser` + `ImageGrid` with breadcrumb navigation
11. **Implement `EditorPage`** layout — `AnnotationCanvas` + `ObjectList` sidebar + `StylePanel`
12. **Implement `AnnotationCanvas`** — `<img>` + `<svg>` overlay, `useDrag` hook, `AddMarkerPopover`, `MarkerGroup` with ×/edit controls
13. **Implement `StylePanel`** — preset picker (Dense/Minimal/Circles/Crosshairs) + per-field overrides, saved as per-image override; label indicates when the global default is active vs. a local override
14. **Implement `SettingsPage`** — same `StylePanel` wired to `GET /api/settings` / `PUT /api/settings`; gear icon in nav; shows which preset is the current global default
15. **Wire up `start.ps1`** and add entry to root `start-all.ps1`

---

## Fix Plan: Issue 1 — Image Source (astro-db instead of STACKS_DIR)

### Problem

The annotator browses a local `STACKS_DIR` folder and serves images via `express.static`. The user wants it to source images from astro-db's renamed-images catalog instead.

### Diagnosis

- `src/routes/images.ts` — `GET /api/images` reads the local filesystem via `readdir`; returns `{ folders, images }` with `url: /stacks/{rel}`
- `src/main.ts` — mounts `express.static(STACKS_DIR)` at `/stacks` and warns if `STACKS_DIR` is unset
- `src/routes/solve.ts` — resolves `path.resolve(STACKS_DIR, imagePath)` to get a local file path for Astrometry.net upload
- `src/routes/annotations.ts` — resolves `path.resolve(STACKS_DIR, ann.imagePath)` to read the original image for sharp export
- `ui/src/pages/EditorPage.tsx:29` — constructs image URL as `/stacks/${imagePath}`
- `ui/src/pages/BrowserPage.tsx` — folder-browser UI driven by `?path=` query param; uses `folders`, breadcrumbs, and subpath navigation
- `.env.example` — already has `ASTRO_DB_URL=http://localhost:3001`

astro-db provides:
- `GET /api/images` — returns `{ id, filename, original_filename, catalog_id, common_name, captured_at, id_stage, is_primary, created_at }[]`
- `GET /api/images/:id/file` — streams the image binary

### Key design decision: image identifier

**Before:** images identified by relative path string (e.g. `"2025-10/NGC7000.jpg"`), stored in `annotations.image_path`.

**After:** images identified by astro-db numeric ID (e.g. `42`). Store as the string `"<id>"` in `annotations.image_path` to avoid a schema migration (or rename the column — either works).

### Steps (in order)

**Step 1 — `src/routes/images.ts`: replace folder browse with astro-db proxy**

Delete the current implementation. New `GET /api/images`:
- Fetch `${ASTRO_DB_URL}/api/images` (with optional `?catalog_id=` passthrough)
- Map each row to `{ id, catalog_id, filename, common_name, url: `/api/images/${id}/file` }`
- Check which IDs already have annotations using `getAnnotatedPaths` (adapt to accept string IDs)
- Return `{ images: [...] }` — no `folders` field; flat list grouped by `catalog_id` if needed

Remove `/api/images/stat` (no longer needed; no local filesystem).

Add `GET /api/images/:id/file` — proxy to `${ASTRO_DB_URL}/api/images/${id}/file`. This keeps all requests on the same origin and avoids CORS.

Remove `STACKS_DIR` from this file.

**Step 2 — `src/main.ts`: remove STACKS_DIR**

- Delete the `express.static(STACKS_DIR)` block and the `STACKS_DIR` constant
- Delete the `if (!STACKS_DIR) console.warn(...)` line
- Keep `ASTRO_DB_URL` accessible to routes via env

**Step 3 — `ui/src/pages/BrowserPage.tsx`: replace folder browser with catalog grid**

- Drop `folders`, breadcrumb, `?dir=` param, `DirListing` type, `navigateInto`, `breadcrumbs()`, `setCurrentPath()`
- New shape: `{ images: { id: number; catalog_id: string; filename: string; url: string; hasAnnotations: boolean }[] }`
- Render a flat grid of image thumbnails; show `catalog_id` as primary label, `filename` as secondary
- On click: `navigate(`/annotate?id=${img.id}`)` (change param from `path` to `id`)
- Empty state message: "No images in astro-db. Upload some via astro-photo-renamer."

**Step 4 — `ui/src/pages/EditorPage.tsx`: switch to ID-based routing**

- Read `id` from `params.get('id')` instead of `params.get('path')`
- Image URL: `/api/images/${id}/file` (served by the new proxy in Step 1)
- Pass `imageId` (string `"${id}"`) to `useAnnotation` instead of `imagePath`

**Step 5 — `src/routes/solve.ts`: download image from astro-db for plate solving**

The solve route needs a local file path to upload to Astrometry.net (which requires a multipart file upload). Since images are no longer on disk locally:

- Change request body from `{ imagePath }` to `{ imageId }` (astro-db numeric ID)
- Before uploading to Astrometry.net, download the image from `${ASTRO_DB_URL}/api/images/${imageId}/file` into a temp file (use `node:os tmpdir + crypto.randomUUID()`)
- After upload to Astrometry.net, delete the temp file (cleanup in `finally`)
- For `sharp` metadata (image dimensions): run sharp on the same temp file before deleting it, or stream it twice
- Store `String(imageId)` as the annotation's `imagePath` in the DB

**Step 6 — `src/routes/annotations.ts`: download from astro-db for sharp export**

The export route reads the original image to composite annotations onto it:

- Replace `path.resolve(STACKS_DIR, ann.imagePath)` with a download from `${ASTRO_DB_URL}/api/images/${ann.imagePath}/file` (where `ann.imagePath` now holds the astro-db ID)
- Same temp-file pattern as Step 5 — download to temp, run sharp export, delete temp
- Remove `STACKS_DIR` import; `ASTRO_DB_URL` is already in scope

**Step 7 — `.env.example`: remove STACKS_DIR**

```
ASTROMETRY_API_KEY=your_astrometry_net_api_key
ASTRO_DB_URL=http://localhost:3001
PORT=3003
DB_PATH=./annotator.db
```

### Files changed

| File | Change |
|------|--------|
| `src/routes/images.ts` | Full rewrite — astro-db proxy, no filesystem |
| `src/main.ts` | Remove STACKS_DIR constant, static serve, and warning |
| `src/routes/solve.ts` | Accept `imageId`, download temp file, delete after |
| `src/routes/annotations.ts` | Download temp file for export instead of reading local path |
| `ui/src/pages/BrowserPage.tsx` | Flat catalog grid, no folder browser |
| `ui/src/pages/EditorPage.tsx` | `?id=` param, `/api/images/${id}/file` URL |
| `.env.example` | Remove `STACKS_DIR` line |

---

## Fix Plan: Issue 2 — Plate Solve Annotations Clustered at Center

### Problem

After plate solving, all annotation markers appear near the image center regardless of the actual positions of objects in the field.

### Diagnosis: confirmed bugs

**Bug A — RA wrapping (`src/lib/wcs.ts:11`)**

```typescript
const dRa = (objRa - wcs.ra) * Math.cos(centerDecRad);
```

This naive subtraction does not wrap at the 0°/360° boundary. For a field near RA = 1° containing objects at RA = 359°, `dRa` computes as `≈ −358°` instead of `≈ 2°`. The resulting `pxDist` is astronomically large; objects are filtered out by the bounds check. This removes objects near the RA boundary rather than placing them correctly.

Fix:
```typescript
const rawDRa = objRa - wcs.ra;
const dRa = ((rawDRa + 540) % 360 - 180) * Math.cos(centerDecRad);
```

**Bug B — Parity ignored (`src/lib/astrometry.ts:88`, `src/lib/wcs.ts`, `src/types.ts`)**

Astrometry.net's calibration endpoint returns a `parity` field (`+1` or `−1`). Parity = −1 is standard for astronomical images (north up, east left). Parity = +1 means the image is a mirror flip (east right).

`getCalibration` discards `parity`; the `WCS` type has no `parity` field. The pixel formula:
```typescript
const x = imgCx + pxDist * Math.sin(angle);
```
always places east to the right (positive x). For parity = −1 (standard), east should be to the LEFT — the x-offset needs to be negated.

Fixes (three-file change):

1. `src/types.ts` — add `parity: 1 | -1` to `WCS`
2. `src/lib/astrometry.ts` — capture `parity` from the calibration response and include it in the returned `WCS`
3. `src/lib/wcs.ts` — apply parity to the x offset:
   ```typescript
   const x = imgCx + wcs.parity * pxDist * Math.sin(angle);
   ```

**Bug C — Root cause of "all at center" (needs runtime investigation)**

The confirmed bugs (A and B) produce wrong positions or missing objects but do not fully explain why ALL objects would cluster precisely at the center. The clustering symptom requires `pxDist ≈ 0` for every object, which means `r ≈ 0`, which means every object's RA/Dec ≈ the field center.

Possible causes not determinable from static analysis:

1. **SIMBAD TAP column ordering** — The query selects `main_id, otype, ra, dec, dist`. If the SIMBAD TAP JSON response reorders columns or inserts extras, `row[2]` and `row[3]` may not be `ra`/`dec`. Fix: read column metadata from the TAP response (`metadata[].name`) and find `ra`/`dec` by name instead of by index.

2. **`pixscale` unit confusion** — If `pixscale` arrives as degrees/pixel rather than arcsec/pixel (e.g. due to a different Astrometry.net endpoint or a misread response), and the formula doesn't divide by 3600, the computed `pxDist` would be 3600× too small, clustering everything near center. Add a runtime assertion: `if (wcs.pixscale > 3600) throw new Error(...)`.

3. **`raDecToPixel` called before WCS is populated** — If the WCS object is partially initialized (e.g. `pixscale = 0`), `pxDist = Infinity → NaN`, and `Math.round(NaN) = NaN`. The bounds check `NaN < 0` is false, so NaN pixels pass the filter and the marker is stored with NaN coords. Depending on how the canvas renders NaN, it may appear at `(0, 0)` or at the center. Add a guard: `if (!wcs.pixscale || !isFinite(wcs.pixscale)) return null`.

### Prioritized fix order

1. **Add debug logging first** (no behavior change) — in `src/lib/simbad.ts`, before calling `raDecToPixel`, log `wcs.ra`, `wcs.dec`, `wcs.pixscale`, `wcs.parity`, and the first 3 rows' `ra`, `dec`, and computed `coords`. This confirms whether the clustering is in the math or upstream.

2. **Fix Bug B (parity)** — highest impact on correctness for standard astronomical images. Three-file change, low risk.

3. **Fix Bug A (RA wrapping)** — one-liner in `wcs.ts`. Fixes object loss near RA=0.

4. **Fix Bug C (column ordering)** — read SIMBAD TAP columns by name from `metadata`. Sample TAP JSON response:
   ```json
   { "metadata": [{"name":"main_id"}, {"name":"otype"}, {"name":"ra"}, ...], "data": [[...], ...] }
   ```
   Map column names to indices rather than hardcoding `row[2]`, `row[3]`.

5. **Guard against zero/NaN pixscale** — validate the WCS object in `getCalibration` before returning.

### Files changed

| File | Change |
|------|--------|
| `src/types.ts` | Add `parity: 1 \| -1` to `WCS` |
| `src/lib/astrometry.ts` | Capture `parity` from calibration; include in returned `WCS` |
| `src/lib/wcs.ts` | Fix RA wrapping; apply `wcs.parity` to x offset |
| `src/lib/simbad.ts` | Read column indices from TAP metadata; add debug logging |
