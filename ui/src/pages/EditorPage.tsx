import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAnnotation } from '../hooks/useAnnotation';
import { AnnotationCanvas } from '../components/AnnotationCanvas';
import { ObjectList } from '../components/ObjectList';
import { StylePanel } from '../components/StylePanel';
import { PlateSolveButton } from '../components/PlateSolveButton';

export function EditorPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const imagePath = params.get('path');

  const {
    annotation,
    markers,
    style,
    defaultStyle,
    solveStatus,
    loading,
    error,
    exportResult,
    plateSolve,
    updateMarkers,
    updateStyle,
    updateCatalogId,
    exportImage,
  } = useAnnotation(imagePath);

  const imageUrl = imagePath ? `/stacks/${imagePath.replace(/\\/g, '/')}` : '';
  const hasOverride = annotation?.style !== undefined;
  const isStyleOverride = hasOverride && JSON.stringify(annotation?.style) !== JSON.stringify(defaultStyle);

  function handleResetStyle() {
    updateStyle(defaultStyle);
  }

  if (!imagePath) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No image selected. <button onClick={() => navigate('/')} className="ml-2 text-blue-400 underline">Browse images</button>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] overflow-hidden">
      {/* Main canvas area */}
      <div className="flex-1 overflow-auto p-4 flex items-start justify-center bg-black">
        {imageUrl && (
          <AnnotationCanvas
            imageSrc={imageUrl}
            markers={markers}
            style={style}
            onChange={updateMarkers}
          />
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm">
            Working…
          </div>
        )}
      </div>

      {/* Right sidebar */}
      <div className="w-64 flex flex-col bg-gray-900 border-l border-gray-800 overflow-y-auto">
        {/* Image info */}
        <div className="px-3 py-2 border-b border-gray-800">
          <div className="text-xs text-gray-500 truncate" title={imagePath}>{imagePath}</div>
          {annotation?.catalogId && (
            <input
              value={annotation.catalogId}
              onChange={e => updateCatalogId(e.target.value)}
              className="mt-1 w-full bg-gray-800 text-white text-xs rounded px-2 py-1 border border-gray-700 outline-none focus:border-blue-500"
              placeholder="catalog_id for export"
            />
          )}
        </div>

        {/* Plate solve */}
        <div className="px-3 py-2 border-b border-gray-800">
          <PlateSolveButton status={solveStatus} onSolve={plateSolve} />
          {error && <div className="text-xs text-red-400 mt-1">{error}</div>}
        </div>

        {/* Object count */}
        <div className="px-3 py-1 border-b border-gray-800 text-xs text-gray-500">
          {markers.length} markers
          {style.catalogs.length > 0 && (
            <span className="ml-1 text-gray-600">
              ({markers.filter(m => style.catalogs.includes(m.catalog)).length} shown)
            </span>
          )}
        </div>

        {/* Object list */}
        <div className="flex-1 min-h-0 overflow-y-auto border-b border-gray-800">
          <ObjectList markers={markers} style={style} onChange={updateMarkers} />
        </div>

        {/* Style panel */}
        <div className="px-3 py-3 border-b border-gray-800">
          <div className="text-xs text-gray-500 uppercase tracking-wider mb-2">Style</div>
          <StylePanel
            style={style}
            defaultStyle={defaultStyle}
            isOverride={isStyleOverride}
            onChange={updateStyle}
            onResetToDefault={handleResetStyle}
          />
        </div>

        {/* Export */}
        <div className="px-3 py-3">
          <button
            onClick={exportImage}
            disabled={!annotation || solveStatus !== 'solved' || loading}
            className="w-full py-2 bg-green-700 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded"
          >
            Export to astro-db
          </button>
          {solveStatus !== 'solved' && (
            <div className="text-xs text-gray-600 mt-1 text-center">Plate solve first to export</div>
          )}
          {exportResult && (
            <div className="mt-2 text-xs text-green-400">
              Uploaded ✓{' '}
              <a href={exportResult.fileUrl} target="_blank" rel="noreferrer" className="underline">
                View in astro-db
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
