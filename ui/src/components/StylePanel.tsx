import type { StyleConfig, MarkerStyle } from '../types';
import { PRESETS, PRESET_NAMES } from '../presets';

interface Props {
  style: StyleConfig;
  defaultStyle: StyleConfig;
  isOverride: boolean;
  onChange: (style: StyleConfig) => void;
  onResetToDefault?: () => void;
}

const CATALOG_KEYS = ['NGC', 'IC', 'M', 'PGC', 'custom'] as const;

export function StylePanel({ style, isOverride, onChange, onResetToDefault }: Props) {
  function applyPreset(name: string) {
    const base = PRESETS[name];
    if (base) onChange({ ...base });
  }

  function patch(partial: Partial<StyleConfig>) {
    onChange({ ...style, ...partial, preset: 'custom' });
  }

  return (
    <div className="text-xs space-y-3">
      {/* Override badge */}
      <div className="flex items-center justify-between">
        <span className={`text-xs px-2 py-0.5 rounded ${isOverride ? 'bg-indigo-900 text-indigo-200' : 'bg-gray-800 text-gray-400'}`}>
          {isOverride ? 'Per-image override' : 'Using global default'}
        </span>
        {isOverride && onResetToDefault && (
          <button
            onClick={onResetToDefault}
            className="text-xs text-gray-500 hover:text-gray-300 underline"
          >
            Reset
          </button>
        )}
      </div>

      {/* Presets */}
      <div>
        <div className="text-gray-400 mb-1">Preset</div>
        <div className="grid grid-cols-2 gap-1">
          {PRESET_NAMES.map(name => (
            <button
              key={name}
              onClick={() => applyPreset(name)}
              className={`py-1 rounded border capitalize text-xs ${
                style.preset === name
                  ? 'bg-indigo-700 border-indigo-500 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {name}
            </button>
          ))}
        </div>
      </div>

      {/* Marker style */}
      <div>
        <div className="text-gray-400 mb-1">Marker</div>
        <div className="flex gap-1">
          {(['circle', 'crosshair', 'dot'] as MarkerStyle[]).map(s => (
            <button
              key={s}
              onClick={() => patch({ markerStyle: s })}
              className={`flex-1 py-1 rounded border capitalize text-xs ${
                style.markerStyle === s
                  ? 'bg-gray-600 border-gray-400 text-white'
                  : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Sliders */}
      <label className="block">
        <span className="text-gray-400">Radius: {style.circleRadius}px</span>
        <input type="range" min={4} max={40} value={style.circleRadius}
          onChange={e => patch({ circleRadius: parseInt(e.target.value, 10) })}
          className="w-full accent-indigo-500 mt-1" />
      </label>

      <label className="block">
        <span className="text-gray-400">Stroke: {style.strokeWidth}px</span>
        <input type="range" min={1} max={6} value={style.strokeWidth}
          onChange={e => patch({ strokeWidth: parseInt(e.target.value, 10) })}
          className="w-full accent-indigo-500 mt-1" />
      </label>

      <label className="block">
        <span className="text-gray-400">Font: {style.fontSize}px</span>
        <input type="range" min={6} max={24} value={style.fontSize}
          onChange={e => patch({ fontSize: parseInt(e.target.value, 10) })}
          className="w-full accent-indigo-500 mt-1" />
      </label>

      {/* Show labels toggle */}
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={style.showLabels}
          onChange={e => patch({ showLabels: e.target.checked })}
          className="accent-indigo-500"
        />
        <span className="text-gray-300">Show labels</span>
      </label>

      {/* Catalog filter */}
      <div>
        <div className="text-gray-400 mb-1">Show catalogs</div>
        <div className="flex flex-wrap gap-1">
          {CATALOG_KEYS.map(cat => {
            const active = style.catalogs.length === 0 || style.catalogs.includes(cat);
            return (
              <button
                key={cat}
                onClick={() => {
                  const current = style.catalogs.length === 0
                    ? CATALOG_KEYS.filter(c => c !== cat)
                    : style.catalogs.includes(cat)
                      ? style.catalogs.filter(c => c !== cat)
                      : [...style.catalogs, cat];
                  patch({ catalogs: current.length === CATALOG_KEYS.length ? [] : current });
                }}
                className={`px-2 py-0.5 rounded border text-xs ${
                  active
                    ? 'bg-gray-600 border-gray-400 text-white'
                    : 'bg-gray-900 border-gray-700 text-gray-500'
                }`}
              >
                {cat}
              </button>
            );
          })}
        </div>
      </div>

      {/* Per-catalog colors */}
      <div>
        <div className="text-gray-400 mb-1">Colors</div>
        <div className="space-y-1">
          {CATALOG_KEYS.map(cat => (
            <label key={cat} className="flex items-center gap-2">
              <input
                type="color"
                value={style.catalogColors[cat] ?? '#ffffff'}
                onChange={e => patch({ catalogColors: { ...style.catalogColors, [cat]: e.target.value } })}
                className="w-6 h-5 rounded border-0 bg-transparent cursor-pointer"
              />
              <span className="text-gray-300 w-12">{cat}</span>
              <span className="text-gray-600 font-mono">{style.catalogColors[cat] ?? '#ffffff'}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
