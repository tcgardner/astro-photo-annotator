import { useState } from 'react';
import type { CatalogPrefix, MarkerStyle } from '../types';

interface Props {
  x: number;
  y: number;
  defaultMarkerStyle: MarkerStyle;
  onConfirm: (label: string, catalog: CatalogPrefix, markerStyle: MarkerStyle) => void;
  onCancel: () => void;
}

const CATALOG_PREFIXES: CatalogPrefix[] = ['NGC', 'IC', 'M', 'PGC', 'custom'];

export function AddMarkerPopover({ x, y, defaultMarkerStyle, onConfirm, onCancel }: Props) {
  const [label, setLabel] = useState('');
  const [catalog, setCatalog] = useState<CatalogPrefix>('NGC');
  const [markerStyle, setMarkerStyle] = useState<MarkerStyle>(defaultMarkerStyle);

  function handleConfirm() {
    const trimmed = label.trim();
    if (!trimmed) return;
    onConfirm(trimmed, catalog, markerStyle);
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter') handleConfirm();
    if (e.key === 'Escape') onCancel();
  }

  function prefixLabel(prefix: string) {
    setCatalog(prefix as CatalogPrefix);
    setLabel(prev => {
      const cleaned = prev.replace(/^(NGC|IC|M|PGC)\s*/i, '').trim();
      return prefix === 'custom' ? cleaned : `${prefix} ${cleaned}`;
    });
  }

  return (
    <div
      className="absolute z-50 bg-gray-900 border border-gray-600 rounded-lg p-3 shadow-xl w-64"
      style={{ left: x + 12, top: y - 16 }}
      onClick={e => e.stopPropagation()}
    >
      <div className="text-xs text-gray-400 mb-2">Add marker</div>

      {/* Catalog prefix buttons */}
      <div className="flex gap-1 mb-2 flex-wrap">
        {CATALOG_PREFIXES.map(p => (
          <button
            key={p}
            onClick={() => prefixLabel(p)}
            className={`px-2 py-0.5 rounded text-xs border ${
              catalog === p
                ? 'bg-blue-600 border-blue-500 text-white'
                : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Label input */}
      <input
        autoFocus
        value={label}
        onChange={e => setLabel(e.target.value)}
        onKeyDown={handleKey}
        placeholder="e.g. NGC 7000"
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white mb-2 outline-none focus:border-blue-500"
      />

      {/* Marker style */}
      <div className="flex gap-1 mb-3">
        {(['circle', 'crosshair', 'dot'] as MarkerStyle[]).map(s => (
          <button
            key={s}
            onClick={() => setMarkerStyle(s)}
            className={`flex-1 py-0.5 rounded text-xs border capitalize ${
              markerStyle === s
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={!label.trim()}
          className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs py-1 rounded"
        >
          Add
        </button>
        <button
          onClick={onCancel}
          className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-300 text-xs py-1 rounded"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
