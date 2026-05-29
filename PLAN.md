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

## UI Improvement Plan — 2026-05-29

Five issues diagnosed from reading `EditorPage.tsx`, `BrowserPage.tsx`, `StylePanel.tsx`, `MarkerOverridePanel.tsx`, and `ObjectList.tsx`.

---

### Issue 1 — Slider upper limits too small

**Problem:** The circle-radius slider is capped at 100px and the font-size slider at 48px. For larger images these limits are hit immediately.

**Files:** `ui/src/components/StylePanel.tsx`, `ui/src/components/MarkerOverridePanel.tsx`

**Changes:**

In `StylePanel.tsx`:
- Line 84: `<input type="range" min={4} max={100}` → change `max={100}` to `max={250}`
- Line 98: `<input type="range" min={6} max={48}` → change `max={48}` to `max={72}`

In `MarkerOverridePanel.tsx`:
- Line 29: `<input type="range" min={4} max={100}` → change `max={100}` to `max={250}`
- Line 42: `<input type="range" min={6} max={48}` → change `max={48}` to `max={72}`

No other files change. The `StyleConfig` type already stores these as plain numbers so there is no type constraint to update.

---

### Issue 2 — Editor sidebar overflows and clips content at the bottom

**Diagnosis:** The sidebar `div` at `EditorPage.tsx:70` uses `w-64 flex flex-col bg-gray-900 border-l border-gray-800 overflow-hidden`. Its parent is `flex h-[calc(100vh-3.5rem)] overflow-hidden`. Inside the sidebar, these children are `flex-shrink-0`:
- header (Back + image id + catalogId input)
- PlateSolveButton row
- marker count row
- MarkerOverridePanel (conditionally rendered, also `flex-shrink-0`)
- StylePanel
- Export button

Only the `ObjectList` wrapper (`flex-1 min-h-0 overflow-y-auto`) can scroll. When a marker is selected, the MarkerOverridePanel, StylePanel, and Export button are all `flex-shrink-0` but their combined height can exceed the viewport, and because the sidebar itself is `overflow-hidden`, the export button and the bottom of StylePanel are clipped with no way to reach them.

**Fix:** Wrap everything below the fixed top rows (i.e. below the marker-count row) in a single `overflow-y-auto` scroll region instead of using multiple `flex-shrink-0` blocks.

**Changes in `EditorPage.tsx`:**

Replace the current sidebar structure:
```
<div className="w-64 flex flex-col bg-gray-900 border-l border-gray-800 overflow-hidden">
  {/* header row — flex-shrink-0 */}
  {/* PlateSolve row — flex-shrink-0 */}
  {/* marker count row — flex-shrink-0 */}
  {/* ObjectList — flex-1 min-h-0 overflow-y-auto */}
  {/* MarkerOverridePanel — flex-shrink-0 */}
  {/* StylePanel — flex-shrink-0 */}
  {/* Export — flex-shrink-0 */}
</div>
```

With this structure:
```
<div className="w-64 flex flex-col bg-gray-900 border-l border-gray-800 overflow-hidden">
  {/* fixed top: header, PlateSolve, marker count — these stay flex-shrink-0 */}
  <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
    {/* ObjectList: flex-shrink-0 with a max-h, or just natural height */}
    {/* MarkerOverridePanel */}
    {/* StylePanel */}
    {/* Export button */}
  </div>
</div>
```

Specifically: remove `flex-1 min-h-0 overflow-y-auto` from the ObjectList wrapper, remove `flex-shrink-0` from the MarkerOverridePanel/StylePanel/Export wrappers, and instead wrap all of them (ObjectList through Export) in a single `<div className="flex-1 min-h-0 overflow-y-auto">`. The ObjectList inner `div` already has `overflow-y-auto flex-1` on it; inside the new scroll wrapper it should instead be `className="max-h-48 overflow-y-auto flex-shrink-0"` so it doesn't consume all the scroll space — or leave the ObjectList at natural height (no `flex-1`) so all panels scroll together.

The simplest approach: give ObjectList a fixed `max-h-48 overflow-y-auto` so it occupies at most 12rem, then everything else flows naturally inside the outer scroll container.

---

### Issue 3 — Resizable sidebar panel

**File:** `ui/src/pages/EditorPage.tsx`

**Design:** A draggable handle on the left edge of the sidebar lets the user resize it. Width is persisted to `localStorage`.

**Implementation steps:**

1. Add state at the top of `EditorPage`:
   ```ts
   const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
     const saved = localStorage.getItem('annotator-sidebar-width');
     return saved ? parseInt(saved, 10) : 256; // 256 = w-64 default
   });
   ```

2. Add a `useRef` for the drag-in-progress flag:
   ```ts
   const dragging = useRef(false);
   ```

3. Attach handlers to the sidebar wrapper — replace the static `w-64` class with inline style:
   ```tsx
   <div
     style={{ width: sidebarWidth }}
     className="flex flex-col bg-gray-900 border-l border-gray-800 overflow-hidden relative"
   >
   ```

4. Add a drag handle `div` as the first child of the sidebar:
   ```tsx
   <div
     className="absolute left-0 top-0 h-full w-1 cursor-col-resize hover:bg-indigo-500/40 z-10"
     onMouseDown={e => {
       e.preventDefault();
       dragging.current = true;
       const startX = e.clientX;
       const startW = sidebarWidth;
       const onMove = (ev: MouseEvent) => {
         if (!dragging.current) return;
         const delta = startX - ev.clientX; // drag left = wider
         const next = Math.min(600, Math.max(280, startW + delta));
         setSidebarWidth(next);
       };
       const onUp = () => {
         dragging.current = false;
         document.removeEventListener('mousemove', onMove);
         document.removeEventListener('mouseup', onUp);
         localStorage.setItem('annotator-sidebar-width', String(sidebarWidth));
       };
       document.addEventListener('mousemove', onMove);
       document.addEventListener('mouseup', onUp);
     }}
   />
   ```

5. The `localStorage.setItem` in `onUp` captures a stale closure; fix by storing width in a ref alongside state, or by using a `useEffect` that watches `sidebarWidth`:
   ```ts
   useEffect(() => {
     localStorage.setItem('annotator-sidebar-width', String(sidebarWidth));
   }, [sidebarWidth]);
   ```
   Remove the inline `localStorage.setItem` from `onUp`.

**Width clamp:** min 280px, max 600px.

---

### Issue 4 — Tabbed sidebar

**File:** `ui/src/pages/EditorPage.tsx`

**Design:** Replace the stacked panels with two tabs. Tab state lives in React (not URL) so switching tabs is instant and loses no form state.

**Tabs:**
- **"Markers"** tab: ObjectList (with its `max-h` scroll, from Issue 2) + MarkerOverridePanel (shown only when a marker is selected, same as now)
- **"Style"** tab: StylePanel + Export button

**Implementation:**

1. Add tab state:
   ```ts
   const [activeTab, setActiveTab] = useState<'markers' | 'style'>('markers');
   ```

2. Inside the sidebar, after the fixed top rows (header, PlateSolve, marker count), add a tab bar before the scroll region:
   ```tsx
   <div className="flex flex-shrink-0 border-b border-gray-800">
     {(['markers', 'style'] as const).map(tab => (
       <button
         key={tab}
         onClick={() => setActiveTab(tab)}
         className={`flex-1 py-1.5 text-xs capitalize border-b-2 transition-colors ${
           activeTab === tab
             ? 'border-indigo-500 text-white'
             : 'border-transparent text-gray-500 hover:text-gray-300'
         }`}
       >
         {tab}
       </button>
     ))}
   </div>
   ```

3. The scroll region (from Issue 2) conditionally renders based on `activeTab`:
   ```tsx
   <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-3">
     {activeTab === 'markers' && (
       <>
         <div className="max-h-48 overflow-y-auto border border-gray-800 rounded">
           <ObjectList markers={markers} style={style} onChange={updateMarkers} />
         </div>
         {selectedMarker && (
           <>
             <div className="text-xs text-gray-500 uppercase tracking-wider">
               Marker: {selectedMarker.label}
             </div>
             <MarkerOverridePanel ... />
           </>
         )}
       </>
     )}
     {activeTab === 'style' && (
       <>
         <StylePanel ... />
         <button onClick={exportImage} ...>Export to astro-db</button>
         {/* export result link */}
       </>
     )}
   </div>
   ```

