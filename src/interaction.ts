import { zoomExtents } from './stats';

export function setupInteraction(): void {
  const wrap = document.getElementById('canvasWrap')!;
  wrap.addEventListener('dblclick', zoomExtents);
}
