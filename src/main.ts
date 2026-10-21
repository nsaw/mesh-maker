import { STATE, deserializeConfig, setDemoDepthMap } from './state';
import { buildSidebar, fitMeshToAspect } from './ui';
import { setupTabs, setupToolbar, setupResize, updateExportControls } from './toolbar';
import { setupInteraction } from './interaction';
import { setupSponsorModal } from './sponsor';
import { generateMesh } from './mesh';
import { setCameraFromState } from './render';
import { ensureDrapeFigure } from './drape-ui';

/** The board size a DEPTH MAP share link set, or null. The demo image keeps it (instead of refitting
 *  the board to its own aspect) as long as the board still is that size when the image arrives,
 *  whatever tabs were visited meanwhile; a board the user or another tab changed is fitted. */
let linkSize: { meshX: number; meshY: number } | null = null;

function preloadDemoDepthMap(): void {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    setDemoDepthMap(img);
    if (STATE.mode === 'depthmap' && !STATE.depthMap && !STATE.reliefMaster) {
      STATE.depthMap = img;
      STATE.depthMapName = 'Mona Lisa (demo)';
      // A DEPTH MAP link carries its own size; only a page without one is sized to the demo image.
      if (linkSize && STATE.meshX === linkSize.meshX && STATE.meshY === linkSize.meshY) STATE.depthMapAR = img.width / img.height;
      else fitMeshToAspect(img.width, img.height);
      const zone = document.getElementById('uploadZone');
      if (zone) {
        zone.classList.add('has-image');
        zone.querySelector('.upload-text')!.textContent = STATE.depthMapName;
      }
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

  if (urlConfig.mode === 'depthmap' && ('meshX' in urlConfig || 'meshY' in urlConfig)) linkSize = { meshX: STATE.meshX, meshY: STATE.meshY };

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
