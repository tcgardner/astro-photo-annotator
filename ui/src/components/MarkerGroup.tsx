import type { Marker, StyleConfig } from '../types';

interface Props {
  marker: Marker;
  style: StyleConfig;
  imgWidth: number;
  selected: boolean;
  onSelect: (e: React.MouseEvent) => void;
  onDragStart: (e: React.MouseEvent) => void;
  onLabelDragStart?: (e: React.MouseEvent) => void;
  onResizeDragStart?: (e: React.MouseEvent) => void;
  onDelete: () => void;
  onLabelEdit: (label: string) => void;
}

function circleEdgePoint(cx: number, cy: number, r: number, labelX: number, labelY: number) {
  const dx = labelX - cx;
  const dy = labelY - cy;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist === 0) return { x: cx, y: cy };
  return { x: cx + (dx / dist) * r, y: cy + (dy / dist) * r };
}

export function MarkerGroup({ marker, style, imgWidth, selected, onSelect, onDragStart, onLabelDragStart, onResizeDragStart, onDelete, onLabelEdit }: Props) {
  if (!marker.visible) return null;
  if (style.catalogs.length > 0 && !style.catalogs.includes(marker.catalog)) return null;

  const { x, y } = marker;
  const color = style.catalogColors[marker.catalog] ?? '#ffffff';
  const r = marker.overrides?.circleRadius ?? style.circleRadius;
  const sw = style.strokeWidth;
  const fontSize = marker.overrides?.fontSize ?? style.fontSize;
  const lo = marker.overrides?.labelOffset ?? style.labelOffset;

  let labelX: number;
  let labelY: number;
  let labelAnchor: "start" | "end";

  if (marker.overrides?.labelDx !== undefined || marker.overrides?.labelDy !== undefined) {
    const dx = marker.overrides.labelDx ?? 0;
    const dy = marker.overrides.labelDy ?? (r + fontSize + lo.y);
    labelX = x + dx;
    labelY = y + dy;
    labelAnchor = dx >= 0 ? 'start' : 'end';
  } else {
    const nearRight = x > imgWidth * 0.85;
    labelX = nearRight ? x - r - lo.x : x + r + lo.x;
    labelAnchor = nearRight ? 'end' : 'start';
    labelY = y + lo.y;
  }

  const labelDist = Math.sqrt((labelX - x) ** 2 + (labelY - y) ** 2);
  const autoShowLeader =
    (marker.overrides?.labelDx !== undefined || marker.overrides?.labelDy !== undefined) &&
    labelDist > r + 4;
  const drawLeaderLine = marker.overrides?.showLeaderLine ?? autoShowLeader;
  const leaderPt = circleEdgePoint(x, y, r, labelX, labelY);

  const highlightColor = selected ? '#facc15' : color;

  function handleDoubleClick(e: React.MouseEvent) {
    e.stopPropagation();
    const newLabel = window.prompt('Edit label:', marker.label);
    if (newLabel !== null && newLabel.trim()) onLabelEdit(newLabel.trim());
  }

  const sharedProps = {
    onMouseDown: onDragStart,
    onClick: onSelect,
    style: { cursor: selected ? 'grab' : 'pointer' } as React.CSSProperties,
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
      <g {...sharedProps}>
        <circle cx={x} cy={y} r={r} fill="none" stroke={highlightColor} strokeWidth={sw} />
        <circle cx={x} cy={y} r={r} fill="transparent" />
      </g>
    );
  }

  return (
    <g>
      {shape}
      {drawLeaderLine && style.showLabels && marker.markerStyle !== 'crosshair' && (
        <line
          x1={leaderPt.x} y1={leaderPt.y}
          x2={labelX} y2={labelY}
          stroke={highlightColor}
          strokeWidth={sw * 0.5}
          strokeDasharray="4 3"
          opacity={0.6}
          style={{ pointerEvents: 'none' }}
        />
      )}
      {style.showLabels && (
        <text
          x={labelX} y={labelY}
          fontSize={fontSize}
          fill={highlightColor}
          textAnchor={labelAnchor}
          dominantBaseline="middle"
          stroke="black" strokeWidth={sw * 0.4} paintOrder="stroke fill"
          style={{ fontFamily: 'monospace', cursor: selected ? 'grab' : 'pointer' }}
          onMouseDown={onLabelDragStart ?? onDragStart}
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
    </g>
  );
}