4. The fixed header rows (Back, image id, catalogId input, PlateSolveButton, marker count) remain `flex-shrink-0` above the tab bar — they are always visible regardless of active tab.

5. Move the Export `div` (currently at lines 133–152) inside the `activeTab === 'style'` branch. Remove the outer `flex-shrink-0 px-3 py-3` wrappers for StylePanel and Export since they now live inside the scrollable region.

**State preservation:** Both tab contents are rendered with CSS `display: none` / `display: block` rather than conditional mounting if preserving unsaved slider state matters. However since all slider values are in the `style` object passed as props (lifted state in `useAnnotation`), unmounting and remounting the panels is safe — no local slider state is lost.

---

### Issue 5 — Browser page: more images, smaller tiles, scrolling

**File:** `ui/src/pages/BrowserPage.tsx`

**Diagnosis:** The outer `div` at line 35 is `className="p-4"` with no height constraint and no overflow setting. The page is rendered inside the app shell, which presumably has `h-screen` or similar on its outer container. Since `BrowserPage` itself doesn't set `h-full overflow-y-auto`, the grid overflows the shell and the shell clips it. Additionally, the image thumbnails use `w-full aspect-square object-cover` — in a 5-column grid on a 1280px viewport that's roughly 230×230px per tile, which is quite large.

**Changes in `BrowserPage.tsx`:**

1. Replace the outer `div className="p-4"` with a flex-column layout that fills the available viewport:
   ```tsx
   <div className="flex flex-col h-full overflow-hidden">
     {/* fixed header */}
     <div className="flex-shrink-0 px-4 pt-4 pb-2">
       <div className="text-xs text-gray-500 uppercase tracking-wider">astro-db images</div>
       {loading && <div className="text-gray-500 text-sm mt-2">Loading…</div>}
       {error && <div className="text-red-400 text-sm mt-2">{error}</div>}
     </div>
     {/* scrollable grid */}
     <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4">
       {/* grid here */}
     </div>
   </div>
   ```
   `h-full` works because the app shell gives the page container full remaining height below the nav bar (the same `h-[calc(100vh-3.5rem)]` approach used in `EditorPage.tsx`). Confirm the shell applies this — if not, use `h-[calc(100vh-3.5rem)]` directly on the outer div.

2. Change the grid to show more columns and smaller tiles. Replace:
   ```tsx
   <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
   ```
   with:
   ```tsx
   <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 gap-2">
   ```

3. Shrink the thumbnail. Replace:
   ```tsx
   <img ... className="w-full aspect-square object-cover opacity-80 group-hover:opacity-100" />
   ```
   with a fixed-size thumbnail:
   ```tsx
   <img
     src={img.url}
     alt={img.filename}
     className="w-full object-cover opacity-80 group-hover:opacity-100"
     style={{ height: '90px' }}
     loading="lazy"
   />
   ```
   The tile card itself gets a fixed width from the grid column; height comes from the image + label below.

4. Slim down the label area. Replace the current `<div className="p-1.5">` block with:
   ```tsx
   <div className="px-1 py-0.5">
     <div className="text-xs text-white truncate leading-tight">{img.catalog_id}</div>
     {img.hasAnnotations && (
       <div className="text-xs text-green-400 leading-tight">✓</div>
     )}
   </div>
   ```
   Drop `img.filename` from the tile (too long to read at small size; visible on hover or in the editor). Keep the "Annotated ✓" badge but as just `✓` without the word "Annotated".

**Summary of BrowserPage layout changes:**

| Element | Before | After |
|---------|--------|-------|
| Outer container | `p-4` (no scroll, no height) | `flex flex-col h-full overflow-hidden` |
| Grid container | `grid-cols-2…lg:grid-cols-5 gap-3` in a non-scrolling div | Inside `flex-1 min-h-0 overflow-y-auto`, `grid-cols-3…xl:grid-cols-10 gap-2` |
| Thumbnail | `w-full aspect-square` (~230px square) | `w-full h-[90px] object-cover` |
| Label | catalog_id + filename + "Annotated ✓" in `p-1.5` | catalog_id + "✓" in `px-1 py-0.5`, no filename |

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

---

## Fix Plan: 2026-05-28 — Four Improvements

### Issue 1 — SIMBAD returns 200 objects; filter to top 10–20 DSOs

**Root cause.** `querySimbadAll` in `src/lib/simbad.ts` issues `SELECT TOP 200` ordered only by angular distance from the field center (`ORDER BY dist ASC`). This returns up to 200 non-stellar objects with no preference for angular size or brightness, so faint, tiny background galaxies (PGC entries with sub-arcminute extents) crowd out the prominent nebulae or clusters that should dominate the annotation.

**Specific change — `src/lib/simbad.ts`.**

1. Add `galdim_majaxis` to the `SELECT` list. This SIMBAD column (type `REAL`, units arcmin) holds the major-axis angular size for nebulae, galaxies, open clusters, etc. It is `NULL` for point-like objects. Because we already filter out stellar types, most returned objects will have a value.

2. Replace `ORDER BY dist ASC` with a two-key sort:
   ```sql
   ORDER BY galdim_majaxis DESC, dist ASC
   ```
   Objects with the largest angular footprint float to the top; among equally-sized (or NULL) objects, proximity to field center breaks the tie. `NULL` sorts last naturally in SIMBAD's TAP (equivalent to `NULLS LAST`).

3. Lower the hard limit from `TOP 200` to `TOP 20`.

4. Update the `SimbadRow` interface to add `majAxis: number | null`.

5. Update the column-index resolution block:
   ```typescript
   const majAxisIdx = col('galdim_majaxis');
   ```
   Use it only for logging/future filtering; pixel placement is unchanged.

The complete revised ADQL:
```sql
SELECT TOP 20 main_id, otype, ra, dec, galdim_majaxis,
  DISTANCE(POINT('ICRS',ra,dec),POINT('ICRS',${wcs.ra},${wcs.dec})) AS dist
FROM basic
WHERE CONTAINS(
  POINT('ICRS',ra,dec),
  CIRCLE('ICRS',${wcs.ra},${wcs.dec},${wcs.radius})
)=1
AND otype NOT IN (${stellarList})
AND ra IS NOT NULL
AND dec IS NOT NULL
ORDER BY galdim_majaxis DESC, dist ASC
```

**Files changed:** `src/lib/simbad.ts` only — ADQL string, `SimbadRow` interface, column-index block.

---

### Issue 2 — Annotations still clustering at center; add diagnostics

**Root cause diagnosis (as-far-as-known).** The previously confirmed bugs (parity, RA wrap-around, SIMBAD column ordering) are all fixed in the current code. Yet clustering persists, which means `pxDist ≈ 0` for every object. The two remaining candidates:

- **`pixscale` unit mismatch.** If `getCalibration` in `src/lib/astrometry.ts` is reading `pixscale` in degrees/pixel rather than arcsec/pixel, then `(r * 3600) / pixscale` in `wcs.ts` yields a value 3600× too small. For example, a typical 1 arcsec/px image where the real pixscale is `1.0` but `wcs.pixscale` holds `0.000278` (degrees): a 0.1° separation object would compute `pxDist = (0.1 * 3600) / 0.000278 ≈ 129,000 px`, fail the bounds check, and be dropped — not cluster. But the reverse (pixscale stored as arcsec but field is actually tiny) would cause pxDist ≈ 0.

- **`wcs.radius` too small.** If `getCalibration` returns `radius` in degrees but the SIMBAD query passes it directly and the field is, say, 0.3°, that is fine. But if `radius` is accidentally in arcsec (e.g. 1080 arcsec for a 0.3° field), SIMBAD would return zero rows for `CIRCLE(..., 1080)` interpreted as degrees. Zero rows → no markers, not clustering.

