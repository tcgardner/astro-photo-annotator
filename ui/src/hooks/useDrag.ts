import { useRef } from 'react';

export function useDrag(
  svgRef: React.RefObject<SVGSVGElement | null>,
  onMove: (id: string, x: number, y: number) => void,
  onEnd: () => void,
) {
  const draggingId = useRef<string | null>(null);

  function toSvgCoords(e: React.MouseEvent): { x: number; y: number } {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const transformed = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function startDrag(id: string) {
    return (e: React.MouseEvent) => {
      e.stopPropagation();
      draggingId.current = id;
    };
  }

  function onMouseMove(e: React.MouseEvent) {
    if (!draggingId.current) return;
    e.preventDefault();
    const { x, y } = toSvgCoords(e);
    onMove(draggingId.current, Math.round(x), Math.round(y));
  }

  function onMouseUp() {
    if (draggingId.current) {
      draggingId.current = null;
      onEnd();
    }
  }

  const isDragging = () => draggingId.current !== null;

  return { startDrag, onMouseMove, onMouseUp, isDragging, toSvgCoords };
}
