import { STATE } from './state';
import { captureInitialViewportFrame, resizeCanvas } from './render';
import { captureSidebarView, openFirstVisibleSection, restoreSidebarView, setSidebarPanePresentation, showSidebarPane, sidebarIsMobile } from './sidebar-state';

type Pane = 'shape' | 'generator' | 'view' | 'export' | 'sponsors';
type Snap = 'peek' | 'half' | 'full';
const panes: Pane[] = ['shape', 'generator', 'view', 'export', 'sponsors'];
const snaps: Snap[] = ['peek', 'half', 'full'];
let active: Pane = 'shape';
let previousControls: Exclude<Pane, 'sponsors'> = 'shape';
let snap: Snap = 'peek';
let installed = false;
const visitedPanes = new Set<Pane>(['shape']);
/** Live height while the handle is dragged; observers must not snap it back mid-gesture. */
let dragHeight: number | null = null;
const mobile = sidebarIsMobile;
const viewportIsMobile = (): boolean => matchMedia('(max-width: 900px)').matches;

/** Only presentation state lives here. Generation controls remain their original DOM nodes. */
export function syncMobilePanes(): void {
  if (!installed) return;
  const label = STATE.mode === 'noise' ? STATE.noiseType === 'voronoi-relief' ? 'Relief' : 'Noise' : STATE.mode === 'depthmap' ? 'Image' : 'Drape';
  document.getElementById('controlsPane')!.dataset.activeTask = active === 'sponsors' ? previousControls : active;
  document.getElementById('tab-generator')!.textContent = label;
  document.getElementById('sidebar')!.dataset.summary = `${label} · ${Number(STATE.meshX.toFixed(3))} x ${Number(STATE.meshY.toFixed(3))} in`;

  document.querySelectorAll<HTMLElement>('[data-control-pane]').forEach(pane => {
    const selected = pane.dataset.controlPane === active;
    pane.dataset.mobileHidden = String(!selected);
    if (mobile()) {
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', `tab-${pane.dataset.controlPane}`);
    } else {
      pane.removeAttribute('role');
      pane.removeAttribute('aria-labelledby');
    }
  });
  for (const pane of panes) {
    const tab = document.getElementById(`tab-${pane}`)!;
    tab.setAttribute('aria-selected', String(active === pane));
    tab.tabIndex = active === pane ? 0 : -1;
  }
  const sponsors = document.getElementById('sponsorsPane')!;
  if (mobile()) {
    sponsors.setAttribute('role', 'tabpanel');
    sponsors.setAttribute('aria-labelledby', 'tab-sponsors');
  } else {
    sponsors.removeAttribute('role');
    sponsors.setAttribute('aria-labelledby', 'sponsorsHeading');
  }
}

export function selectMobilePane(pane: Pane, focus = false): void {
  showSidebarPane(pane === 'sponsors' ? 'sponsors' : 'controls', false, () => {
    if (pane !== 'sponsors') previousControls = pane;
    active = pane;
    if (mobile() && pane === 'export') setSheetSnap('full');
    else if (mobile() && snap === 'peek') setSheetSnap('half');
  });
  if (mobile() && !visitedPanes.has(pane)) {
    visitedPanes.add(pane);
    const host = document.querySelector(`[data-control-pane="${pane}"]`);
    if (host) openFirstVisibleSection(host);
  }
  if (focus) restoreSidebarView();
}

function availableHeight(): number {
  return Math.max(0, (window.visualViewport?.height ?? innerHeight) - document.querySelector<HTMLElement>('.header')!.getBoundingClientRect().height - parseFloat(getComputedStyle(document.body).paddingTop || '0'));
}

function peekHeight(): number {
  return 120 + parseFloat(getComputedStyle(document.getElementById('sidebar')!).paddingBottom || '0');
}