- **The WCS values are correct but `raDecToPixel` returns `null` for everything except exactly the center.** The bounds check `x < 0 || x > wcs.width || y < 0 || y > wcs.height` discards out-of-frame objects. If all objects somehow end up at (NaN, NaN), `NaN < 0` is `false`, so they pass and become markers at position `(NaN, NaN)`. SVG renders `NaN` coords at the origin (0, 0) — not the center. So this is not the clustering cause.

**Plan: add targeted logging before making any math changes.**

**`src/lib/wcs.ts` — add per-call trace logging:**
```typescript
export function raDecToPixel(objRa: number, objDec: number, wcs: WCS) {
  console.log('[wcs] input  ra=%f dec=%f  center ra=%f dec=%f  pixscale=%f orientation=%f parity=%d',
    objRa, objDec, wcs.ra, wcs.dec, wcs.pixscale, wcs.orientation, wcs.parity);
  // ... existing math ...
  console.log('[wcs] dRa=%f dDec=%f r_deg=%f pxDist=%f angle_deg=%f  → x=%f y=%f (bounds: %dx%d)',
    dRa, dDec, r, pxDist, (angle * 180 / Math.PI), x, y, wcs.width, wcs.height);
  // ...
}
```
Guard the verbose lines: only log the first N calls (use a module-level counter, reset per solve) so the server isn't flooded for 200 objects. Log the first 5 unconditionally, skip the rest.

**`src/routes/solve.ts` — log WCS calibration immediately after `getCalibration` returns:**
```typescript
const wcs = await getCalibration(jobId, imgW, imgH);
console.log('[solve] WCS calibration:', JSON.stringify(wcs));
```
This surfaces the raw values from Astrometry.net so we can confirm `pixscale` unit, `parity`, and `radius` before SIMBAD is queried.

---

## Bug-fix batch — 2026-05-29

Five issues identified from code review. None implemented yet.

---

### Issue 1 — Per-marker circle resize via drag handle

**Root cause / current state:**  
`MarkerStyleOverrides.circleRadius` exists and is wired to a slider in `MarkerOverridePanel`, but there is no on-canvas way to resize a circle. `useDrag.ts` only supports `DragMode = 'marker' | 'label'`.

**Plan:**

**`ui/src/hooks/useDrag.ts`**  
Add `'resize'` to the union type:
```typescript
export type DragMode = 'marker' | 'label' | 'resize';
```
No other change needed in `useDrag` — the `onMove` callback already receives `(id, x, y, mode)` and the caller can dispatch on mode.

**`ui/src/components/MarkerGroup.tsx`**  
Add a new prop:
```typescript
onResizeDragStart?: (e: React.MouseEvent) => void;
```
When `selected === true` and `marker.markerStyle !== 'dot'`, render a drag handle at `(x + r, y)`:
```jsx
{selected && marker.markerStyle !== 'dot' && onResizeDragStart && (
  <circle
    cx={x + r}
    cy={y}
    r={6}
    fill="#60a5fa"
    stroke="white"
    strokeWidth={1}
    style={{ cursor: 'ew-resize' }}
    onMouseDown={e => { e.stopPropagation(); onResizeDragStart(e); }}
    onClick={e => e.stopPropagation()}
  />
)}
```
Place this inside the outer `<g>`, after the shape and before the delete button. The `onClick` stopper prevents the resize handle from triggering the canvas add-annotation flow.

**`ui/src/components/AnnotationCanvas.tsx`**  
Pass `onResizeDragStart={startDrag(m.id, 'resize')}` to each `<MarkerGroup>`.

In the `useDrag` `onMove` callback (the second argument to `useDrag`), add a `'resize'` branch:
```typescript
} else if (mode === 'resize') {
  onChange(markers.map(m => {
    if (m.id !== id) return m;
    const dist = Math.round(Math.sqrt((x - m.x) ** 2 + (y - m.y) ** 2));
    const newR = Math.max(10, dist);
    return {
      ...m,
      overrides: { ...m.overrides, circleRadius: newR },
    };
  }));
}
```
The `x, y` values passed to `onMove` are already in SVG coordinate space (via `toSvgCoords`), so `dist` is in image pixels — the same unit `circleRadius` uses.

---

### Issue 2 — Export button disabled without plate solve

**Root cause:**  
`EditorPage.tsx` line 217:
```typescript
disabled={!annotation || solveStatus !== 'solved' || loading}
```
This requires a completed plate solve. The helper text on line 222 reinforces this: "Plate solve first to export". But markers have `x, y` coordinates and can be manually placed; a WCS solve is not needed to composite them onto the image. The server-side export handler in `src/routes/annotations.ts` line 91 also hard-blocks:
```typescript
if (!ann.wcs) { res.status(400).json({ error: 'Image not plate-solved yet' }); return; }
```
And `sharp-export.ts`'s `buildSvg` takes `wcs: WCS` and uses it only for `const { width, height } = wcs`.

**Plan:**

**`ui/src/pages/EditorPage.tsx`**  
Change the button's `disabled` condition:
```typescript
disabled={!imageId || markers.length === 0 || loading}
```
Change the helper text:
```tsx
{markers.length === 0 && (
  <div className="text-xs text-gray-600 mt-1 text-center">Add markers to enable export</div>
)}
```

**`src/routes/annotations.ts`**  
Remove the hard WCS guard. Instead, fetch the image to get its natural dimensions when WCS is null:
```typescript
// Remove: if (!ann.wcs) { res.status(400)... }

// Get image dimensions for the SVG when there is no WCS
let svgWidth: number;
let svgHeight: number;
if (ann.wcs) {
  svgWidth = ann.wcs.width;
  svgHeight = ann.wcs.height;
} else {
  const meta = await sharp(imageBuffer).metadata();
  svgWidth = meta.width ?? 0;
  svgHeight = meta.height ?? 0;
}
```
Pass `svgWidth, svgHeight` to `exportAnnotatedImage` instead of `ann.wcs`.

**`src/lib/sharp-export.ts`**  
Change the signature of `buildSvg` and `exportAnnotatedImage` to accept dimensions directly instead of a full `WCS`:
```typescript
// buildSvg(markers, style, wcs: WCS) → buildSvg(markers, style, width: number, height: number)
function buildSvg(markers: Marker[], style: StyleConfig, width: number, height: number): string

// exportAnnotatedImage(..., wcs: WCS) → (..., width: number, height: number)
export async function exportAnnotatedImage(
  imageData: Buffer,
  outputFormat: 'jpeg' | 'png',
  markers: Marker[],
  style: StyleConfig,
  width: number,
  height: number,
): Promise<Buffer>
```
All existing call sites pass `wcs.width` / `wcs.height` — update them to pass the separate numbers. The `WCS` type no longer needs to be imported into `sharp-export.ts`.

---

### Issue 3 — Annotation centering accuracy (WCS debug endpoint)

**Root cause analysis:**

From reading `src/lib/wcs.ts`:

1. **Degrees vs radians** — `orientation` is correctly converted to radians (`wcs.orientation * Math.PI / 180`) before being passed to `Math.sin/cos`. ✓

2. **RA wrap-around** — `dRa` is normalised via `((rawDRa + 540) % 360 - 180)` before `Math.cos` scaling. ✓

3. **Display scaling** — The SVG has `viewBox="0 0 {imgDims.width} {imgDims.height}"` and is placed as `position: absolute; inset: 0; width: 100%; height: 100%`. SVG's own coordinate system is always in natural image pixels regardless of how the browser scales the element. Marker pixel coordinates from `raDecToPixel` are in that same space. **No scaling issue in canvas rendering.** ✓

4. **WCS width/height vs actual image** — `raDecToPixel` uses `wcs.width/wcs.height` to compute the image center (`imgCx, imgCy`) and to bound-check results. These values come from `getCalibration(jobId, imgW, imgH)` in `solve.ts`, which passes `sharp` metadata dimensions. If `sharp` returns a different size than the actual display image (e.g. for RAW files or EXIF rotation), the center would be wrong. **Possible issue.**

5. **Projection formula** — The current implementation is a simplified polar gnomonic, not a full TAN projection. It uses `atan2(dRa, dDec)` to get the angle from north, then projects radially. For objects near the field center (< 1°) this is accurate. For wide-field images or objects at the edges of the calibration radius, errors accumulate. **Known limitation, not a blocking bug.**

