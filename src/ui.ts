import { STATE } from './state';
import { CNC_PRESETS, PROFILES } from './noise/presets';
import { generateMesh, debouncedGenerate } from './mesh';


export function buildSidebar(): void {
  const sb = document.getElementById('sidebar')!;
  const parts: string[] = [];

  // -- PRESETS --
  parts.push(buildSection('Presets', `
    <div class="btn-row" id="presetRow">
      ${Object.keys(CNC_PRESETS).map(k =>
        `<button class="preset-pill${STATE.activePreset === k ? ' active' : ''}" data-preset="${k}">${k.replace(/-/g,' ')}</button>`
      ).join('')}
    </div>
    <div class="btn-row" style="margin-top:6px;">
      ${Object.keys(PROFILES).filter(k=>k!=='custom').map(k =>
        `<button class="preset-pill${STATE.activeProfile === k ? ' active' : ''}" data-profile="${k}" style="border-color:var(--bg4);font-size:9px;">${k}</button>`
      ).join('')}
    </div>
  `));

  // -- MESH DIMENSIONS --
  parts.push(buildSection('Mesh Dimensions', `
    <div class="inline-row">
      ${slider('meshX', 'X (inches)', 1, 96, 1, '', ' <span class="cnc-badge">ShopBot: 36" max</span>')}
      <button class="aspect-lock-btn${STATE.aspectLocked ? ' locked' : ''}" id="btnAspectLock" title="${STATE.aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}">
        ${STATE.aspectLocked ? '&#x1f512;' : '&#x1f513;'}
      </button>
      ${slider('meshY', 'Y (inches)', 1, 48, 1, '', ' <span class="cnc-badge">ShopBot: 24" max</span>')}
    </div>
    ${slider('resolution', 'Grid Resolution', 16, 256, 4)}
    ${slider('baseThickness', 'Base Thickness (in)', 0, 4, 0.05)}
    <div style="margin-top:4px;font-size:10px;color:var(--text3);">ShopBot Desktop Max ATC -- 36"x24"x6"</div>
  `));

  // -- NOISE PARAMETERS --
  parts.push(buildSection('Noise Parameters', `
    <div class="control-row">
      <div class="control-label">Noise Algorithm</div>
      <select class="select-input" id="selNoiseType">
        <option value="simplex">Simplex</option>
        <option value="perlin">Perlin</option>
        <option value="ridged">Ridged</option>
        <option value="fbm">FBM (Fractional Brownian)</option>
        <option value="voronoi">Voronoi</option>
      </select>
    </div>
    ${slider('frequency', 'Frequency (wave scale)', 0.01, 0.5, 0.005)}
    ${slider('amplitude', 'Amplitude / Z-height (inches)', 0, 6, 0.05, '', ' <span class="cnc-badge">max Z: 6"</span>')}
    ${slider('noiseExp', 'Noise Exponent (symmetric limiter)', 0.1, 3, 0.05)}
    ${slider('offset', 'Vertical Offset', -2, 2, 0.05)}
    <div class="seed-row">
      <input type="text" class="text-input" id="seedInput" placeholder="seed (blank=random)" value="${STATE.seed || ''}">
      <button class="btn btn-sm" id="btnRandSeed2">Dice</button>
    </div>
  `, false, 'noise-only'));

  // -- PEAK / VALLEY SHAPING --
  parts.push(buildSection('Peak / Valley Shaping', `
    <div style="font-size:10px;color:var(--text3);margin-bottom:8px;">Asymmetric control: shape peaks and valleys independently.</div>
    ${slider('peakExp', 'Peak Sharpness (>1 = crisper ridges)', 0.2, 4, 0.05)}
    ${slider('valleyExp', 'Valley Softness (<1 = broader valleys)', 0.1, 3, 0.05)}
    ${slider('valleyFloor', 'Valley Floor (0=deep, 1=flat)', 0, 1, 0.01)}
  `, false, 'noise-only'));

  // -- ADVANCED NOISE --
  parts.push(buildSection('Advanced Noise', `
    ${slider('octaves', 'Octaves', 1, 8, 1)}
    ${slider('persistence', 'Persistence', 0.1, 1, 0.05)}
    ${slider('lacunarity', 'Lacunarity', 1, 4, 0.1)}
    ${slider('distortion', 'Domain Warp / Distortion', 0, 2, 0.05)}
    ${slider('contrast', 'Contrast', 0.1, 3, 0.05)}
    ${slider('sharpness', 'Sharpness', 0, 2, 0.05)}
  `, true, 'noise-only'));

  // -- SMOOTHING --
  parts.push(buildSection('Smoothing', `
    ${slider('smoothIter', 'Iterations', 0, 15, 1)}
    ${slider('smoothStr', 'Strength', 0, 1, 0.05)}
  `));

  // -- DEPTH MAP --
  // Note: depthMapName is user-controlled (file upload name) — escaped to prevent XSS
  parts.push(buildSection('Depth Map', `
    <div class="upload-zone ${STATE.depthMap ? 'has-image' : ''}" id="uploadZone" tabindex="0" role="button" aria-label="Upload depth map image">
      <div class="upload-text">${(STATE.depthMapName || 'Click or drag to upload depth map').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
      <input type="file" id="depthMapInput" accept="image/*">
    </div>
    ${slider('blend', 'Blend (0=image, 1=noise)', 0, 1, 0.01)}
    ${slider('dmHeightScale', 'Depth Map Height Scale', 0, 6, 0.05)}
    ${slider('dmOffset', 'Depth Map Offset', -1, 1, 0.01)}
    ${slider('dmSmoothing', 'Depth Map Smoothing', 0, 15, 1)}
  `, false, 'depth-map-only'));

  // -- VIEW --
  parts.push(buildSection('View Controls', `
    ${slider('orbit', 'Orbit', 0, 360, 1)}
    ${slider('tilt', 'Tilt', -90, 90, 1)}
    ${slider('roll', 'Roll', -180, 180, 1)}
    ${slider('zoom', 'Zoom', 0.1, 10, 0.05)}
    <div style="margin-top:8px;font-size:10px;color:var(--text3);">Left drag = orbit/tilt &middot; Right/Shift drag = pan &middot; Scroll = zoom &middot; Double-click = fit</div>
  `, true));

  sb.innerHTML = parts.join('');

  wireControls();
}

