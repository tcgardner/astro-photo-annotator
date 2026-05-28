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