**Plan:**

**`src/routes/solve.ts`** — add a debug endpoint:
```typescript
// GET /api/solve/:jobId/debug
solveRouter.get('/:id/debug', (req, res) => {
  const id = parseInt(req.params['id'], 10);
  if (isNaN(id)) { res.status(400).json({ error: 'Invalid id' }); return; }

  const ann = getAnnotationById(id);
  if (!ann) { res.status(404).json({ error: 'Not found' }); return; }
  if (!ann.wcs) { res.status(400).json({ error: 'Not solved' }); return; }

  const first5 = ann.markers.slice(0, 5).map(m => ({
    label: m.label,
    ra: m.ra,
    dec: m.dec,
    x: m.x,
    y: m.y,
    computedPixel: (m.ra !== undefined && m.dec !== undefined)
      ? raDecToPixel(m.ra, m.dec, ann.wcs!)
      : null,
  }));

  res.json({ wcs: ann.wcs, sampleMarkers: first5 });
});
```
Add `import { raDecToPixel } from '../lib/wcs.js'` at the top. The `computedPixel` field re-runs the projection so we can compare the stored `x, y` against what the current code would produce (catches regressions after formula changes).

**`src/lib/wcs.ts`** — investigate `imgCx/imgCy` calculation:  
Add an explicit comment and check: if `wcs.width === 0 || wcs.height === 0`, log a warning. The issue may be that `getCalibration` returns `width/height` from Astrometry.net's own field estimate rather than from `sharp` metadata. Verify in `src/lib/astrometry.ts` that the `width` and `height` fields in the returned calibration object are being overridden with the `imgW/imgH` parameters passed to `getCalibration`.

**`src/lib/astrometry.ts`** — check `getCalibration` signature:  
```typescript
export async function getCalibration(jobId: number, imgW: number, imgH: number): Promise<WCS>
```
Confirm that the returned `WCS` object sets `width: imgW, height: imgH` (from the `sharp` metadata), not from Astrometry.net's calibration response. If it uses Astrometry.net's values, replace with the passed-in dimensions — Astrometry.net sometimes returns slightly rounded values.

---

### Issue 4 — Stroke width default too thin

**Root cause:**  
`dense` preset has `strokeWidth: 1`. All other presets have `strokeWidth: 2`. On high-resolution astrophotos these are barely visible. The `StylePanel.tsx` slider maxes at `6`, which is also too low.

**Plan:**

**`src/presets.ts`** and **`ui/src/presets.ts`** (both files need the same change):  
Change every preset's `strokeWidth` from its current value to `4`:
```typescript
// dense:      strokeWidth: 1  →  strokeWidth: 4
// minimal:    strokeWidth: 2  →  strokeWidth: 4
// circles:    strokeWidth: 2  →  strokeWidth: 4
// crosshairs: strokeWidth: 2  →  strokeWidth: 4
```

**`ui/src/components/StylePanel.tsx`** line 92 — raise the stroke slider max:
```tsx
<input type="range" min={1} max={12} value={style.strokeWidth}
```

**`ui/src/components/MarkerOverridePanel.tsx`** — there is currently no stroke width control in the per-marker override panel. This is acceptable; stroke width is a global style concern. No change needed here.

---

### Issue 5 — Add-annotation dialog fires on existing marker clicks and after drags

**Root causes (two separate bugs):**

**Bug A — Post-drag click opens the dialog:**  
In `useDrag.ts`, `onMouseUp` sets `draggingRef.current = null`. By the time the browser fires the `click` event (which always follows a `mouseup` on the same element), `isDragging()` returns `false`. `handleSvgClick` in `AnnotationCanvas.tsx` checks `isDragging()` at line 75 and gets `false`, so it proceeds to `setPending(...)`.

This happens specifically when you drag a marker — the `mouseup` lands on the SVG background (not on the marker, since the marker moved), so the marker's `onClick`/`stopPropagation()` never fires. The SVG receives both `mouseup` and then `click`, and the drag state is already cleared.

**Bug B — Click landing in the "hollow" of a circle hits the SVG:**  
Circle markers are rendered as `fill="none"` strokes. Clicking inside the circle but not on the thin stroke line hits the SVG background, not the circle element. The transparent hit-test `<circle>` in the crosshair branch (`r={r + 4} fill="transparent"`) doesn't have a click handler, so it also falls through. This means clicking anywhere near (but not on) a marker's stroke opens the add dialog.

**Plan:**

**`ui/src/hooks/useDrag.ts`** — track actual drag movement:
```typescript
const draggingRef = useRef<{ id: string; mode: DragMode } | null>(null);
const movedRef = useRef(false);       // true if pointer moved since mousedown
const justDraggedRef = useRef(false); // stays true through the click event after mouseup

function startDrag(id: string, mode: DragMode = 'marker') {
  return (e: React.MouseEvent) => {
    e.stopPropagation();
    draggingRef.current = { id, mode };
    movedRef.current = false;
  };
}

function onMouseMove(e: React.MouseEvent) {
  if (!draggingRef.current) return;
  e.preventDefault();
  movedRef.current = true;
  const { x, y } = toSvgCoords(e);
  onMove(draggingRef.current.id, Math.round(x), Math.round(y), draggingRef.current.mode);
}

function onMouseUp() {
  if (draggingRef.current) {
    if (movedRef.current) justDraggedRef.current = true;
    draggingRef.current = null;
    movedRef.current = false;
    onEnd();
  }
}

// Updated isDragging: also returns true in the brief window after a drag ends
const isDragging = () => {
  if (draggingRef.current !== null) return true;
  if (justDraggedRef.current) {
    justDraggedRef.current = false; // consume the flag
    return true;
  }
  return false;
};
```
`justDraggedRef` is set in `onMouseUp` when movement occurred, and consumed (cleared + returns true) in the very next `isDragging()` call, which is the post-drag `click` → `handleSvgClick`. This prevents the false add-annotation trigger after every drag.

**`ui/src/components/MarkerGroup.tsx`** — add transparent hit-test areas to all marker shapes:

For the `circle` variant, replace the bare `<circle fill="none">` with a `<g>` that includes a transparent filled hit-test circle:
```jsx
shape = (
  <g {...sharedProps}>
    <circle cx={x} cy={y} r={r} fill="none" stroke={highlightColor} strokeWidth={sw} />
    <circle cx={x} cy={y} r={r} fill="transparent" />
  </g>
);
```
The transparent `fill="transparent"` circle receives pointer events (SVG default is `pointer-events: visiblePainted`, but `fill="transparent"` counts as painted). This makes the entire circular area — not just the stroke — respond to clicks and drag starts. The `onMouseDown`/`onClick` bubble up to the `<g>` via `sharedProps`.

For the `crosshair` variant, the existing transparent `<circle cx={x} cy={y} r={r + 4} fill="transparent" />` already provides a hit area, but it has no event handler — it's a child of the `<g {...sharedProps}>` so events on it DO bubble up to the `<g>`. No change needed here.

For the `dot` variant, the dot is already a solid filled circle so it receives all pointer events. No change needed.

**`ui/src/components/AnnotationCanvas.tsx`** — add a `e.target === e.currentTarget` guard as a secondary safety net:
```typescript
function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
  if (isDragging()) return;
  if (e.target !== e.currentTarget) return; // click landed on a child element, not the SVG bg
  if (pending) { setPending(null); return; }
  // ...rest unchanged
}
```
This ensures that even if `stopPropagation` is ever missed on a marker child, the add dialog will not trigger. A click on the SVG background (`e.target === svgElement`) is the only intended trigger for the add-annotation flow.

**`src/lib/simbad.ts` — log the first 3 SIMBAD rows before calling `raDecToPixel`:**
```typescript
for (const [i, row] of json.data.entries()) {
  if (i < 3) {
    console.log('[simbad] row %d: main_id=%s ra=%f dec=%f majAxis=%s',
      i, String(row[mainIdIdx]), Number(row[raIdx]), Number(row[decIdx]),
      majAxisIdx >= 0 ? String(row[majAxisIdx]) : 'n/a');
  }
  // ... existing raDecToPixel call ...
}
```