function buildSection(title: string, body: string, collapsed = false, extraClass = ''): string {
  return `<div class="section ${collapsed ? 'collapsed' : ''} ${extraClass}">
    <div class="section-header">
      <div class="section-title">${title}</div>
      <div class="section-arrow">&#9660;</div>
    </div>
    <div class="section-body">${body}</div>
  </div>`;
}

function slider(key: string, label: string, min: number, max: number, step: number, _suffix = '', extra = ''): string {
  const val = STATE[key as keyof typeof STATE] as number;
  return `<div class="control-row">
    <div class="control-label"><span>${label}${extra}</span><span class="val" id="val_${key}">${typeof val === 'number' ? (Number.isInteger(step) ? val : val.toFixed(2)) : val}</span></div>
    <input type="range" id="sl_${key}" min="${min}" max="${max}" step="${step}" value="${val}" data-key="${key}">
  </div>`;
}

function wireControls(): void {
  // Sliders
  document.querySelectorAll<HTMLInputElement>('input[type="range"][data-key]').forEach(sl => {
    const key = sl.dataset.key!;
    sl.addEventListener('input', () => {
      const v = parseFloat(sl.value);
      (STATE as unknown as Record<string, unknown>)[key] = v;
      const valEl = document.getElementById('val_' + key);
      if (valEl) valEl.textContent = Number.isInteger(parseFloat(sl.step)) ? String(v) : v.toFixed(2);

      // Aspect ratio lock
      if (STATE.aspectLocked && STATE.depthMapAR) {
        if (key === 'meshX') {
          STATE.meshY = Math.max(1, Math.min(48, Math.round(v / STATE.depthMapAR)));
          const ySlider = document.querySelector<HTMLInputElement>('input[data-key="meshY"]');
          const yVal = document.getElementById('val_meshY');
          if (ySlider) ySlider.value = String(STATE.meshY);
          if (yVal) yVal.textContent = String(STATE.meshY);
        } else if (key === 'meshY') {
          STATE.meshX = Math.max(1, Math.min(96, Math.round(v * STATE.depthMapAR)));
          const xSlider = document.querySelector<HTMLInputElement>('input[data-key="meshX"]');
          const xVal = document.getElementById('val_meshX');
          if (xSlider) xSlider.value = String(STATE.meshX);
          if (xVal) xVal.textContent = String(STATE.meshX);
        }
      }

      // Clear active preset/profile on manual change
      if (STATE.activePreset) {
        STATE.activePreset = null;
        const pill = document.querySelector('.preset-pill.active[data-preset]');
        if (pill) pill.classList.remove('active');
      }
      if (STATE.activeProfile) {
        STATE.activeProfile = null;
        const pill = document.querySelector('.preset-pill.active[data-profile]');
        if (pill) pill.classList.remove('active');
      }

      debouncedGenerate(key);
    });
  });

  // Section collapse
  const isMobile = () => window.matchMedia('(max-width: 900px)').matches;
  const sections = document.querySelectorAll('.section');
  document.querySelectorAll('.section-header').forEach(h => {
    h.addEventListener('click', () => {
      const section = h.parentElement!;
      if (isMobile()) {
        const wasCollapsed = section.classList.contains('collapsed');
        sections.forEach(s => s.classList.add('collapsed'));
        if (wasCollapsed) section.classList.remove('collapsed');
      } else {
        section.classList.toggle('collapsed');
      }
    });
  });
  if (isMobile()) {
    const visible = [...sections].filter(s => (s as HTMLElement).offsetParent !== null);
    visible.forEach((s, i) => { if (i > 0) s.classList.add('collapsed'); });
  }

  // Noise type select
  const sel = document.getElementById('selNoiseType') as HTMLSelectElement | null;
  if (sel) {
    sel.value = STATE.noiseType;
    sel.addEventListener('change', () => {
      STATE.noiseType = sel.value as typeof STATE.noiseType;
      if (STATE.activePreset) {
        STATE.activePreset = null;
        const pill = document.querySelector('.preset-pill.active[data-preset]');
        if (pill) pill.classList.remove('active');
      }
      generateMesh();
    });
  }

  // Seed input
  const seedEl = document.getElementById('seedInput') as HTMLInputElement | null;
  if (seedEl) {
    seedEl.addEventListener('change', () => {
      STATE.seed = seedEl.value ? parseInt(seedEl.value) || hashString(seedEl.value) : 0;
      generateMesh();
    });
  }

  // Random seed button (sidebar-only — toolbar's #btnRandomSeed is bound once in setupToolbar)
  document.getElementById('btnRandSeed2')?.addEventListener('click', randomSeed);

  // Aspect lock toggle
  const lockBtn = document.getElementById('btnAspectLock');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      STATE.aspectLocked = !STATE.aspectLocked;
      lockBtn.classList.toggle('locked', STATE.aspectLocked);
      lockBtn.textContent = STATE.aspectLocked ? '\u{1F512}' : '\u{1F513}';
      lockBtn.title = STATE.aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio';
    });
  }

  // Presets
  document.querySelectorAll('[data-preset]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = CNC_PRESETS[(btn as HTMLElement).dataset.preset!];
      if (!p) return;
      Object.keys(p).forEach(k => { (STATE as unknown as Record<string, unknown>)[k] = p[k]; });
      STATE.activePreset = (btn as HTMLElement).dataset.preset!;
      STATE.activeProfile = null;
      buildSidebar();
      generateMesh();
    });
  });

  // Texture profiles
  document.querySelectorAll('[data-profile]').forEach(btn => {
    btn.addEventListener('click', () => {
      const p = PROFILES[(btn as HTMLElement).dataset.profile!];
      if (!p) return;
      Object.keys(p).forEach(k => { (STATE as unknown as Record<string, unknown>)[k] = p[k]; });
      STATE.activeProfile = (btn as HTMLElement).dataset.profile!;
      STATE.activePreset = null;
      buildSidebar();
      generateMesh();
    });
  });

  // Depth map upload
  const uploadZone = document.getElementById('uploadZone');
  const dmInput = document.getElementById('depthMapInput') as HTMLInputElement | null;
  if (uploadZone && dmInput) {
    uploadZone.addEventListener('click', () => dmInput.click());
    uploadZone.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); dmInput.click(); } });
    uploadZone.addEventListener('dragover', e => { e.preventDefault(); (uploadZone as HTMLElement).style.borderColor = 'var(--accent)'; });
    uploadZone.addEventListener('dragleave', () => { (uploadZone as HTMLElement).style.borderColor = ''; });
    uploadZone.addEventListener('drop', e => {
      e.preventDefault();
      (uploadZone as HTMLElement).style.borderColor = '';
      if ((e as DragEvent).dataTransfer?.files[0]) loadDepthMap((e as DragEvent).dataTransfer!.files[0]);
    });
    dmInput.addEventListener('change', () => { if (dmInput.files?.[0]) loadDepthMap(dmInput.files[0]); });
  }

  updateSectionVisibility();
}

