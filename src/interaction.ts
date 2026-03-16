import { STATE } from './state';
import { renderViewport } from './render';
import { zoomExtents } from './stats';

export function setupInteraction(): void {
  const wrap = document.getElementById('canvasWrap')!;
  let dragMode: 'orbit' | 'pan' | null = null;
  let renderQueued = false;

  function queueRender(): void {
    if (!renderQueued) {
      renderQueued = true;
      requestAnimationFrame(() => { renderQueued = false; renderViewport(); });
    }
  }

  function syncSlider(key: string): void {
    const sl = document.getElementById('sl_' + key) as HTMLInputElement | null;
    const val = document.getElementById('val_' + key);
    const v = STATE[key as keyof typeof STATE] as number;
    if (sl) sl.value = String(v);
    if (val) val.textContent = typeof v === 'number' ?
      (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
  }

  // --- Mouse ---
  let dragStartX = 0, dragStartY = 0;
  let dragStartOrbit = 0, dragStartTilt = 0;
  let dragStartPanX = 0, dragStartPanY = 0;

  wrap.addEventListener('mousedown', e => {
    e.preventDefault();
    dragStartX = e.clientX; dragStartY = e.clientY;
    if (e.button === 2 || e.shiftKey || e.button === 1) {
      dragMode = 'pan';
      dragStartPanX = STATE.panX || 0;
      dragStartPanY = STATE.panY || 0;
      wrap.classList.add('panning');
    } else if (e.button === 0) {
      dragMode = 'orbit';
      dragStartOrbit = STATE.orbit;
      dragStartTilt = STATE.tilt;
      wrap.classList.add('dragging');
    }
  });

  window.addEventListener('mousemove', e => {
    if (!dragMode) return;
    const dx = e.clientX - dragStartX, dy = e.clientY - dragStartY;

    if (dragMode === 'orbit') {
      STATE.orbit = ((dragStartOrbit + dx * 0.4) % 360 + 360) % 360;
      STATE.tilt = Math.max(-90, Math.min(90, dragStartTilt + dy * 0.3));
      syncSlider('orbit'); syncSlider('tilt');
    } else if (dragMode === 'pan') {
      STATE.panX = dragStartPanX + dx;
      STATE.panY = dragStartPanY + dy;
    }
    queueRender();
  });

  window.addEventListener('mouseup', () => {
    dragMode = null;
    wrap.classList.remove('dragging', 'panning');
  });

  wrap.addEventListener('contextmenu', e => e.preventDefault());

  wrap.addEventListener('wheel', e => {
    e.preventDefault();

    const hasHorizScroll = !e.shiftKey && Math.abs(e.deltaX) > 1 && Math.abs(e.deltaY) < 1;

    if (e.shiftKey || hasHorizScroll) {
      let dx = e.deltaX, dy = e.deltaY;
      if (e.shiftKey && Math.abs(dx) > 1 && Math.abs(dy) < 1) {
        dy = dx;
        dx = 0;
      }
      // Screen-space pan, consistent with mouse-drag pan behavior.
      // No orbit compensation — panX/panY are screen-space offsets in render.ts.
      const panSpeed = 1.2;
      STATE.panX = (STATE.panX || 0) - dx * panSpeed;
      STATE.panY = (STATE.panY || 0) - dy * panSpeed;
      queueRender();
    } else {
      const delta = e.deltaY > 0 ? 0.92 : 1.08;
      STATE.zoom = Math.max(0.1, Math.min(10, STATE.zoom * delta));
      syncSlider('zoom');
      queueRender();
    }
  }, { passive: false });

  // --- Touch ---
  let touches: Touch[] = [], lastPinchDist = 0;
  let touchStartOrbit = 0, touchStartTilt = 0;

  wrap.addEventListener('touchstart', e => {
    e.preventDefault();
    touches = [...e.touches];
    if (touches.length === 2) {
      lastPinchDist = Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY);
    }
    dragStartX = touches[0].clientX; dragStartY = touches[0].clientY;
    touchStartOrbit = STATE.orbit;
    touchStartTilt = STATE.tilt;
  }, { passive: false });

  wrap.addEventListener('touchmove', e => {
    e.preventDefault();
    const cur = [...e.touches];

    if (cur.length === 1) {
      const dx = cur[0].clientX - dragStartX, dy = cur[0].clientY - dragStartY;
      STATE.orbit = ((touchStartOrbit + dx * 0.4) % 360 + 360) % 360;
      STATE.tilt = Math.max(-90, Math.min(90, touchStartTilt + dy * 0.3));
      syncSlider('orbit'); syncSlider('tilt');
    } else if (cur.length === 2) {
      const midX = (cur[0].clientX + cur[1].clientX) / 2;
      const midY = (cur[0].clientY + cur[1].clientY) / 2;
      if (touches.length >= 2) {
        const prevMidX = (touches[0].clientX + touches[1].clientX) / 2;
        const prevMidY = (touches[0].clientY + touches[1].clientY) / 2;
        STATE.panX = (STATE.panX || 0) + (midX - prevMidX);
        STATE.panY = (STATE.panY || 0) + (midY - prevMidY);
      }

      const dist = Math.hypot(cur[1].clientX - cur[0].clientX, cur[1].clientY - cur[0].clientY);
      if (lastPinchDist > 0) {
        const scale = dist / lastPinchDist;
        STATE.zoom = Math.max(0.1, Math.min(10, STATE.zoom * scale));
        syncSlider('zoom');
      }
      lastPinchDist = dist;
    }

    touches = [...cur];
    queueRender();
  }, { passive: false });

  wrap.addEventListener('touchend', e => {
    touches = [...e.touches];
    lastPinchDist = 0;
    if (touches.length === 1) {
      dragStartX = touches[0].clientX; dragStartY = touches[0].clientY;
      touchStartOrbit = STATE.orbit; touchStartTilt = STATE.tilt;
    }
  });

  wrap.addEventListener('dblclick', zoomExtents);
}