**Interpretation guide (add as a code comment in `wcs.ts`):**
- If `[solve] WCS calibration` shows `pixscale < 0.1` → likely in degrees/pixel. Fix `getCalibration` to multiply by 3600.
- If `[wcs] pxDist` is always > `wcs.width` → all objects outside frame despite SIMBAD placing them in the cone. Implies `radius` used for SIMBAD query is wrong (too large), or `pixscale` unit is off in the other direction.
- If `[simbad] row 0` shows `ra=NaN` or `ra=0` for a non-zero object → column index resolution is still broken. Check that `raIdx !== decIdx`.
- If `pxDist ≈ 0` for every row despite correct-looking RA/Dec → `pixscale` is stored as deg/px (multiply by 3600 in `wcs.ts` line 17, changing `wcs.pixscale` to `wcs.pixscale / 3600`).

**Files changed:** `src/lib/wcs.ts` (logging + counter guard), `src/routes/solve.ts` (post-calibration log), `src/lib/simbad.ts` (pre-projection row log).

---

### Issue 3 — Delete and move annotations

**Root cause.** The delete button and drag wiring already exist in the component tree (`MarkerGroup` renders the ✕ button when `selected`, and `AnnotationCanvas` wires `useDrag`). There are two remaining gaps:

1. **Inverse WCS is not applied after drag.** `useDrag` calls `onChange(markers.map(m => m.id === id ? { ...m, x, y } : m))`, which updates pixel position but leaves `ra`/`dec` at their original plate-solved values. On the next export or re-solve, positions would revert to the RA/Dec-derived pixels. The marker's authoritative position should be the new `(x, y)` when dragged manually.

2. **`useDrag.ts` correctness and SVG-coordinate accuracy.** The drag hook must convert `mousemove` events to SVG coordinate space (not screen space). If it uses `clientX/clientY` directly without accounting for the SVG's `viewBox` scale, dragged markers jump to wrong positions. The hook should call `svgRef.current.createSVGPoint()` + `getScreenCTM().inverse()` to map screen coords to SVG coords.

**Implementation plan.**

**`ui/src/hooks/useDrag.ts` — verify/fix coordinate math.** The hook signature is already `(svgRef, onMove, onEnd)` where `onMove(id, x, y)` is called with SVG coordinates. If the coordinate transform is not using the CTM inverse, replace the coord mapping:
```typescript
function toSvgPoint(svg: SVGSVGElement, e: MouseEvent): { x: number; y: number } {
  const pt = svg.createSVGPoint();
  pt.x = e.clientX;
  pt.y = e.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  const svgPt = pt.matrixTransform(ctm.inverse());
  return { x: Math.round(svgPt.x), y: Math.round(svgPt.y) };
}
```

**`src/lib/wcs.ts` — add `pixelToRaDec` (inverse projection).** New exported function:
```typescript
export function pixelToRaDec(
  x: number,
  y: number,
  wcs: WCS,
): { ra: number; dec: number } {
  const imgCx = wcs.width / 2;
  const imgCy = wcs.height / 2;
  const centerDecRad = (wcs.dec * Math.PI) / 180;
  const orientationRad = (wcs.orientation * Math.PI) / 180;

  const dx = wcs.parity * (x - imgCx);
  const dy = -(y - imgCy);
  const pxDist = Math.sqrt(dx * dx + dy * dy);
  const r = (pxDist * wcs.pixscale) / 3600; // degrees

  const angle = Math.atan2(dx, dy) + orientationRad;
  const dDec = r * Math.cos(angle);
  const dRa = (r * Math.sin(angle)) / Math.cos(centerDecRad);

  const ra = ((wcs.ra + dRa) + 360) % 360;
  const dec = wcs.dec + dDec;
  return { ra, dec };
}
```

**`ui/src/components/AnnotationCanvas.tsx` — call `pixelToRaDec` after drag.** The `useDrag` `onMove` callback currently does:
```typescript
onChange(markers.map(m => m.id === id ? { ...m, x, y } : m));
```
Change it to also invoke the inverse WCS when the annotation has a solved WCS (passed as a new prop or accessed via context):
```typescript
// In AnnotationCanvas, accept optional wcs prop
const updatedMarker: Marker = { ...m, x, y };
if (wcs && m.ra !== undefined) {
  const { ra, dec } = pixelToRaDec(x, y, wcs);
  updatedMarker.ra = ra;
  updatedMarker.dec = dec;
}
onChange(markers.map(m => m.id === id ? updatedMarker : m));
```
If `wcs` is null (manually-placed marker with no plate solve), just update `x`/`y` and leave `ra`/`dec` undefined — this is already correct behavior.

**`ui/src/components/AnnotationCanvas.tsx` prop change.** Add `wcs?: WCS | null` to the `Props` interface. The parent `EditorPage` already has `annotation.wcs` in state via `useAnnotation`; pass it through.

**Files changed:** `src/lib/wcs.ts` (add `pixelToRaDec`), `ui/src/hooks/useDrag.ts` (fix CTM coordinate transform), `ui/src/components/AnnotationCanvas.tsx` (accept `wcs` prop, call inverse WCS in drag callback), `ui/src/pages/EditorPage.tsx` (pass `wcs` to `AnnotationCanvas`).

---

### Issue 4 — Per-marker size and position overrides

**Root cause.** `StyleConfig` holds global values for `circleRadius`, `strokeWidth`, `fontSize`, and `labelOffset`. `MarkerGroup` reads exclusively from the `style` prop with no per-marker escape hatch. There is no UI to select a marker and adjust its individual appearance.

**Data model change — `src/types.ts`.** Add optional override fields to `Marker`:
```typescript
export interface MarkerStyleOverrides {
  circleRadius?: number;
  fontSize?: number;
  labelOffset?: { x: number; y: number };
}

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
  overrides?: MarkerStyleOverrides;   // NEW — per-marker style overrides
}
```
All existing markers without `overrides` continue to work unchanged (field is optional).

**`ui/src/components/MarkerGroup.tsx` — resolve effective style.** At the top of the component, before rendering, merge per-marker overrides onto the global style:
```typescript
const r        = marker.overrides?.circleRadius ?? style.circleRadius;
const fontSize = marker.overrides?.fontSize     ?? style.fontSize;
const lo       = marker.overrides?.labelOffset  ?? style.labelOffset;
```
Replace all uses of `style.circleRadius`, `style.fontSize`, and `style.labelOffset` with `r`, `fontSize`, and `lo` respectively. `strokeWidth` has no per-marker override (keep as global only — stroke weight is a design-wide decision).

**`ui/src/components/MarkerOverridePanel.tsx` — new component.** A compact panel rendered in the right sidebar when a marker is selected. Props:
```typescript
interface Props {
  marker: Marker;
  globalStyle: StyleConfig;
  onChange: (overrides: MarkerStyleOverrides) => void;
  onClear: () => void;
}
```
Controls:
- **Radius** slider (range 4–60 px). Shows current effective value. Placeholder text "using global (N px)" when not overridden.
- **Font size** slider (range 6–32 px). Same pattern.
- **Label offset X/Y** — two number inputs (±50 px).
- **"Clear overrides"** button — calls `onClear()`, which removes the `overrides` field from the marker.

Each slider fires `onChange({ ...marker.overrides, circleRadius: newValue })` on change.

**`ui/src/components/AnnotationCanvas.tsx` or parent layout — wire the panel.** When `selectedId` is non-null, look up the marker and render `<MarkerOverridePanel>` in the sidebar. The `onChange` handler calls `updateMarkers(markers.map(m => m.id === selectedId ? { ...m, overrides: newOverrides } : m))`. The `onClear` handler does the same with `overrides: undefined`.

Exact placement decision: render `MarkerOverridePanel` in the existing right sidebar below the `StylePanel`, guarded by `selectedId !== null`. This avoids adding a floating panel that competes with the `AddMarkerPopover`.

**`src/lib/sharp-export.ts` — apply overrides at export time.** The export path generates SVG from marker state. For each marker, apply `marker.overrides?.circleRadius ?? style.circleRadius` and `marker.overrides?.fontSize ?? style.fontSize` when building the SVG element, so the exported image matches what the user sees in the editor.

