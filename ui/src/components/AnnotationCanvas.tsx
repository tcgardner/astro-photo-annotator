import { useRef, useState } from 'react';
import { randomUUID } from '../util';
import type { Marker, StyleConfig, CatalogPrefix, MarkerStyle, WCS } from '../types';
import { pixelToRaDec } from '../lib/wcs';
import { MarkerGroup } from './MarkerGroup';
import { AddMarkerPopover } from './AddMarkerPopover';
import { useDrag } from '../hooks/useDrag';

interface PendingMarker {
  svgX: number;
  svgY: number;
  screenX: number;
  screenY: number;
}

interface Props {
  imageSrc: string;
  markers: Marker[];
  style: StyleConfig;
  wcs?: WCS | null;
  selectedId?: string | null;
  onSelectedIdChange?: (id: string | null) => void;
  onChange: (markers: Marker[]) => void;
}

export function AnnotationCanvas({ imageSrc, markers, style, wcs, selectedId: controlledSelectedId, onSelectedIdChange, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [imgDims, setImgDims] = useState({ width: 0, height: 0 });
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingMarker | null>(null);

  // Support both controlled (selectedId prop) and uncontrolled usage
  const selectedId = controlledSelectedId !== undefined ? controlledSelectedId : internalSelectedId;
  function setSelectedId(id: string | null) {
    setInternalSelectedId(id);
    onSelectedIdChange?.(id);
  }

  const { startDrag, onMouseMove, onMouseUp, isDragging, toSvgCoords } = useDrag(
    svgRef,
    (id, x, y) => {
      onChange(markers.map(m => {
        if (m.id !== id) return m;
        const updated: Marker = { ...m, x, y };
        // Back-calculate RA/Dec from new pixel position when WCS is available
        if (wcs && m.ra !== undefined && m.dec !== undefined) {
          const { ra, dec } = pixelToRaDec(x, y, wcs);
          updated.ra = ra;
          updated.dec = dec;
        }
        return updated;
      }));
    },
    () => { /* auto-saved by onChange */ },
  );

  function handleImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    setImgDims({ width: img.naturalWidth, height: img.naturalHeight });
  }

  function handleSvgClick(e: React.MouseEvent<SVGSVGElement>) {
    if (isDragging()) return;
    if (pending) { setPending(null); return; }
    setSelectedId(null);

    const { x: svgX, y: svgY } = toSvgCoords(e);

    // Convert to screen coords for popover position
    const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const scaleX = rect.width / (imgDims.width || 1);
    const scaleY = rect.height / (imgDims.height || 1);

    setPending({
      svgX: Math.round(svgX),
      svgY: Math.round(svgY),
      // rect is already in viewport coordinates (from getBoundingClientRect),
      // so no scrollX/Y adjustment needed here — the popover parent is position:fixed.
      screenX: svgX * scaleX + rect.left,
      screenY: svgY * scaleY + rect.top,
    });
  }

  function handleAddMarker(label: string, catalog: CatalogPrefix, markerStyle: MarkerStyle) {
    if (!pending) return;
    const marker: Marker = {
      id: randomUUID(),
      label,
      catalog,
      x: pending.svgX,
      y: pending.svgY,
      markerStyle,
      visible: true,
    };
    onChange([...markers, marker]);
    setPending(null);
  }

  function deleteMarker(id: string) {
    onChange(markers.filter(m => m.id !== id));
    setSelectedId(null);
  }

  function editLabel(id: string, label: string) {
    onChange(markers.map(m => m.id === id ? { ...m, label } : m));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      deleteMarker(selectedId);
    }
    if (e.key === 'Escape') { setSelectedId(null); setPending(null); }
  }

  return (
    <div className="relative inline-block" onKeyDown={handleKeyDown} tabIndex={0}>
      <img
        src={imageSrc}
        alt=""
        onLoad={handleImgLoad}
        className="block max-w-full max-h-[calc(100vh-8rem)] object-contain"
        draggable={false}
      />

      {imgDims.width > 0 && (
        <svg
          ref={svgRef}
          viewBox={"0 0 " + imgDims.width + " " + imgDims.height}
          className="annotation-svg absolute inset-0 w-full h-full"
          onClick={handleSvgClick}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {markers.map(m => (
            <MarkerGroup
              key={m.id}
              marker={m}
              style={style}
              imgWidth={imgDims.width}
              selected={selectedId === m.id}
              onSelect={e => { e.stopPropagation(); setSelectedId(m.id); }}
              onDragStart={startDrag(m.id)}
              onDelete={() => deleteMarker(m.id)}
              onLabelEdit={label => editLabel(m.id, label)}
            />
          ))}
        </svg>
      )}

      {pending && (
        <div className="fixed inset-0 pointer-events-none z-40">
          <div
            className="pointer-events-auto"
            style={{ position: 'absolute', left: pending.screenX, top: pending.screenY }}
          >
            <AddMarkerPopover
              x={0}
              y={0}
              defaultMarkerStyle={style.markerStyle}
              onConfirm={handleAddMarker}
              onCancel={() => setPending(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
