import { STATE, deserializeConfig, rememberLinkBoard, setDemoDepthMap } from './state';
import { buildSidebar, showDemoDepthMap } from './ui';
import { setupTabs, setupToolbar, setupResize, updateExportControls } from './toolbar';
import { setupInteraction } from './interaction';
import { setupSponsorModal } from './sponsor';
import { generateMesh } from './mesh';
import { setCameraFromState } from './render';
import { ensureDrapeFigure } from './drape-ui';

/** A deploy replaces the hashed chunks, so a tab opened before it cannot import one it has not loaded
 *  yet (the STL loader, the depth model): Cloudflare answers the old name with the HTML page. Reload once
 *  to pick up the new build; a second failure within a minute is shown instead, so this cannot loop. */
const CHUNK_RELOAD_KEY = 'meshcraft:chunk-reload';
window.addEventListener('vite:preloadError', (e) => {
  const now = Date.now();
  let last: number;
  try {
    last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    return;                                                     // no storage for the loop guard: show the error
  }
  if (now - last < 60_000) return;
  e.preventDefault();
  location.reload();
});

function preloadDemoDepthMap(): void {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    setDemoDepthMap(img);
    if (STATE.mode === 'depthmap' && !STATE.depthMap && !STATE.reliefMaster) {
      showDemoDepthMap(img);
      buildSidebar();
      generateMesh();
    }
  };
  img.onerror = () => {
    setDemoDepthMap(null);
  };
  img.src = 'https://imagedelivery.net/7Un9nY7FmOV52M6-Dm1bzA/bf407583-583b-4034-d0cc-ab8ae75a4b00/w=800';
}

function init(): void {
  // Apply URL state if present
  // Pass the full Location so deserializeConfig can recover payloads from the search
  // string, the hash, OR a malformed path (`meshcraft.sawyerdesign.io/=eyJ...`) that some
  // copy-paste flows produce on iOS.
  const urlConfig = deserializeConfig(window.location);

  for (const [key, value] of Object.entries(urlConfig)) {
    (STATE as unknown as Record<string, unknown>)[key] = value;
  }

  rememberLinkBoard(urlConfig);
  // Sync body class with potentially URL-overridden mode
  document.body.className = 'mode-' + STATE.mode;

  // Sync button active states with URL-deserialized STATE
  document.querySelectorAll('.view-btn').forEach(btn =>
    btn.classList.toggle('active', (btn as HTMLElement).dataset.view === STATE.viewMode));
  document.querySelectorAll('.mode-tab').forEach(btn =>
    btn.classList.toggle('active', (btn as HTMLElement).dataset.mode === STATE.mode));
  document.querySelectorAll('.format-btn').forEach(btn =>
    btn.classList.toggle('active', (btn as HTMLElement).dataset.fmt === STATE.exportFormat));

  buildSidebar();
  setupTabs();
  setupToolbar();
  updateExportControls();
  setupInteraction();
  setupResize();
  setupSponsorModal();
  generateMesh();
  preloadDemoDepthMap();
  // A page opened on DRAPE: load the figure and point the camera straight at the carve.
  if (STATE.mode === 'drape') { void ensureDrapeFigure(); buildSidebar(); setCameraFromState(); }
}

document.addEventListener('DOMContentLoaded', init);