**Files changed:** `src/types.ts` (add `MarkerStyleOverrides`, extend `Marker`), `ui/src/components/MarkerGroup.tsx` (resolve effective radius/fontSize/labelOffset), `ui/src/components/MarkerOverridePanel.tsx` (new file), parent layout (render `MarkerOverridePanel` when marker selected), `src/lib/sharp-export.ts` (apply per-marker overrides in SVG generation).

---

## Fix Plan: 2026-05-29 — Plate Solve Bugs

### Problem 1: Re-solve is blocked

**Symptom.** Once an image is `solved`, clicking Plate Solve returns the cached result immediately — the user can't force a fresh solve. The backend short-circuits at `solve.ts:42`:
```typescript
if (existing?.solveStatus === 'solved') {
  res.json({ id: annId, status: 'solved', wcs: existing.wcs, markers: existing.markers });
  return;
}
```
The button's "Solved ✓" label and `cursor-default` style give no affordance that it can be clicked.

**Fix — `src/routes/solve.ts`:**
- Remove the early-return bailout for `solved` status entirely.
- Before kicking off a new upload, call `resetAnnotationSolve(annId)` to null out `wcs_json`, `markers_json`, `astrometry_sub_id`, and set `solve_status = 'none'`. This ensures clients polling during a re-solve see clean state, not stale markers.

**Fix — `src/db.ts`:**
- Add `resetAnnotationSolve(id: number)`: sets `solve_status = 'none'`, nulls `wcs_json`, `markers_json`, `astrometry_sub_id`.

**Fix — `ui/src/components/PlateSolveButton.tsx`:**
- Change the `solved` label from `'Solved ✓'` to `'Re-solve ↺'`.
- Change the `solved` CSS from `bg-green-700 text-green-200 cursor-default` to `bg-green-800 hover:bg-green-700 text-green-200` so it looks clickable.

---

### Problem 2: Solve state stuck after server restart

**Symptom.** If the server dies while a solve is in progress (`solving` or `uploading`), the annotation stays stuck at that status in the DB. On next page load `useAnnotation` resumes polling, but no pipeline is running — it polls forever.

**Fix — `src/db.ts`:**
- Add `resetStuckSolves()`: `UPDATE annotations SET solve_status = 'failed' WHERE solve_status IN ('solving', 'uploading')`.

**Fix — `src/main.ts`:**
- Call `resetStuckSolves()` immediately after `getDb()` on startup, before the Express app mounts.

---

### Problem 3: Investigate consistent solve failures

**Symptom.** Plate solving fails every time without a clear error surfaced to the user.

**Likely root causes (in priority order):**
1. The `astrometryUpload` multipart body is malformed — the `new Blob([new Uint8Array(image.data)])` path changed from the previous working code and may not be sending a valid file to Astrometry.net.
2. `astrometryLogin` is failing silently (wrong API key, rate limit) — the error is swallowed by the outer try/catch which throws and Express returns a 500 with non-JSON body; the client's `r.json()` then throws a parse error, and the displayed `error` state is just `"SyntaxError: ..."` — not the underlying cause.
3. Stuck `solving`/`uploading` state (from Problem 2) prevents the route from being reached at all.

**Fix — `src/lib/astrometry.ts`:**
- In `astrometryLogin`, log the full response JSON on failure: `console.error('[astrometry] login response:', json)`.
- In `astrometryUpload`, log the full response JSON on failure: `console.error('[astrometry] upload response:', json)`.

**Fix — `src/routes/solve.ts`:**
- Add `console.log('[solve] starting for imageId=%s annId=%d', imageId, annId)` at the top of the handler to confirm the route is reached and no early-return is firing.

---

### Files changed

| File | Change |
|------|--------|
| `src/db.ts` | Add `resetAnnotationSolve(id)`, `resetStuckSolves()` |
| `src/main.ts` | Call `resetStuckSolves()` on startup |
| `src/routes/solve.ts` | Remove solved-bailout; call `resetAnnotationSolve` before new solve; add entry log |
| `src/lib/astrometry.ts` | Log full response on login/upload failure |
| `ui/src/components/PlateSolveButton.tsx` | "Re-solve ↺" label + clickable style for solved state |

---

## Improvement Plan: 2026-05-29 — UX Polish (Four Features)

### Feature 1 — Marker list height (ObjectList fills available sidebar space)

**Diagnosis.**

`EditorPage` renders the sidebar as:
```tsx
<div className="w-64 flex flex-col bg-gray-900 border-l border-gray-800 overflow-y-auto">
```

The sidebar has `overflow-y-auto` on the outer container AND `flex-col` — but several of its children (the header block, PlateSolveButton block, marker count line, MarkerOverridePanel block, StylePanel block, Export button block) are fixed-height `div`s with no `flex-shrink-0` constraint, and the `ObjectList` wrapper div has `flex-1 min-h-0` — which looks correct. However, the outer sidebar itself has `overflow-y-auto`, which causes the sidebar to scroll as a whole instead of letting the `ObjectList` section scroll internally. When the outer container overflows, the whole sidebar scrolls, and the inner `flex-1` on the ObjectList never gets space to grow because the parent's height is unconstrained by the outer scroll container.

**Root cause — confirmed by reading `EditorPage.tsx:70`:**
- Outer sidebar: `overflow-y-auto` → makes its height unconstrained (content-height), so `flex-1` children inside never fill remaining space
- ObjectList wrapper: `flex-1 min-h-0 overflow-y-auto` (line 100) — looks right, but the `flex-1` resolves to "1/∞ height" ≈ content size when the parent is scroll-unlimited
- `ObjectList` itself: `overflow-y-auto flex-1 text-xs` (its own div) — redundant `overflow-y-auto` on both wrapper and self

**Fix — `ui/src/pages/EditorPage.tsx`.**

Remove `overflow-y-auto` from the outer sidebar `div`. The sidebar is already inside a `h-[calc(100vh-3.5rem)]` parent with `overflow-hidden`. Without `overflow-y-auto`, the sidebar height is bounded by its parent, so `flex-1` on the ObjectList wrapper correctly fills remaining space.

Change line 70 from:
```tsx
<div className="w-64 flex flex-col bg-gray-900 border-l border-gray-800 overflow-y-auto">
```
to:
```tsx
<div className="w-64 flex flex-col bg-gray-900 border-l border-gray-800 overflow-hidden">
```

The ObjectList wrapper on line 100 already has `flex-1 min-h-0 overflow-y-auto` and `ObjectList` itself already has `overflow-y-auto flex-1` — those are correct and need no changes. The `MarkerOverridePanel` block (line 104), `StylePanel` block (line 122), and Export block (line 132) should each get `flex-shrink-0` to prevent them from being squashed by the growing ObjectList:

```tsx
// Lines 104, 122, 132 — add flex-shrink-0 to each wrapper div
<div className="flex-shrink-0 px-3 py-3 border-b border-gray-800">
```

**Files changed:** `ui/src/pages/EditorPage.tsx` — remove `overflow-y-auto` from sidebar wrapper, add `flex-shrink-0` to MarkerOverridePanel/StylePanel/Export wrapper divs.

---

### Feature 2 — Move/hide/resize individual plate-solved annotations

**Current state (confirmed by reading source):**

- **Drag** — already wired: `useDrag` in `AnnotationCanvas`, `startDrag(m.id)` passed as `onDragStart` to `MarkerGroup`, and `sharedProps.onMouseDown = onDragStart` applied to the shape element. Dragging the circle/crosshair/dot moves the whole marker.
- **Hide/show toggle** — already wired in `ObjectList.tsx` (eye button calls `toggleVisible`), and `MarkerGroup` returns `null` when `!marker.visible`. The `Marker.visible` field already exists in `src/types.ts`.
- **Per-marker circle radius** — already implemented end-to-end: `MarkerStyleOverrides.circleRadius` in `types.ts`, read by `MarkerGroup.tsx:21` (`marker.overrides?.circleRadius ?? style.circleRadius`), editable via `MarkerOverridePanel` radius slider (range 4–100), saved through `updateMarkers` in `EditorPage`, and applied at export in `sharp-export.ts:24`.