export function updateSectionVisibility(): void {
  const mode = STATE.mode;
  document.querySelectorAll<HTMLElement>('.noise-only').forEach(el => {
    el.style.display = (mode === 'noise' || mode === 'blend') ? '' : 'none';
  });
  document.querySelectorAll<HTMLElement>('.depth-map-only').forEach(el => {
    el.style.display = (mode === 'depthmap' || mode === 'blend') ? '' : 'none';
  });
}

export function fitMeshToAspect(imgW: number, imgH: number): void {
  const ar = imgW / imgH;
  if (ar >= 36 / 24) {
    STATE.meshX = 36;
    STATE.meshY = Math.max(1, Math.round(36 / ar));
  } else {
    STATE.meshY = 24;
    STATE.meshX = Math.max(1, Math.round(24 * ar));
  }
  STATE.resolution = 256;
  STATE.depthMapAR = ar;
  STATE.aspectLocked = true;
}

export function loadDepthMap(file: File): void {
  const img = new Image();
  const objUrl = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(objUrl);
    STATE.depthMap = img;
    STATE.depthMapName = file.name;
    fitMeshToAspect(img.width, img.height);
    const zone = document.getElementById('uploadZone');
    if (zone) {
      zone.classList.add('has-image');
      zone.querySelector('.upload-text')!.textContent = file.name;
    }
    buildSidebar();
    generateMesh();
  };
  img.onerror = () => {
    URL.revokeObjectURL(objUrl);
  };
  img.src = objUrl;
}

export function randomSeed(): void {
  STATE.seed = Math.floor(Math.random() * 99999);
  const el = document.getElementById('seedInput') as HTMLInputElement | null;
  if (el) el.value = String(STATE.seed);
  generateMesh();
}

function hashString(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; }
  return Math.abs(h);
}
