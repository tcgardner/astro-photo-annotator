import type { Marker, StyleConfig } from '../types';

interface Props {
  markers: Marker[];
  style: StyleConfig;
  onChange: (markers: Marker[]) => void;
}

export function ObjectList({ markers, style, onChange }: Props) {
  const visible = style.catalogs.length > 0
    ? markers.filter(m => style.catalogs.includes(m.catalog))
    : markers;

  function toggleVisible(id: string) {
    onChange(markers.map(m => m.id === id ? { ...m, visible: !m.visible } : m));
  }

  function remove(id: string) {
    onChange(markers.filter(m => m.id !== id));
  }

  if (markers.length === 0) {
    return <div className="text-xs text-gray-500 px-2 py-4 text-center">No markers yet</div>;
  }

  return (
    <div className="overflow-y-auto flex-1 text-xs">
      {visible.map(m => {
        const color = style.catalogColors[m.catalog] ?? '#ffffff';
        return (
          <div
            key={m.id}
            className={`flex items-center gap-2 px-2 py-1 border-b border-gray-800 hover:bg-gray-800 ${!m.visible ? 'opacity-40' : ''}`}
          >
            <span
              className="inline-block w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: color }}
            />
            <span className="flex-1 truncate font-mono" style={{ color }}>{m.label}</span>
            <button
              title={m.visible ? 'Hide' : 'Show'}
              onClick={() => toggleVisible(m.id)}
              className="text-gray-500 hover:text-gray-200 flex-shrink-0"
            >
              {m.visible ? '👁' : '—'}
            </button>
            <button
              title="Delete"
              onClick={() => remove(m.id)}
              className="text-gray-500 hover:text-red-400 flex-shrink-0"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