**What is missing / needs improvement:**

**2a — Drag handle visibility.** Currently the cursor only changes to `move` when `selected === true` (line 41 of `MarkerGroup.tsx`). Unselected markers show `pointer` cursor. There is no visual drag handle. Users may not discover that markers are draggable.

Fix — `ui/src/components/MarkerGroup.tsx`:
- When `selected === true`, render a small drag-handle indicator: a `<circle>` of radius 4 at `(x + r + 2, y)` filled with the highlight color and a `cursor: grab` style. This makes the affordance explicit.
- Alternatively (simpler): always show `cursor: grab` on the shape when selected instead of `cursor: move`. Either approach is acceptable.

**2b — The eye icon in ObjectList uses emoji `👁` (unicode) which may render poorly.** Replace with an SVG icon or ASCII toggle. Low priority — functional as-is.

**2c — Hide suppresses canvas rendering but canvas catalog filter (`style.catalogs`) can also hide markers.** Both code paths coexist correctly — `MarkerGroup` returns null for `!marker.visible` (line 15), and `ObjectList` dims opacity-40 for hidden markers. No change needed here.

**2d — Export correctly respects `visible` flag** — confirmed in `sharp-export.ts:18` (`if (!marker.visible) return ''`). No change needed.

**Summary of actual gaps:**
- The drag handle visual is the only UX gap for Feature 2. The rest is already implemented.
- Optionally: emit a `onDragStart` event from the label text as well, so users can drag by grabbing the text — currently only the shape element (`circle`/`crosshair`) fires `onDragStart`; the `<text>` element only fires `onClick={onSelect}` with no drag.

Fix for label-drag — `ui/src/components/MarkerGroup.tsx`: add `onMouseDown: onDragStart` to the `<text>` element (same `sharedProps` already used on the shape, or spread individually). This lets users drag either the circle or the label to move the whole marker.

**Files changed:** `ui/src/components/MarkerGroup.tsx` — add drag affordance to selected marker; add `onMouseDown={onDragStart}` to `<text>` element.

No data model changes needed for Feature 2.

---

### Feature 3 — Text label independent movement

**Goal:** Add `labelDx` and `labelDy` pixel offsets (relative to marker center) to each marker so the label can be repositioned independently from the circle. Make the label independently draggable in the canvas.

**3a — Data model — `src/types.ts`.**

Add two optional fields to `MarkerStyleOverrides`:
```typescript
export interface MarkerStyleOverrides {
  circleRadius?: number;
  fontSize?: number;
  labelOffset?: { x: number; y: number };  // existing — global offset from StyleConfig
  labelDx?: number;   // NEW — absolute pixel offset of label anchor from marker center (x)
  labelDy?: number;   // NEW — absolute pixel offset of label anchor from marker center (y)
}
```

`labelDx`/`labelDy` are absolute pixel positions relative to the marker center, independent of the `nearRight` flip logic. When set, they override the `nearRight`-based automatic placement entirely.

Default behavior (when `labelDx`/`labelDy` are `undefined`): existing `nearRight ? x - r - lo.x : x + r + lo.x` logic unchanged.

**3b — Label position resolution — `ui/src/components/MarkerGroup.tsx`.**

Replace the current label position computation (lines 25–28):
```typescript
// Current:
const nearRight = x > imgWidth * 0.85;
const labelX = nearRight ? x - r - lo.x : x + r + lo.x;
const labelAnchor = nearRight ? 'end' : 'start';
const labelY = y + lo.y;
```
With:
```typescript
// New:
let labelX: number;
let labelY: number;
let labelAnchor: string;

if (marker.overrides?.labelDx !== undefined || marker.overrides?.labelDy !== undefined) {
  // Independent label placement — override nearRight logic entirely
  const dx = marker.overrides.labelDx ?? 0;
  const dy = marker.overrides.labelDy ?? (r + fontSize + lo.y);
  labelX = x + dx;
  labelY = y + dy;
  labelAnchor = dx >= 0 ? 'start' : 'end';
} else {
  // Existing auto-placement
  const nearRight = x > imgWidth * 0.85;
  labelX = nearRight ? x - r - lo.x : x + r + lo.x;
  labelAnchor = nearRight ? 'end' : 'start';
  labelY = y + lo.y;
}
```

**3c — Independent label drag — `ui/src/hooks/useDrag.ts`.**

The current hook tracks a single `draggingId` that moves marker `x`/`y`. Label dragging needs to update `overrides.labelDx`/`overrides.labelDy` instead. Extend the hook to support a `dragMode`:

```typescript
type DragMode = 'marker' | 'label';

// Change internal ref:
const draggingRef = useRef<{ id: string; mode: DragMode } | null>(null);
```

Change the `startDrag` factory to accept a mode parameter:
```typescript
function startDrag(id: string, mode: DragMode = 'marker') {
  return (e: React.MouseEvent) => {
    e.stopPropagation();
    draggingRef.current = { id, mode };
  };
}
```

The `onMove` callback signature becomes:
```typescript
onMove: (id: string, x: number, y: number, mode: DragMode) => void
```

**3d — Wire label drag in `AnnotationCanvas.tsx`.**

Add a `startLabelDrag` function alongside `startDrag` in `AnnotationCanvas`, using `startDrag(m.id, 'label')`.

In the `useDrag` `onMove` callback, branch on mode:
```typescript
(id, x, y, mode) => {
  if (mode === 'marker') {
    // existing: update marker x, y (and RA/Dec if WCS available)
    onChange(markers.map(m => {
      if (m.id !== id) return m;
      const updated: Marker = { ...m, x, y };
      if (wcs && m.ra !== undefined) {
        const { ra, dec } = pixelToRaDec(x, y, wcs);
        updated.ra = ra;
        updated.dec = dec;
      }
      return updated;
    }));
  } else {
    // label drag: update overrides.labelDx/labelDy (relative to marker center)
    onChange(markers.map(m => {
      if (m.id !== id) return m;
      return {
        ...m,
        overrides: {
          ...m.overrides,
          labelDx: x - m.x,
          labelDy: y - m.y,
        },
      };
    }));
  }
}
```

Pass `startLabelDrag` as a new prop to `MarkerGroup`:
```typescript
// MarkerGroup Props interface — new prop:
onLabelDragStart: (e: React.MouseEvent) => void;
```

Apply it to the `<text>` element:
```tsx
<text
  ...
  onMouseDown={onLabelDragStart}   // was: not present (or just onDragStart)
  onClick={onSelect}
>
```

**3e — MarkerOverridePanel — expose labelDx/labelDy.**

Add two number inputs to `MarkerOverridePanel` below the existing "Label offset X/Y" section:

```tsx
<div>
  <div className="text-gray-400 mb-1">
    Label position (absolute)
    {ov.labelDx === undefined && <span className="text-gray-600 ml-1">(auto)</span>}
  </div>
  <div className="flex gap-2">
    <label className="flex-1">
      <span className="text-gray-500">dX</span>
      <input type="number" min={-500} max={500}
        value={ov.labelDx ?? 0}
        onChange={e => patch({ labelDx: parseInt(e.target.value, 10) || 0 })}
        className="w-full bg-gray-800 text-white text-xs rounded px-1 py-0.5 border border-gray-700 mt-0.5"
      />
    </label>
    <label className="flex-1">
      <span className="text-gray-500">dY</span>
      <input type="number" min={-500} max={500}
        value={ov.labelDy ?? 0}
        onChange={e => patch({ labelDy: parseInt(e.target.value, 10) || 0 })}
        className="w-full bg-gray-800 text-white text-xs rounded px-1 py-0.5 border border-gray-700 mt-0.5"
      />
    </label>
  </div>
</div>
```

Also update the `hasAny` check to include `labelDx`/`labelDy`:
```typescript
const hasAny = ov.circleRadius !== undefined || ov.fontSize !== undefined
  || ov.labelOffset !== undefined || ov.labelDx !== undefined || ov.labelDy !== undefined;
```

**3f — sharp-export.ts — apply `labelDx`/`labelDy`.**

