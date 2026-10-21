import { STATE, deserializeConfig, rememberLinkBoard, setDemoDepthMap } from './state';
import { buildSidebar, showDemoDepthMap } from './ui';
import { setupTabs, setupToolbar, setupResize, updateExportControls } from './toolbar';
import { setupInteraction } from './interaction';
import { setupSponsorModal } from './sponsor';
import { generateMesh } from './mesh';
import { setCameraFromState } from './render';
import { ensureDrapeFigure } from './drape-ui';

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
