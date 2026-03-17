import { STATE, deserializeConfig, setDemoDepthMap } from './state';
import { buildSidebar, fitMeshToAspect } from './ui';
import { setupTabs, setupToolbar, setupResize } from './toolbar';
import { setupInteraction } from './interaction';
import { setupSponsorModal } from './sponsor';
import { generateMesh } from './mesh';

function preloadDemoDepthMap(): void {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    setDemoDepthMap(img);
    if ((STATE.mode === 'depthmap' || STATE.mode === 'blend') && !STATE.depthMap) {
      STATE.depthMap = img;
      STATE.depthMapName = 'Mona Lisa (demo)';
      fitMeshToAspect(img.width, img.height);
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
  const urlConfig = deserializeConfig(new URLSearchParams(window.location.search));
  for (const [key, value] of Object.entries(urlConfig)) {
    (STATE as unknown as Record<string, unknown>)[key] = value;
  }

  // Sync body class with potentially URL-overridden mode
  document.body.className = 'mode-' + STATE.mode;

  buildSidebar();
  setupTabs();
  setupToolbar();
  setupInteraction();
  setupResize();
  setupSponsorModal();
  generateMesh();
  preloadDemoDepthMap();
}

document.addEventListener('DOMContentLoaded', init);
