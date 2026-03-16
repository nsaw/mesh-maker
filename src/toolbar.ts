import { STATE, _noiseDims, demoDepthMap, serializeConfig } from './state';
import { generateMesh } from './mesh';
import { renderViewport, resetCanvasSize } from './render';
import { doExport } from './export';
import { buildSidebar, updateSectionVisibility, fitMeshToAspect, randomSeed } from './ui';
import { updateStats, zoomExtents } from './stats';

export function setupTabs(): void {
  // Mode tabs
  document.querySelectorAll('.mode-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const prevMode = STATE.mode;
      document.querySelectorAll('.mode-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.mode = (btn as HTMLElement).dataset.mode as typeof STATE.mode;
      document.body.className = 'mode-' + STATE.mode;
      updateSectionVisibility();

      // Save noise dimensions before depth map overwrites them
      if (prevMode === 'noise' && (STATE.mode === 'depthmap' || STATE.mode === 'blend')) {
        _noiseDims.meshX = STATE.meshX;
        _noiseDims.meshY = STATE.meshY;
        _noiseDims.resolution = STATE.resolution;
      }

      // Restore noise dimensions when switching back
      if (STATE.mode === 'noise' && prevMode !== 'noise') {
        STATE.meshX = _noiseDims.meshX;
        STATE.meshY = _noiseDims.meshY;
        STATE.resolution = _noiseDims.resolution;
        STATE.aspectLocked = false;
        buildSidebar();
      }

      // Auto-apply demo depth map if switching to depthmap/blend with no user image
      if ((STATE.mode === 'depthmap' || STATE.mode === 'blend') && !STATE.depthMap && demoDepthMap) {
        STATE.depthMap = demoDepthMap;
        STATE.depthMapName = 'Mona Lisa (demo)';
        fitMeshToAspect(demoDepthMap.width, demoDepthMap.height);
        const zone = document.getElementById('uploadZone');
        if (zone) {
          zone.classList.add('has-image');
          zone.querySelector('.upload-text')!.textContent = STATE.depthMapName;
        }
        buildSidebar();
      }
      generateMesh();
    });
  });

  // View mode buttons
  document.querySelectorAll('.view-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.view-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.viewMode = (btn as HTMLElement).dataset.view as typeof STATE.viewMode;
      renderViewport();
    });
  });

  // Export format
  document.querySelectorAll('.format-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.format-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.exportFormat = (btn as HTMLElement).dataset.fmt as typeof STATE.exportFormat;
    });
  });
}

export function setupToolbar(): void {
  document.getElementById('btnRegenerate')!.addEventListener('click', generateMesh);
  document.getElementById('btnRandomSeed')!.addEventListener('click', randomSeed);
  document.getElementById('btnZoomExtents')!.addEventListener('click', zoomExtents);
  document.getElementById('btnResetCamera')!.addEventListener('click', () => {
    STATE.orbit = 55; STATE.tilt = -25; STATE.roll = 0; STATE.zoom = 1; STATE.panX = 0; STATE.panY = 0;
    buildSidebar();
    renderViewport();
  });
  document.getElementById('btnExport')!.addEventListener('click', doExport);
  document.getElementById('filenameInput')!.addEventListener('change', e => { STATE.filename = (e.target as HTMLInputElement).value || 'meshcraft_export'; });
  document.getElementById('chkWatertight')!.addEventListener('change', e => { STATE.watertight = (e.target as HTMLInputElement).checked; updateStats(); });
  document.getElementById('chkBinary')!.addEventListener('change', e => { STATE.binary = (e.target as HTMLInputElement).checked; updateStats(); });

  // Copy Link button — URL state sharing
  const copyLinkBtn = document.getElementById('btnCopyLink');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      const config = serializeConfig();
      const url = config
        ? `${window.location.origin}${window.location.pathname}?c=${config}`
        : `${window.location.origin}${window.location.pathname}`;
      navigator.clipboard.writeText(url).then(() => {
        showToast('Link copied!');
      }).catch(() => {
        // Fallback for insecure contexts
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast('Link copied!');
      });
    });
  }
}

function showToast(message: string): void {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.display = 'block';
  toast.classList.add('visible');
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 1500);
}

export function setupResize(): void {
  window.addEventListener('resize', () => { resetCanvasSize(); renderViewport(); });
}
