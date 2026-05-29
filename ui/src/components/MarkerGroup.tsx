import type { Marker, StyleConfig } from '../types';

interface Props {
  marker: Marker;
  style: StyleConfig;
  imgWidth: number;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDragStart: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onLabelEdit: (label: string) => void;
}

export function MarkerGroup({ marker, style, imgWidth, selected, onSelect, onDragStart, onDelete, onLabelEdit }: Props) {
  if (!marker.visible) return null;
  if (style.catalogs.length > 0 && !style.catalogs.includes(marker.catalog)) return null;

  const { x, y } = marker;
  const color = style.catalogColors[marker.catalog] ?? '#ffffff';
  // Per-marker overrides take precedence over global style
  const r = marker.overrides?.circleRadius ?? style.circleRadius;
  const sw = style.strokeWidth;
  const fontSize = marker.overrides?.fontSize ?? style.fontSize;
  const lo = marker.overrides?.labelOffset ?? style.labelOffset;
  const nearRight = x > imgWidth * 0.85;
  const labelX = nearRight ? x - r - lo.x : x + r + lo.x;
  const labelAnchor = nearRight ? 'end' : 'start';
  const labelY = y + lo.y;

  const highlightColor = selected ? '#facc15' : color;

  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    const newLabel = window.prompt('Edit label:', marker.label);
    if (newLabel !== null && newLabel.trim()) onLabelEdit(newLabel.trim());
  }

  const sharedProps = {
    onMouseDown: onDragStart,
    onClick: onSelect,
    style: { cursor: selected ? 'move' : 'pointer' },
  };

  let shape: React.ReactNode;

  if (marker.markerStyle === 'crosshair') {
    const gap = Math.round(r * 0.35);
    shape = (
      <g {...sharedProps}>
        <line x1={x - r} y1={y} x2={x - gap} y2={y} stroke={highlightColor} strokeWidth={sw} />
        <line x1={x + gap} y1={y} x2={x + r} y2={y} stroke={highlightColor} strokeWidth={sw} />
        <line x1={x} y1={y - r} x2={x} y2={y - gap} stroke={highlightColor} strokeWidth={sw} />
        <line x1={x} y1={y + gap} x2={x} y2={y + r} stroke={highlightColor} strokeWidth={sw} />
        {/* hit target */}
        <circle cx={x} cy={y} r={r + 4} fill="transparent" />
      </g>
    );
  } else if (marker.markerStyle === 'dot') {
    shape = (
      <circle
        cx={x} cy={y} r={Math.max(2, Math.round(r / 3))}
        fill={highlightColor}
        {...sharedProps}
      />
    );
  } else {
    shape = (
      <circle
        cx={x} cy={y} r={r}
        fill="none" stroke={highlightColor} strokeWidth={sw}
        {...sharedProps}
      />
    );
  }

  return (
    <g>
      {shape}
      {style.showLabels && (
        <text
          x={labelX} y={labelY}
          fontSize={fontSize}
          fill={highlightColor}
          textAnchor={labelAnchor}
          dominantBaseline="middle"
          stroke="black" strokeWidth={sw * 0.4} paintOrder="stroke fill"
          style={{ fontFamily: 'monospace', cursor: 'pointer' }}
          onDoubleClick={handleDoubleClick}
          onClick={onSelect}
        >
          {marker.label}
        </text>
      )}
      {selected && (
        <g
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ cursor: 'pointer' }}
        >
          <circle cx={x + r + 6} cy={y - r - 6} r={6} fill="#ef4444" />
          <text x={x + r + 6} y={y - r - 6} textAnchor="middle" dominantBaseline="middle" fontSize={9} fill="white">X</text>
        </g>
      )}
    </g>
  );
}