function snapHeight(value: Snap): number {
  const available = availableHeight();
  return Math.min(available, value === 'peek' ? peekHeight() : value === 'half' ? Math.max(peekHeight(), available * 0.52) : available);
}

export function setSheetSnap(value: Snap): void {
  snap = value;
  document.body.dataset.sheetSnap = snap;
  document.getElementById('sheetHandle')!.setAttribute('aria-expanded', String(value !== 'peek'));
  document.getElementById('sheetPosition')!.textContent = value === 'peek' ? 'Controls' : value === 'half' ? 'Controls, half height' : 'Controls, full height';
  layoutSheet();
}

export function revealSceneForFit(fit: () => void): void {
  if (!mobile() || snap !== 'full') { fit(); return; }
  setSheetSnap('peek');
  requestAnimationFrame(() => { resizeCanvas(); fit(); });
}

function layoutSheet(height = dragHeight ?? snapHeight(snap)): void {
  if (document.body.dataset.mobileLayout !== String(viewportIsMobile())) return;
  syncMobilePanes();
  // Follow the visual viewport only at scale 1 (the iOS keyboard shrinks it). Under pinch-zoom it is
  // the zoomed region, and sizing the app to it would reflow the whole layout into that region.
  const viewport = window.visualViewport, unzoomed = !viewport || Math.abs(viewport.scale - 1) < 0.01;
  document.documentElement.style.setProperty('--app-height', `${unzoomed && viewport ? viewport.height : innerHeight}px`);
  document.documentElement.style.setProperty('--app-top', `${unzoomed && viewport ? viewport.offsetTop : 0}px`);
  document.documentElement.style.setProperty('--sheet-height', `${height}px`);
  requestAnimationFrame(resizeCanvas);
}

