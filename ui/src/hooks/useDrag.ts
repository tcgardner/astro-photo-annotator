import { useRef } from 'react';

export type DragMode = 'marker' | 'label' | 'resize';

export function useDrag(
  svgRef: React.RefObject<SVGSVGElement | null>,
  onMove: (id: string, x: number, y: number, mode: DragMode) => void,
  onEnd: () => void,
) {
  const draggingRef = useRef<{ id: string; mode: DragMode } | null>(null);
  const movedRef = useRef(false);       // true if pointer moved since mousedown
  const justDraggedRef = useRef(false); // stays true until consumed by the post-drag click

  function toSvgCoords(e: React.MouseEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const transformed = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: transformed.x, y: transformed.y };
  }

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

  // Returns true while dragging AND for the single click event immediately after a drag ends
  const isDragging = () => {
    if (draggingRef.current !== null) return true;
    if (justDraggedRef.current) {
      justDraggedRef.current = false; // consume the flag
      return true;
    }
    return false;
  };

  return { startDrag, onMouseMove, onMouseUp, isDragging, toSvgCoords };
}
