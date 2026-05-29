import type { Marker, MarkerStyleOverrides, StyleConfig } from '../types';

interface Props {
  marker: Marker;
  globalStyle: StyleConfig;
  onChange: (overrides: MarkerStyleOverrides) => void;
  onClear: () => void;
}

export function MarkerOverridePanel({ marker, globalStyle, onChange, onClear }: Props) {
  const ov = marker.overrides ?? {};
  const hasAny = ov.circleRadius !== undefined || ov.fontSize !== undefined
    || ov.labelOffset !== undefined || ov.labelDx !== undefined || ov.labelDy !== undefined
    || ov.showLeaderLine !== undefined;
  const hasLabelMove = ov.labelDx !== undefined || ov.labelDy !== undefined;

  function patch(partial: Partial<MarkerStyleOverrides>) {
    onChange({ ...ov, ...partial });
  }

  return (
    <div className="text-xs space-y-2">
      <label className="block">
        <span className="text-gray-400">
          Radius: {ov.circleRadius ?? globalStyle.circleRadius}px
          {ov.circleRadius === undefined && <span className="text-gray-600 ml-1">(global)</span>}
        </span>
        <input
          type="range" min={4} max={100}
          value={ov.circleRadius ?? globalStyle.circleRadius}
          onChange={e => patch({ circleRadius: parseInt(e.target.value, 10) })}
          className="w-full accent-indigo-500 mt-1"
        />
      </label>

      <label className="block">
        <span className="text-gray-400">
          Font: {ov.fontSize ?? globalStyle.fontSize}px
          {ov.fontSize === undefined && <span className="text-gray-600 ml-1">(global)</span>}
        </span>
        <input
          type="range" min={6} max={48}
          value={ov.fontSize ?? globalStyle.fontSize}
          onChange={e => patch({ fontSize: parseInt(e.target.value, 10) })}
          className="w-full accent-indigo-500 mt-1"
        />
      </label>

      <div>
        <div className="text-gray-400 mb-1">
          Label offset
          {ov.labelOffset === undefined && <span className="text-gray-600 ml-1">(global)</span>}
        </div>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="text-gray-500">X</span>
            <input
              type="number" min={-50} max={50}
              value={ov.labelOffset?.x ?? globalStyle.labelOffset.x}
              onChange={e => patch({ labelOffset: {
                x: parseInt(e.target.value, 10) || 0,
                y: ov.labelOffset?.y ?? globalStyle.labelOffset.y,
              }})}
              className="w-full bg-gray-800 text-white text-xs rounded px-1 py-0.5 border border-gray-700 mt-0.5"
            />
          </label>
          <label className="flex-1">
            <span className="text-gray-500">Y</span>
            <input
              type="number" min={-50} max={50}
              value={ov.labelOffset?.y ?? globalStyle.labelOffset.y}
              onChange={e => patch({ labelOffset: {
                x: ov.labelOffset?.x ?? globalStyle.labelOffset.x,
                y: parseInt(e.target.value, 10) || 0,
              }})}
              className="w-full bg-gray-800 text-white text-xs rounded px-1 py-0.5 border border-gray-700 mt-0.5"
            />
          </label>
        </div>
      </div>

      <div>
        <div className="text-gray-400 mb-1">
          Label position
          {!hasLabelMove && <span className="text-gray-600 ml-1">(drag label to move)</span>}
        </div>
        <div className="flex gap-2">
          <label className="flex-1">
            <span className="text-gray-500">dX</span>
            <input
              type="number" min={-2000} max={2000}
              value={ov.labelDx ?? 0}
              onChange={e => patch({ labelDx: parseInt(e.target.value, 10) || 0 })}
              className="w-full bg-gray-800 text-white text-xs rounded px-1 py-0.5 border border-gray-700 mt-0.5"
            />
          </label>
          <label className="flex-1">
            <span className="text-gray-500">dY</span>
            <input
              type="number" min={-2000} max={2000}
              value={ov.labelDy ?? 0}
              onChange={e => patch({ labelDy: parseInt(e.target.value, 10) || 0 })}
              className="w-full bg-gray-800 text-white text-xs rounded px-1 py-0.5 border border-gray-700 mt-0.5"
            />
          </label>
        </div>
        {hasLabelMove && (
          <label className="flex items-center gap-2 mt-2 cursor-pointer">
            <input
              type="checkbox"
              checked={ov.showLeaderLine ?? true}
              onChange={e => patch({ showLeaderLine: e.target.checked })}
              className="accent-indigo-500"
            />
            <span className="text-gray-400">Show leader line</span>
          </label>
        )}
      </div>

      {hasAny && (
        <button
          onClick={onClear}
          className="w-full py-1 text-xs text-gray-400 hover:text-white border border-gray-700 rounded hover:border-gray-500"
        >
          Clear overrides
        </button>
      )}
    </div>
  );
}
