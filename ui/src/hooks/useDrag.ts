import { useRef } from 'react';

export type DragMode = 'marker' | 'label';

export function useDrag(
  svgRef: React.RefObject<SVGSVGElement | null>,
  onMove: (id: string, x: number, y: number, mode: DragMode) => void,
  onEnd: () => void,
) {
  const draggingRef = useRef<{ id: string; mode: DragMode } | null>(null);

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
    };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!draggingRef.current) return;
    e.preventDefault();
    const { x, y } = toSvgCoords(e);
    onMove(draggingRef.current.id, Math.round(x), Math.round(y), draggingRef.current.mode);
  }

  function onMouseUp() {
    if (draggingRef.current) {
      draggingRef.current = null;
      onEnd();
    }
  }

  const isDragging = () => draggingRef.current !== null;

  return { startDrag, onMouseMove, onMouseUp, isDragging, toSvgCoords };
}