In `buildMarkerSvg`, replace the current label position computation (lines 27–30) with the same branching logic as `MarkerGroup.tsx`:
```typescript
let labelX: number;
let labelY: number;
let labelAnchor: string;

if (marker.overrides?.labelDx !== undefined || marker.overrides?.labelDy !== undefined) {
  const dx = marker.overrides.labelDx ?? 0;
  const dy = marker.overrides.labelDy ?? (r + fontSize + lo.y);
  labelX = x + dx;
  labelY = y + dy;
  labelAnchor = dx >= 0 ? 'start' : 'end';
} else {
  const nearRightEdge = x > imgWidth * 0.85;
  labelX = nearRightEdge ? x - r - lo.x : x + r + lo.x;
  labelAnchor = nearRightEdge ? 'end' : 'start';
  labelY = y + lo.y;
}
```

**Files changed:**
| File | Change |
|------|--------|
| `src/types.ts` | Add `labelDx?: number`, `labelDy?: number` to `MarkerStyleOverrides` |
| `ui/src/hooks/useDrag.ts` | Add `DragMode` type; change `draggingId` ref to `{ id, mode }`; update `startDrag(id, mode)` signature; pass `mode` to `onMove` callback |
| `ui/src/components/AnnotationCanvas.tsx` | Branch `onMove` on mode ('marker' vs 'label'); add `startLabelDrag`; pass `onLabelDragStart` to `MarkerGroup` |
| `ui/src/components/MarkerGroup.tsx` | Accept `onLabelDragStart` prop; apply independent label position logic; attach `onMouseDown={onLabelDragStart}` to `<text>` |
| `ui/src/components/MarkerOverridePanel.tsx` | Add `labelDx`/`labelDy` inputs; update `hasAny` check |
| `src/lib/sharp-export.ts` | Apply `labelDx`/`labelDy` override in `buildMarkerSvg` |

---

### Feature 4 — Leader line from marker circle to text label

**Goal:** When the label has been moved away from its default position (i.e., `labelDx`/`labelDy` are set), draw a thin line from the edge of the circle to the label anchor point.

**4a — Data model — `src/types.ts`.**

Add `showLeaderLine?: boolean` to `MarkerStyleOverrides`:
```typescript
export interface MarkerStyleOverrides {
  circleRadius?: number;
  fontSize?: number;
  labelOffset?: { x: number; y: number };
  labelDx?: number;
  labelDy?: number;
  showLeaderLine?: boolean;  // NEW — default: true when labelDx/labelDy non-zero beyond threshold
}
```

**4b — Leader line rendering logic (shared between `MarkerGroup.tsx` and `sharp-export.ts`).**

The leader line runs from the circle edge to the label anchor. Circle edge point: intersection of the line from `(x, y)` toward `(labelX, labelY)` with the circle of radius `r`.

```typescript
function leaderLinePoints(
  cx: number, cy: number, r: number,
  labelX: number, labelY: number
): { x1: number; y1: number; x2: number; y2: number } {
  const dx = labelX - cx;
  const dy = labelY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return { x1: cx, y1: cy, x2: labelX, y2: labelY };
  const x1 = cx + (dx / dist) * r;
  const y1 = cy + (dy / dist) * r;
  return { x1, y1, x2: labelX, y2: labelY };
}
```

**Threshold for auto-show:** The leader line is shown when `showLeaderLine` is explicitly `true`, OR when `showLeaderLine` is `undefined` (the default) AND the label offset distance exceeds `r + 4` pixels:
```typescript
const dist = Math.sqrt((labelX - x) ** 2 + (labelY - y) ** 2);
const autoShow = dist > r + 4;
const drawLeaderLine = marker.overrides?.showLeaderLine ?? autoShow;
```

**4c — `ui/src/components/MarkerGroup.tsx`.**

Extract the `leaderLinePoints` helper (or inline it). After computing `labelX`/`labelY`, compute whether to show the leader line and render:

```tsx
{drawLeaderLine && style.showLabels && marker.markerStyle !== 'crosshair' && (
  <line
    x1={lp.x1} y1={lp.y1}
    x2={lp.x2} y2={lp.y2}
    stroke={highlightColor}
    strokeWidth={sw * 0.5}
    strokeDasharray="4 3"
    opacity={0.6}
    style={{ pointerEvents: 'none' }}
  />
)}
```

The `pointerEvents: none` ensures the line doesn't interfere with click/drag on the label. Place the `<line>` element before the `<text>` element in the `<g>` so it renders behind the label.

For `crosshair` markers, skip the leader line (the crosshair arms already extend outward; a leader line would be visually confusing).

**4d — `src/lib/sharp-export.ts` — add leader line to SVG.**

In `buildMarkerSvg`, after computing `drawLeaderLine` and `leaderLinePoints`, prepend a `<line>` element to the output:

```typescript
const leaderSvg = (drawLeaderLine && style.showLabels && marker.markerStyle !== 'crosshair')
  ? '<line x1="' + lp.x1.toFixed(1) + '" y1="' + lp.y1.toFixed(1)
    + '" x2="' + lp.x2.toFixed(1) + '" y2="' + lp.y2.toFixed(1) + '"'
    + ' stroke="' + color + '" stroke-width="' + (sw * 0.5).toFixed(1) + '"'
    + ' stroke-dasharray="4 3" opacity="0.6"/>'
  : '';
```

Include `leaderSvg` in each branch of the return value (circle, dot, crosshair — crosshair gets `''`).

**4e — `ui/src/components/MarkerOverridePanel.tsx` — toggle.**

Add a checkbox below the label position inputs:
```tsx
<label className="flex items-center gap-2 mt-1">
  <input
    type="checkbox"
    checked={ov.showLeaderLine ?? true}
    onChange={e => patch({ showLeaderLine: e.target.checked })}
    className="accent-indigo-500"
  />
  <span className="text-gray-400">Show leader line</span>
</label>
```

Only show this control when `labelDx`/`labelDy` are set (i.e., the label has been independently moved), to avoid confusing users who haven't moved their labels:
```tsx
{(ov.labelDx !== undefined || ov.labelDy !== undefined) && (
  <label ...>...</label>
)}
```

**Files changed:**
| File | Change |
|------|--------|
| `src/types.ts` | Add `showLeaderLine?: boolean` to `MarkerStyleOverrides` |
| `ui/src/components/MarkerGroup.tsx` | Compute `drawLeaderLine`, `leaderLinePoints`; render `<line>` before `<text>` |
| `src/lib/sharp-export.ts` | Compute `drawLeaderLine`, `leaderLinePoints`; prepend `<line>` SVG string in `buildMarkerSvg` |
| `ui/src/components/MarkerOverridePanel.tsx` | Add `showLeaderLine` checkbox (visible when labelDx/labelDy are set) |

---

### Cross-cutting notes

**`leaderLinePoints` duplication.** The same geometry function is needed in both `MarkerGroup.tsx` (React) and `sharp-export.ts` (Node). Options:
- Extract to `ui/src/lib/markerGeometry.ts` for the client side, and duplicate (or symlink) for the server. Given the function is 8 lines, duplication is acceptable.
- Alternatively, move it to `src/lib/markerGeometry.ts` (server-side shared lib) and import it in `sharp-export.ts`, while duplicating the same pure function in `ui/src/lib/markerGeometry.ts`. Since the server and client are separate TypeScript projects with separate `tsconfig.json` files, they cannot share source directly without a workspace package.

**Persistence.** All new fields (`labelDx`, `labelDy`, `showLeaderLine`) live inside `Marker.overrides` which is serialised as JSON in the `markers_json` DB column. No DB schema migration is needed — the column already stores arbitrary JSON, and the new fields are optional with backward-compatible defaults.

**Build order for implementation:**
1. Feature 1 (CSS fix) — isolated, no other dependencies
2. Feature 2 (drag handle + label drag wiring) — depends on no new types
3. Feature 3 (independent label position) — add types, update useDrag, wire AnnotationCanvas + MarkerGroup + MarkerOverridePanel + sharp-export
4. Feature 4 (leader line) — depends on Feature 3's `labelDx`/`labelDy` being in place
