import { STATE, noiseDims, demoDepthMap, serializeConfig } from './state';
import { generateMesh } from './mesh';
import { renderViewport, setCameraFromState, resizeCanvas } from './render';
import { doExport } from './export';
import { buildSidebar, updateSectionVisibility, fitMeshToAspect, randomSeed } from './ui';
import { updateStats, zoomExtents } from './stats';
import { showToast } from './toast';

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
        noiseDims.meshX = STATE.meshX;
        noiseDims.meshY = STATE.meshY;
        noiseDims.resolution = STATE.resolution;
      }

      // Restore noise dimensions when switching back
      if (STATE.mode === 'noise' && prevMode !== 'noise') {
        STATE.meshX = noiseDims.meshX;
        STATE.meshY = noiseDims.meshY;
        STATE.resolution = noiseDims.resolution;
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

      // Re-fit mesh to depth map aspect only when entering from noise mode
      if (prevMode === 'noise' && (STATE.mode === 'depthmap' || STATE.mode === 'blend') && STATE.depthMap && !STATE.aspectLocked) {
        fitMeshToAspect(STATE.depthMap.width, STATE.depthMap.height);
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
      updateExportControls();
      updateStats();
    });
  });
}

/** Show/hide export-bar controls and sidebar SBP section based on current format */
export function updateExportControls(): void {
  const isSBP = STATE.exportFormat === 'sbp';

  // Toggle mesh-export controls (irrelevant for SBP)
  const meshControls = ['chkWatertight', 'chkBinary', 'chk3dmPointCloud'];
  for (const id of meshControls) {
    const el = document.getElementById(id)?.closest('.check-row') as HTMLElement | null;
    if (el) el.style.display = isSBP ? 'none' : '';
  }

  // Toggle SBP sidebar section (override CSS .sbp-only { display: none })
  document.querySelectorAll<HTMLElement>('.sbp-only').forEach(el => {
    el.style.display = isSBP ? 'block' : 'none';
  });
}

export function setupToolbar(): void {
  document.getElementById('btnRegenerate')!.addEventListener('click', generateMesh);
  document.getElementById('btnRandomSeed')!.addEventListener('click', randomSeed);
  document.getElementById('btnZoomExtents')!.addEventListener('click', zoomExtents);
  document.getElementById('btnResetCamera')!.addEventListener('click', () => {
    STATE.orbit = 55; STATE.tilt = -25; STATE.roll = 0; STATE.zoom = 1; STATE.panX = 0; STATE.panY = 0;
    buildSidebar();
    setCameraFromState();
  });
  document.getElementById('btnExport')!.addEventListener('click', doExport);
  document.getElementById('filenameInput')!.addEventListener('change', e => {
    // Strip filesystem-unsafe characters (including control chars U+0000-U+001F)
    // eslint-disable-next-line no-control-regex
    const raw = (e.target as HTMLInputElement).value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim();
    STATE.filename = raw.slice(0, 128) || 'meshcraft_export';
    (e.target as HTMLInputElement).value = STATE.filename;
  });
  document.getElementById('chkWatertight')!.addEventListener('change', e => { STATE.watertight = (e.target as HTMLInputElement).checked; renderViewport(); updateStats(); });
  document.getElementById('chkBinary')!.addEventListener('change', e => { STATE.binary = (e.target as HTMLInputElement).checked; updateStats(); });
  document.getElementById('chk3dmPointCloud')!.addEventListener('change', e => { STATE.export3dmAsPointCloud = (e.target as HTMLInputElement).checked; });

  // Copy Link button — URL state sharing
  const copyLinkBtn = document.getElementById('btnCopyLink');
  if (copyLinkBtn) {
    copyLinkBtn.addEventListener('click', () => {
      const config = serializeConfig();
      const url = config
        ? `${window.location.origin}${window.location.pathname}?c=${config}`
        : `${window.location.origin}${window.location.pathname}`;
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(url).then(() => {
          showToast('Link copied!');
        }).catch(() => {
          copyFallback(url);
        });
      } else {
        copyFallback(url);
      }
    });
  }
}

// Fallback for insecure contexts (HTTP) where navigator.clipboard is unavailable.
// execCommand('copy') is deprecated but still the only option without HTTPS.
function copyFallback(text: string): void {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    // execCommand can throw SecurityError in sandboxed iframes
  } finally {
    document.body.removeChild(ta);
  }
  showToast(ok ? 'Link copied!' : 'Copy failed — use Ctrl+C');
}


export function setupResize(): void {
  window.addEventListener('resize', () => { resizeCanvas(); });
}