export function setupMobileLayout(): void {
  installed = true;
  const sidebar = document.getElementById('sidebar')!;
  const toolbar = document.getElementById('viewportToolbar')!;
  const exportBar = document.querySelector<HTMLElement>('.export-bar')!;
  const exportHome = exportBar.parentElement!;
  const overflow = document.getElementById('btnOverflow')!;
  const handle = document.getElementById('sheetHandle')!;
  const media = matchMedia('(max-width: 900px)');
  setSidebarPanePresentation(pane => {
    if (pane === 'sponsors') active = 'sponsors';
    else if (active === 'sponsors') active = previousControls;
    syncMobilePanes();
  });
  let overflowOpen = false;
  const closeOverflow = (): void => {
    overflowOpen = false;
    toolbar.classList.remove('overflow-open');
    overflow.setAttribute('aria-expanded', 'false');
    if (mobile() && toolbar.contains(document.activeElement)) overflow.focus({ preventScroll: true });
  };
  overflow.addEventListener('click', () => {
    overflowOpen = !overflowOpen;
    toolbar.classList.toggle('overflow-open', overflowOpen);
    overflow.setAttribute('aria-expanded', String(overflowOpen));
    if (overflowOpen) toolbar.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  });
  toolbar.addEventListener('click', event => { if ((event.target as HTMLElement).closest('button')) closeOverflow(); });
  document.addEventListener('pointerdown', event => {
    if (!toolbar.contains(event.target as Node) && !overflow.contains(event.target as Node)) closeOverflow();
  });
  document.addEventListener('focusin', event => {
    if (overflowOpen && !toolbar.contains(event.target as Node) && !overflow.contains(event.target as Node)) closeOverflow();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && overflowOpen) { closeOverflow(); overflow.focus(); } });
  document.querySelectorAll<HTMLButtonElement>('[role="tab"][data-pane]').forEach(tab => {
    tab.addEventListener('click', () => selectMobilePane(tab.dataset.pane as Pane));
    tab.addEventListener('keydown', event => {
      const index = panes.indexOf(tab.dataset.pane as Pane);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? panes.length - 1 : event.key === 'ArrowRight' ? (index + 1) % panes.length : event.key === 'ArrowLeft' ? (index + panes.length - 1) % panes.length : null;
      if (next === null) return;
      event.preventDefault();
      selectMobilePane(panes[next]);
      document.getElementById(`tab-${panes[next]}`)!.focus();
    });
  });
  document.querySelectorAll('.mode-tab').forEach(tab => tab.addEventListener('click', syncMobilePanes));
  let drag: { id: number; startY: number; startHeight: number; moved: boolean } | null = null;
  let suppressClick = false;
  handle.addEventListener('pointerdown', event => {
    if (!mobile() || !event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, startY: event.clientY, startHeight: snapHeight(snap), moved: false };
    handle.setPointerCapture(event.pointerId);
  });
  handle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const delta = drag.startY - event.clientY;
    drag.moved ||= Math.abs(delta) > 5;
    if (drag.moved) layoutSheet(dragHeight = Math.max(Math.min(peekHeight(), availableHeight()), Math.min(availableHeight(), drag.startHeight + delta)));
  });
  const endDrag = (event: PointerEvent): void => {
    if (!drag || event.pointerId !== drag.id) return;
    const cancelled = event.type === 'pointercancel';
    dragHeight = null;
    if (drag.moved && !cancelled) {
      const height = Math.max(0, drag.startHeight + drag.startY - event.clientY);
      setSheetSnap(snaps.reduce((best, candidate) => Math.abs(snapHeight(candidate) - height) < Math.abs(snapHeight(best) - height) ? candidate : best));
    } else layoutSheet();
    suppressClick = drag.moved && !cancelled;
    drag = null;
  };
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);
  handle.addEventListener('click', () => {
    if (!suppressClick) setSheetSnap(snaps[(snaps.indexOf(snap) + 1) % snaps.length]);
    suppressClick = false;
  });
  handle.addEventListener('keydown', event => {
    const index = snaps.indexOf(snap);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : event.key === 'ArrowUp' ? Math.min(2, index + 1) : event.key === 'ArrowDown' ? Math.max(0, index - 1) : null;
    if (next === null) return;
    event.preventDefault();
    setSheetSnap(snaps[next]);
  });
  const breakpoint = (): void => {
    const focus = captureSidebarView();
    const focused = document.activeElement;
    const preserveFocus = focus || focused instanceof HTMLElement && exportBar.contains(focused);
    if (media.matches) {
      if (!document.getElementById('sponsorsPane')!.hidden) active = 'sponsors';
      else if (focused instanceof HTMLElement) {
        const owner = focused.closest<HTMLElement>('[data-control-pane]')?.dataset.controlPane;
        if (owner) active = owner as Pane;
        else if (exportBar.contains(focused)) active = 'export';
        if (owner || exportBar.contains(focused)) {
          previousControls = active as Exclude<Pane, 'sponsors'>;
          setSheetSnap(active === 'export' ? 'full' : 'half');
        }
      }
    }
    document.body.dataset.mobileLayout = String(media.matches);
    if (media.matches) document.getElementById('mobileExportHost')!.append(exportBar);
    else exportHome.append(exportBar);
    closeOverflow();
    syncMobilePanes();
    layoutSheet();
    restoreSidebarView(false);
    if (preserveFocus && focused instanceof HTMLElement && focused.isConnected && focused.offsetParent !== null) focused.focus({ preventScroll: true });
  };
  media.addEventListener('change', breakpoint);
  window.addEventListener('resize', () => layoutSheet());
  window.visualViewport?.addEventListener('resize', () => layoutSheet());
  window.visualViewport?.addEventListener('scroll', () => layoutSheet());
  new ResizeObserver(() => resizeCanvas()).observe(document.getElementById('canvasWrap')!);
  new ResizeObserver(() => layoutSheet()).observe(sidebar);
  new ResizeObserver(() => layoutSheet()).observe(document.querySelector('.main')!);
  setSheetSnap('peek');
  breakpoint();
  captureInitialViewportFrame();
}
