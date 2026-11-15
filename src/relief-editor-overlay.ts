import { completedCellGraph, cellGraphStatus, requestCellGraph, setCellGraphListener } from './relief-cell-graph';
import { noiseGeneration } from './noise/controller';
import { STATE } from './state';
import { planToScreen, screenToPlan, setCameraFromState, setPlanProjectionListener } from './render';
import { cellTool, editorIsActive, reliefEditor, selectedCell, selectCell, setEditorChangeListener, syncCellEditor } from './relief-editor-ui';
import { showToast } from './toast';
import type { ReliefProjectParams } from './relief-project';

type Handle = {x: number; y: number; label: string; xKey: keyof ReliefProjectParams; yKey: keyof ReliefProjectParams};
let canvas: HTMLCanvasElement;
let installed = false;
function handles(): Handle[] {
  const p = reliefEditor.pendingParams();
  if (!p) return [];
  const out: Handle[] = [];
  if (p.reliefAttractorMode !== 'none') out.push({x: p.reliefAttractorX * p.meshX, y: p.reliefAttractorY * p.meshY, label: `Anchor${reliefEditor.hasPending ? ' (pending)' : ''}`, xKey: 'reliefAttractorX', yKey: 'reliefAttractorY'});
  for (const i of [1, 2, 3] as const) {
    if (i > p.reliefRadialFociCount) break;
    const xKey = `reliefRadialFocus${i}X` as const, yKey = `reliefRadialFocus${i}Y` as const;
    out.push({x: p[xKey] * p.meshX, y: p[yKey] * p.meshY, label: `Focus ${i}${reliefEditor.hasPending ? ' (pending)' : ''}`, xKey, yKey});
  }
  return out;
}
export function drawCellOverlay(): void {
  if (!installed) return;
  canvas.hidden = STATE.viewMode !== 'plan' || !editorIsActive();
  if (canvas.hidden) return;
  const project = reliefEditor.view;
  if (!project) return;
  const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  const w = Math.round(rect.width * dpr), h = Math.round(rect.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d'); if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, rect.width, rect.height);
  const style = getComputedStyle(canvas), accent = style.getPropertyValue('--accent').trim(), text = style.getPropertyValue('--text').trim(), warn = style.getPropertyValue('--warn').trim();
  const graph = completedCellGraph();
  const status = document.getElementById('cellGraphStatus'); if (status) status.textContent = cellGraphStatus();
  if (graph) {
    const nodes = new Map(graph.nodes.map(node => [node.id, node]));
    ctx.strokeStyle = text; ctx.lineWidth = 1; ctx.globalAlpha = 0.7;
    for (const path of [...graph.inner, graph.outer]) {
      ctx.beginPath();
      path.nodes.forEach((id, i) => { const node = nodes.get(id)!; const p = planToScreen(node.x, node.y); if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y); });
      if (path.closed) ctx.closePath(); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  const {sites} = project;
  for (let i = 0; i < sites.ids.length; i++) {
    const point = planToScreen(sites.xy[i * 2], sites.xy[i * 2 + 1]);
    const selected = sites.ids[i] === selectedCell;
    ctx.beginPath(); ctx.arc(point.x, point.y, selected ? 7 : 3.5, 0, Math.PI * 2);
    ctx.fillStyle = sites.pinned[i] ? warn : accent; ctx.fill();
    if (selected) { ctx.strokeStyle = text; ctx.lineWidth = 2; ctx.stroke(); }
  }
  ctx.font = '13px monospace';
  for (const handle of handles()) {
    const p = planToScreen(handle.x, handle.y);
    ctx.strokeStyle = warn; ctx.lineWidth = 2; ctx.strokeRect(p.x - 8, p.y - 8, 16, 16);
    ctx.fillStyle = text; ctx.fillText(handle.label, p.x + 12, p.y - 10);
  }
}
function addCell(x: number, y: number): void {
  const before = new Set(reliefEditor.view!.sites.ids);
  reliefEditor.edit({kind: 'add', x, y});
  selectCell(reliefEditor.view!.sites.ids.find(id => !before.has(id)) ?? null);
}
function report(error: unknown): void { showToast(error instanceof Error ? error.message : String(error), 6000); }
export function setupCellOverlay(): void {
  if (installed) return; installed = true;
  canvas = document.getElementById('cellOverlay') as HTMLCanvasElement;
  setCellGraphListener(drawCellOverlay);
  noiseGeneration.subscribeFullRelief(() => { if (STATE.viewMode === 'plan' && editorIsActive()) void requestCellGraph(); });
  setPlanProjectionListener(drawCellOverlay); setEditorChangeListener(drawCellOverlay);
  const pointers = new Set<number>();
  let blocked = false;
  let drag: {id: number; site?: number; handle?: Handle; pan?: {x: number; y: number; panX: number; panY: number}} | null = null;
  const cancel = (): void => { if (drag && !drag.pan) reliefEditor.cancelGesture(); drag = null; };
  const local = (event: PointerEvent): {x: number; y: number} => {
    const rect = canvas.getBoundingClientRect(); return {x: event.clientX - rect.left, y: event.clientY - rect.top};
  };
  const world = (event: PointerEvent, dimensions = reliefEditor.view!.params): {x: number; y: number} => {
    const p = local(event), q = screenToPlan(p.x, p.y);
    return {x: Math.max(0, Math.min(dimensions.meshX, q.x)), y: Math.max(0, Math.min(dimensions.meshY, q.y))};
  };
  canvas.addEventListener('pointerdown', event => {
    event.preventDefault(); event.stopPropagation(); pointers.add(event.pointerId);
    canvas.setPointerCapture(event.pointerId);
    if (pointers.size > 1) { blocked = true; cancel(); return; }
    if (blocked || !editorIsActive()) return;
    canvas.focus({preventScroll: true});
    const p = local(event), project = reliefEditor.view!;
    if (event.button === 2 || event.shiftKey || event.button === 1) {
      drag = {id: event.pointerId, pan: {x: event.clientX, y: event.clientY, panX: STATE.panX, panY: STATE.panY}}; return;
    }
    let hit: number | null = null, distance = event.pointerType === 'touch' ? 22 : 12;
    for (let i = 0; i < project.sites.ids.length; i++) {
      const q = planToScreen(project.sites.xy[i * 2], project.sites.xy[i * 2 + 1]), d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < distance) { hit = project.sites.ids[i]; distance = d; }
    }
    try {
      if (cellTool === 'add') {
        const q = world(event); reliefEditor.beginGesture(); drag = {id: event.pointerId}; addCell(q.x, q.y); return;
      }
      const handle = handles().find(handle => { const q = planToScreen(handle.x, handle.y); return Math.hypot(q.x - p.x, q.y - p.y) <= (event.pointerType === 'touch' ? 22 : 14); });
      if (cellTool === 'move' && handle) { reliefEditor.beginGesture(); drag = {id: event.pointerId, handle}; return; }
      selectCell(hit);
      if (hit === null) return;
      if (cellTool === 'erase') { reliefEditor.beginGesture(); drag = {id: event.pointerId}; reliefEditor.edit({kind: 'erase', id: hit}); selectCell(null); return; }
      reliefEditor.beginGesture(); drag = {id: event.pointerId, site: hit};
    } catch (error: unknown) { cancel(); report(error); }
  });
  canvas.addEventListener('pointermove', event => {
    if (!drag || blocked || drag.id !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    if (drag.pan) { STATE.panX = drag.pan.panX + event.clientX - drag.pan.x; STATE.panY = drag.pan.panY + event.clientY - drag.pan.y; setCameraFromState(); return; }
    try {
      if (drag.site !== undefined) { const q = world(event); reliefEditor.move(drag.site, q.x, q.y); }
      else if (drag.handle) {
        const dimensions = reliefEditor.pendingParams()!, q = world(event, dimensions);
        reliefEditor.moveHandle({[drag.handle.xKey]: q.x / dimensions.meshX, [drag.handle.yKey]: q.y / dimensions.meshY});
      }
    } catch (error: unknown) { cancel(); report(error); }
  });
  const end = (event: PointerEvent): void => {
    pointers.delete(event.pointerId);
    if (event.type === 'pointercancel' || event.type === 'lostpointercapture') cancel();
    else if (drag?.id === event.pointerId) { if (!drag.pan) reliefEditor.commitGesture(); drag = null; }
    if (!pointers.size) blocked = false;
  };
  canvas.addEventListener('pointerup', end); canvas.addEventListener('pointercancel', end); canvas.addEventListener('lostpointercapture', end);
  canvas.addEventListener('keydown', event => {
    const project = reliefEditor.view; if (!project) return;
    try {
      if (event.key === 'Escape') { event.preventDefault(); cancel(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) reliefEditor.redo(); else reliefEditor.undo(); return; }
      if (['PageDown', 'PageUp', 'Home', 'End'].includes(event.key) && project.sites.ids.length) {
        const count = project.sites.ids.length, index = selectedCell === null ? -1 : project.sites.ids.indexOf(selectedCell);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? count - 1 : index < 0 ? event.key === 'PageUp' ? count - 1 : 0 : (index + (event.key === 'PageUp' ? -1 : 1) + count) % count;
        event.preventDefault(); selectCell(project.sites.ids[next]); return;
      }
      if (event.key === 'Enter' && cellTool === 'add') { event.preventDefault(); addCell(project.params.meshX / 2, project.params.meshY / 2); return; }
      const index = selectedCell === null ? -1 : project.sites.ids.indexOf(selectedCell);
      if (index < 0) return;
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); reliefEditor.edit({kind: 'erase', id: selectedCell!}); selectCell(null); return; }
      if (event.key === ' ') { event.preventDefault(); reliefEditor.pin(selectedCell!, !project.sites.pinned[index]); return; }
      const step = event.altKey ? 1 : event.shiftKey ? 0.1 : 0.01;
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, dy = event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0;
      if (dx || dy) {
        event.preventDefault(); reliefEditor.edit({kind: 'move', id: selectedCell!, x: Math.max(0, Math.min(project.params.meshX, project.sites.xy[index * 2] + dx)), y: Math.max(0, Math.min(project.params.meshY, project.sites.xy[index * 2 + 1] + dy))});
      }
    } catch (error: unknown) { report(error); }
    syncCellEditor(); drawCellOverlay();
  });
  window.addEventListener('blur', cancel);
  document.querySelectorAll('.mode-tab, .view-btn').forEach(button => button.addEventListener('click', () => { cancel(); drawCellOverlay(); }));
}
