import { STATE, DEFAULTS } from './state';
import { attachValueEdit } from './slider-utils';
import { CNC_PRESETS, PROFILES } from './noise/presets';
import { generateMesh, debouncedGenerate } from './mesh';
import { buildSBPSection, wireSBPControls, syncSbpSafeZ } from './sbp-export';
import { updateExportControls } from './toolbar';


const PRESET_GROUPS: [string, string[]][] = [
  ['Gentle', ['gentle-waves', 'subtle-texture', 'billowy-clouds']],
  ['Organic', ['organic-terrain', 'sculptural', 'organic-swirl']],
  ['Aggressive', ['deep-carve', 'hard-wave', 'turbulent-marble']],
  ['Ridge & Stone', ['sharp-ridges', 'eroded-stone', 'natural-ridge']],
  ['Cell & Directional', ['voronoi-cells', 'worley-cracks', 'brushed-metal']],
  ['Relief', ['relief-vertical', 'relief-radial', 'relief-pockets', 'relief-starburst']],
];

function formatPresetName(key: string): string {
  return key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function buildSidebar(): void {
  const sb = document.getElementById('sidebar')!;
  const fragment = document.createDocumentFragment();
  const isRelief = STATE.noiseType === 'voronoi-relief';
  const sections: Node[] = [
    buildPresetSection(),
    buildMeshDimensionsSection(),
    buildNoiseParametersSection(),
  ];
  if (isRelief) {
    sections.push(buildReliefSection());
  } else {
    sections.push(buildPeakValleySection(), buildAdvancedNoiseSection());
  }
  sections.push(
    buildSmoothingSection(),
    buildDepthMapSection(),
    buildViewControlsSection(),
    buildSBPSection(),
  );
  fragment.append(...sections);
  sb.replaceChildren(fragment);

  wireControls();
  // Sync cut-depth slider maxes and SBP safe Z to initial material thickness
  const ampInit = document.querySelector<HTMLInputElement>('input[data-key="amplitude"]');
  if (ampInit) ampInit.max = String(STATE.baseThickness);
  const dmInit = document.querySelector<HTMLInputElement>('input[data-key="dmHeightScale"]');
  if (dmInit) dmInit.max = String(STATE.baseThickness);
  syncSbpSafeZ();
  wireSBPControls();
  updateExportControls();
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function slugifySectionTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function buildSection(title: string, bodyChildren: Node[], collapsed = false, extraClass = ''): HTMLElement {
  const section = createElement('div', `section${collapsed ? ' collapsed' : ''}${extraClass ? ` ${extraClass}` : ''}`);
  const bodyId = `${slugifySectionTitle(title)}-section-body`;
  const header = createElement('button', 'section-header') as HTMLButtonElement;
  header.type = 'button';
  header.setAttribute('aria-expanded', String(!collapsed));
  header.setAttribute('aria-controls', bodyId);
  header.append(
    createElement('div', 'section-title', title),
    createElement('div', 'section-arrow', '\u25BE'),
  );
  const body = createElement('div', 'section-body');
  body.id = bodyId;
  body.append(...bodyChildren);
  section.append(header, body);
  return section;
}

function buildSliderLabel(label: string, valueId: string, valueText: string, badgeText = ''): HTMLDivElement {
  const controlLabel = createElement('div', 'control-label');
  const labelSpan = createElement('span');
  labelSpan.append(label);
  if (badgeText) {
    labelSpan.append(' ');
    labelSpan.append(createElement('span', 'cnc-badge', badgeText));
  }
  const valueSpan = createElement('span', 'val', valueText);
  valueSpan.id = valueId;
  controlLabel.append(labelSpan, valueSpan);
  return controlLabel;
}

function slider(key: string, label: string, min: number, max: number, step: number, badgeText = ''): HTMLDivElement {
  const val = STATE[key as keyof typeof STATE] as number;
  const row = createElement('div', 'control-row');
  const valueText = typeof val === 'number'
    ? (Number.isInteger(step) ? String(val) : val.toFixed(2))
    : String(val);
  const input = createElement('input') as HTMLInputElement;
  input.type = 'range';
  input.id = `sl_${key}`;
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(val);
  input.dataset.key = key;
  input.dataset.default = String(DEFAULTS[key as keyof typeof DEFAULTS] ?? val);
  row.append(buildSliderLabel(label, `val_${key}`, valueText, badgeText), input);
  return row;
}

/** Enum/string select control bound to a STATE key, wired in wireControls(). */
function enumSelect(key: string, label: string, options: Array<[string, string]>): HTMLDivElement {
  const row = createElement('div', 'control-row');
  const lab = createElement('div', 'control-label', label);
  const sel = createElement('select', 'select-input') as HTMLSelectElement;
  sel.id = `sl_${key}`;
  sel.dataset.key = key;
  const current = String(STATE[key as keyof typeof STATE]);
  sel.dataset.default = String(DEFAULTS[key as keyof typeof DEFAULTS] ?? current);
  for (const [value, text] of options) {
    const opt = createElement('option') as HTMLOptionElement;
    opt.value = value;
    opt.textContent = text;
    opt.selected = value === current;
    sel.append(opt);
  }
  row.append(lab, sel);
  return row;
}

function buildPresetSection(): HTMLElement {
  const controlRow = createElement('div', 'control-row');
  const label = createElement('div', 'control-label', 'CNC Preset');
  const select = createElement('select', 'select-input') as HTMLSelectElement;
  select.id = 'selPreset';

  const defaultOption = createElement('option') as HTMLOptionElement;
  defaultOption.value = '';
  defaultOption.selected = !STATE.activePreset;
  defaultOption.textContent = 'Select Preset';
  select.append(defaultOption);

  PRESET_GROUPS.forEach(([groupLabel, keys]) => {
    const optgroup = createElement('optgroup') as HTMLOptGroupElement;
    optgroup.label = groupLabel;
    keys.forEach((key) => {
      const option = createElement('option') as HTMLOptionElement;
      option.value = key;
      option.selected = STATE.activePreset === key;
      option.textContent = formatPresetName(key);
      optgroup.append(option);
    });
    select.append(optgroup);
  });
  controlRow.append(label, select);

  const buttonRow = createElement('div', 'btn-row');
  buttonRow.style.marginTop = '6px';
  Object.keys(PROFILES)
    .filter((key) => key !== 'custom')
    .forEach((key) => {
      const button = createElement('button', `preset-pill${STATE.activeProfile === key ? ' active' : ''}`, key);
      button.dataset.profile = key;
      button.style.borderColor = 'var(--bg4)';
      button.style.fontSize = '9px';
      buttonRow.append(button);
    });

  return buildSection('Presets', [controlRow, buttonRow], false, 'noise-only');
}

function buildMeshDimensionsSection(): HTMLElement {
  const inlineRow = createElement('div', 'inline-row');
  inlineRow.append(
    slider('meshX', 'X (inches)', 1, 96, 1, 'ShopBot: 36" max'),
  );

  const lockButton = createElement('button', `aspect-lock-btn${STATE.aspectLocked ? ' locked' : ''}`);
  lockButton.id = 'btnAspectLock';
  lockButton.title = STATE.aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio';
  lockButton.textContent = STATE.aspectLocked ? '\u{1F512}' : '\u{1F513}';
  inlineRow.append(lockButton);

  inlineRow.append(
    slider('meshY', 'Y (inches)', 1, 48, 1, 'ShopBot: 24" max'),
  );

  const note = createElement('div');
  note.style.marginTop = '4px';
  note.style.fontSize = '10px';
  note.style.color = 'var(--text3)';
  note.textContent = 'ShopBot Desktop Max ATC -- 36"x24"x6"';

  return buildSection('Mesh Dimensions', [
    inlineRow,
    slider('resolution', 'Grid Resolution', 16, 1024, 4),
    slider('baseThickness', 'Material Thickness (in)', 0.25, 6, 0.05),
    note,
  ]);
}

function buildNoiseParametersSection(): HTMLElement {
  const noiseRow = createElement('div', 'control-row');
  const noiseLabel = createElement('div', 'control-label', 'Noise Algorithm');
  const noiseSelect = createElement('select', 'select-input') as HTMLSelectElement;
  noiseSelect.id = 'selNoiseType';

  const noiseOptions: Array<{ label: string; options: Array<[string, string]> }> = [
    {
      label: 'Classic',
      options: [['simplex', 'Simplex'], ['perlin', 'Perlin'], ['opensimplex2', 'OpenSimplex2'], ['value', 'Value']],
    },
    {
      label: 'Fractal',
      options: [['fbm', 'FBM (Fractional Brownian)'], ['ridged', 'Ridged'], ['billow', 'Billow'], ['turbulence', 'Turbulence']],
    },
    {
      label: 'Multi-Fractal',
      options: [['hybrid', 'Hybrid Multifractal'], ['hetero', 'Heterogeneous Terrain'], ['domainwarp', 'Domain Warp']],
    },
    {
      label: 'Cellular',
      options: [['voronoi', 'Voronoi'], ['worley', 'Worley (Cell Edges)']],
    },
    {
      label: 'Relief',
      options: [['voronoi-relief', 'Voronoi Relief']],
    },
    {
      label: 'Advanced',
      options: [['gabor', 'Gabor'], ['wavelet', 'Wavelet']],
    },
  ];

  noiseOptions.forEach(({ label, options }) => {
    const optgroup = createElement('optgroup') as HTMLOptGroupElement;
    optgroup.label = label;
    options.forEach(([value, text]) => {
      const option = createElement('option') as HTMLOptionElement;
      option.value = value;
      option.selected = STATE.noiseType === value;
      option.textContent = text;
      optgroup.append(option);
    });
    noiseSelect.append(optgroup);
  });
  noiseRow.append(noiseLabel, noiseSelect);

  const seedRow = createElement('div', 'seed-row');
  const seedInput = createElement('input', 'text-input') as HTMLInputElement;
  seedInput.type = 'text';
  seedInput.id = 'seedInput';
  seedInput.placeholder = 'seed (blank=random)';
  seedInput.value = STATE.seed ? String(STATE.seed) : '';
  const seedButton = createElement('button', 'btn btn-sm', 'Dice');
  seedButton.id = 'btnRandSeed2';
  seedRow.append(seedInput, seedButton);

  const children: Node[] = [
    noiseRow,
  ];

  if (STATE.noiseType === 'gabor') {
    children.push(
      slider('gaborAngle', 'Gabor Angle (degrees)', 0, 180, 1),
      slider('gaborBandwidth', 'Gabor Bandwidth', 0.5, 4, 0.1),
    );
  }

  if (STATE.noiseType === 'voronoi-relief') {
    children.push(
      slider('amplitude', 'Cut Depth (inches)', 0, 6, 0.05),
      slider('offset', 'Vertical Offset', -2, 2, 0.05),
      // distortion + warpFreq drive the relief sampler's site-position warp; keeping these
      // visible in relief mode is what the user means by "we lost the warp functions".
      slider('distortion', 'Domain Warp / Distortion', 0, 2, 0.05),
      slider('warpFreq', 'Warp Frequency', 0.02, 0.4, 0.01),
      seedRow,
    );
    return buildSection('Noise Parameters', children, false, 'noise-only');
  }

  children.push(
    slider('frequency', 'Frequency (wave scale)', 0.01, 0.5, 0.005),
    slider('amplitude', 'Cut Depth (inches)', 0, 6, 0.05),
    slider('noiseExp', 'Noise Exponent (symmetric limiter)', 0.1, 3, 0.05),
    slider('offset', 'Vertical Offset', -2, 2, 0.05),
    seedRow,
  );

  return buildSection('Noise Parameters', children, false, 'noise-only');
}

function buildReliefSection(): HTMLElement {
  const cellLayoutLabel = createElement('div');
  cellLayoutLabel.style.fontSize = '10px';
  cellLayoutLabel.style.color = 'var(--text3)';
  cellLayoutLabel.style.marginBottom = '4px';
  cellLayoutLabel.textContent = 'Cell layout';

  const shapeLabel = cellLayoutLabel.cloneNode() as HTMLDivElement;
  shapeLabel.textContent = 'Cell shape';
  const anisoLabel = cellLayoutLabel.cloneNode() as HTMLDivElement;
  anisoLabel.textContent = 'Anisotropy';
  const attractorLabel = cellLayoutLabel.cloneNode() as HTMLDivElement;
  attractorLabel.textContent = 'Attractor';
  const radialLabel = cellLayoutLabel.cloneNode() as HTMLDivElement;
  radialLabel.textContent = 'Radial foci (starburst)';
  const baseLabel = cellLayoutLabel.cloneNode() as HTMLDivElement;
  baseLabel.textContent = 'Base field';

  return buildSection('Cell Relief', [
    cellLayoutLabel,
    slider('reliefCellSize', 'Cell Size (inches)', 0.4, 6, 0.1),
    slider('reliefJitter', 'Jitter', 0, 1, 0.05),
    slider('reliefRelaxIterations', 'Lloyd Relaxation', 0, 2, 1),
    shapeLabel,
    enumSelect('reliefProfile', 'Profile', [['hemisphere', 'Hemisphere'], ['cosine', 'Cosine'], ['parabolic', 'Parabolic']]),
    enumSelect('reliefPolarity', 'Polarity', [['domes', 'Domes (raised)'], ['pockets', 'Pockets (sunken)']]),
    slider('reliefSeamDepth', 'Seam Depth', 0, 1, 0.05),
    // NB: `reliefSeamWidth` does NOT affect the visual mesh under the F2-F1 relief algorithm
    // (see `voronoi-relief.ts`'s "seamWidth is no longer used" comment). It only drives the
    // SBP V-carve toolpath width via `sbp-export.ts:189` (`seamWidthIn = reliefSeamWidth ·
    // reliefCellSize · 0.5`). Label clarifies the slider's actual function so users don't tune
    // it expecting a mesh effect.
    slider('reliefSeamWidth', 'SBP V-carve Seam Width', 0.02, 0.6, 0.01),
    // v15: 0/1 toggle. When 1, cell INTERIORS sit at the surface with a domed rise and the
    // cell BOUNDARIES are carved (matches the reference panel's "domed floors" signature).
    // When 0 (default), standard pocket carving (interior sunk, boundary at surface).
    slider('reliefInvertProfile', 'Domed Floors (0/1)', 0, 1, 1),
    anisoLabel,
    slider('reliefAnisotropy', 'Anisotropy (0=round)', 0, 1, 0.05),
    slider('reliefAnisotropyAngle', 'Anisotropy Angle (deg)', 0, 180, 1),
    attractorLabel,
    enumSelect('reliefAttractorMode', 'Mode', [
      ['none', 'None'], ['vertical', 'Vertical'], ['horizontal', 'Horizontal'],
      ['radial', 'Radial'], ['point', 'Point (inverse)'],
    ]),
    slider('reliefAttractorX', 'Anchor X (0-1)', 0, 1, 0.01),
    slider('reliefAttractorY', 'Anchor Y (0-1)', 0, 1, 0.01),
    slider('reliefAttractorRadius', 'Anchor Radius', 0.05, 1, 0.01),
    slider('reliefAttractorFalloff', 'Falloff', 0.2, 4, 0.05),
    slider('reliefDensityStrength', 'Density Boost', 0, 2, 0.05),
    slider('reliefCellSizeGradient', 'Cell Size Gradient', 0, 2, 0.05),
    slider('reliefIntensityStrength', 'Intensity Strength', 0, 1, 0.05),
    slider('reliefTransitionSoftness', 'Transition Softness', 0, 1, 0.05),
    slider('reliefVoidStrength', 'Void / Cut-Through', 0, 1, 0.02),
    slider('reliefAttractorNoise', 'Attractor Patchiness', 0, 1, 0.05),
    slider('reliefAttractorNoiseFreq', 'Patch Frequency', 0.02, 0.5, 0.01),
    slider('reliefFlowAnisotropy', 'Flow Anisotropy', 0, 1, 0.05),
    radialLabel,
    slider('reliefRadialFociCount', 'Flow Course (0=off)', 0, 3, 1),
    slider('reliefRadialFocus1X', 'Flow Point 1 X', 0, 1, 0.01),
    slider('reliefRadialFocus1Y', 'Flow Point 1 Y', 0, 1, 0.01),
    slider('reliefRadialFocus2X', 'Flow Point 2 X', 0, 1, 0.01),
    slider('reliefRadialFocus2Y', 'Flow Point 2 Y', 0, 1, 0.01),
    slider('reliefRadialFocus3X', 'Flow Point 3 X', 0, 1, 0.01),
    slider('reliefRadialFocus3Y', 'Flow Point 3 Y', 0, 1, 0.01),
    slider('reliefRadialStrength', 'Flow Tangent Strength', 0, 3, 0.05),
    slider('reliefRadialFalloff', 'Flow Width', 0.05, 0.6, 0.01),
    slider('reliefRadialGrow', 'Curvature Expansion', 0, 2, 0.05),
    slider('reliefRadialWarp', 'Flow Wobble', 0, 1, 0.02),
    enumSelect('reliefRadialMode', 'Radial Mode', [['rays', 'Rays'], ['rings', 'Rings'], ['spiral', 'Spiral']]),
    baseLabel,
    enumSelect('reliefBaseMode', 'Base', [['flat', 'Flat'], ['wave', 'Smooth Wave']]),
  ], false, 'noise-only');
}

function buildPeakValleySection(): HTMLElement {
  const description = createElement('div');
  description.style.fontSize = '10px';
  description.style.color = 'var(--text3)';
  description.style.marginBottom = '8px';
  description.textContent = 'Asymmetric control: shape peaks and valleys independently.';
  return buildSection('Peak / Valley Shaping', [
    description,
    slider('peakExp', 'Peak Sharpness (>1 = crisper ridges)', 0.2, 4, 0.05),
    slider('valleyExp', 'Valley Softness (<1 = broader valleys)', 0.1, 3, 0.05),
    slider('valleyFloor', 'Valley Floor (0=deep, 1=flat)', 0, 1, 0.01),
  ], false, 'noise-only');
}

function buildAdvancedNoiseSection(): HTMLElement {
  return buildSection('Advanced Noise', [
    slider('octaves', 'Octaves', 1, 8, 1),
    slider('persistence', 'Persistence', 0.1, 1, 0.05),
    slider('lacunarity', 'Lacunarity', 1, 4, 0.1),
    slider('distortion', 'Domain Warp / Distortion', 0, 2, 0.05),
    slider('warpFreq', 'Warp Frequency', 0.02, 0.4, 0.01),
    slider('warpCurl', 'Warp Curl (0=fold, 1=flow)', 0, 1, 0.05),
    slider('contrast', 'Contrast', 0.1, 3, 0.05),
    slider('sharpness', 'Sharpness', 0, 2, 0.05),
  ], false, 'noise-only');
}

function buildSmoothingSection(): HTMLElement {
  return buildSection('Smoothing', [
    slider('smoothIter', 'Iterations', 0, 15, 1),
    slider('smoothStr', 'Strength', 0, 1, 0.05),
  ], false, 'noise-only');
}

function buildDepthMapSection(): HTMLElement {
  const uploadZone = createElement('div', `upload-zone${STATE.depthMap ? ' has-image' : ''}`);
  uploadZone.id = 'uploadZone';
  uploadZone.tabIndex = 0;
  uploadZone.setAttribute('role', 'button');
  uploadZone.setAttribute('aria-label', 'Upload depth map image');

  const uploadText = createElement('div', 'upload-text', STATE.depthMapName || 'Click or drag to upload depth map');
  const input = createElement('input') as HTMLInputElement;
  input.type = 'file';
  input.id = 'depthMapInput';
  input.accept = 'image/*';
  uploadZone.append(uploadText, input);

  return buildSection('Depth Map', [
    uploadZone,
    slider('blend', 'Blend (0=image, 1=noise)', 0, 1, 0.01),
    slider('dmHeightScale', 'Depth Map Height Scale', 0, 6, 0.05),
    slider('dmOffset', 'Depth Map Offset', -1, 1, 0.01),
    slider('dmSmoothing', 'Depth Map Smoothing', 0, 15, 1),
  ], false, 'depth-map-only');
}

function buildViewControlsSection(): HTMLElement {
  const note = createElement('div');
  note.style.marginTop = '8px';
  note.style.fontSize = '10px';
  note.style.color = 'var(--text3)';
  note.textContent = 'Left drag = orbit/tilt · Right/Shift drag = pan · Scroll = zoom · Double-click = fit';

  return buildSection('View Controls', [
    slider('orbit', 'Orbit', 0, 360, 1),
    slider('tilt', 'Tilt', -90, 90, 1),
    slider('roll', 'Roll', -180, 180, 1),
    slider('zoom', 'Zoom', 0.1, 10, 0.05),
    note,
  ], false);
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

      // Cut depths cannot exceed material thickness
      if (key === 'baseThickness' || key === 'amplitude' || key === 'dmHeightScale') {
        const bt = STATE.baseThickness;
        const ampSlider = document.querySelector<HTMLInputElement>('input[data-key="amplitude"]');
        if (ampSlider) {
          ampSlider.max = String(bt);
          if (STATE.amplitude > bt) {
            STATE.amplitude = bt;
            ampSlider.value = String(bt);
            const ampVal = document.getElementById('val_amplitude');
            if (ampVal) ampVal.textContent = bt.toFixed(2);
          }
        }
        const dmSlider = document.querySelector<HTMLInputElement>('input[data-key="dmHeightScale"]');
        if (dmSlider) {
          dmSlider.max = String(bt);
          if (STATE.dmHeightScale > bt) {
            STATE.dmHeightScale = bt;
            dmSlider.value = String(bt);
            const dmVal = document.getElementById('val_dmHeightScale');
            if (dmVal) dmVal.textContent = bt.toFixed(2);
          }
        }
      }

      // Safe Z tracks material thickness
      if (key === 'baseThickness') {
        syncSbpSafeZ();
      }

      // Clear active preset/profile on manual change
      if (STATE.activePreset) {
        STATE.activePreset = null;
        const presetSel = document.getElementById('selPreset') as HTMLSelectElement | null;
        if (presetSel) presetSel.value = '';
      }
      if (STATE.activeProfile) {
        STATE.activeProfile = null;
        const pill = document.querySelector('.preset-pill.active[data-profile]');
        if (pill) pill.classList.remove('active');
      }

      debouncedGenerate(key);
    });

    // Double-click slider to reset to default
    sl.addEventListener('dblclick', () => {
      const def = sl.dataset.default;
      if (def === undefined) return;
      sl.value = def;
      sl.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  // Click value label to type exact number
  document.querySelectorAll<HTMLElement>('.control-label .val').forEach(valSpan => {
    const id = valSpan.id;
    if (!id.startsWith('val_')) return;
    const key = id.slice(4);
    const sl = document.querySelector<HTMLInputElement>(`input[data-key="${key}"]`);
    if (!sl) return;
    attachValueEdit(valSpan, sl);
  });

  // Enum/string select controls bound to STATE keys (excludes the noise-type and preset selects).
  document.querySelectorAll<HTMLSelectElement>('select[data-key]').forEach(sel => {
    const key = sel.dataset.key!;
    sel.addEventListener('change', () => {
      (STATE as unknown as Record<string, unknown>)[key] = sel.value;
      // Clear active preset/profile on manual change — same as slider behavior.
      if (STATE.activePreset) {
        STATE.activePreset = null;
        const presetSel = document.getElementById('selPreset') as HTMLSelectElement | null;
        if (presetSel) presetSel.value = '';
      }
      if (STATE.activeProfile) {
        STATE.activeProfile = null;
        const pill = document.querySelector('.preset-pill.active[data-profile]');
        if (pill) pill.classList.remove('active');
      }
      debouncedGenerate(key);
    });

    // Double-click select to reset to default (mirrors the slider gesture).
    sel.addEventListener('dblclick', () => {
      const def = sel.dataset.default;
      if (def === undefined) return;
      sel.value = def;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  // Section collapse
  wireSectionCollapse();
}

const isMobile = (): boolean => window.matchMedia('(max-width: 900px)').matches;

/** Wire accordion collapse/expand on a single section. Exported for SBP profile rebuild. */
export function wireSectionAccordion(section: Element): void {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const header = section.querySelector<HTMLElement>('.section-header');
  if (!header) return;
  const syncExpanded = (): void => {
    header.setAttribute('aria-expanded', String(!section.classList.contains('collapsed')));
  };
  header.addEventListener('click', () => {
    if (isMobile()) {
      const sections = sidebar.querySelectorAll('.section');
      const wasCollapsed = section.classList.contains('collapsed');
      sections.forEach(s => s.classList.add('collapsed'));
      if (wasCollapsed) section.classList.remove('collapsed');
      sections.forEach(s => {
        const h = s.querySelector<HTMLElement>('.section-header');
        if (h) h.setAttribute('aria-expanded', String(!s.classList.contains('collapsed')));
      });
    } else {
      section.classList.toggle('collapsed');
      syncExpanded();
    }
  });
  syncExpanded();
}

function wireSectionCollapse(): void {
  const sidebar = document.getElementById('sidebar')!;
  const sections = sidebar.querySelectorAll('.section');
  sections.forEach(s => wireSectionAccordion(s));
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
      }
      buildSidebar();
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
  const presetSel = document.getElementById('selPreset') as HTMLSelectElement | null;
  if (presetSel) {
    presetSel.addEventListener('change', () => {
      const key = presetSel.value;
      if (!key) return;
      const p = CNC_PRESETS[key];
      if (!p) return;
      Object.keys(p).forEach(k => { (STATE as unknown as Record<string, unknown>)[k] = p[k]; });
      STATE.activePreset = key;
      STATE.activeProfile = null;
      buildSidebar();
      generateMesh();
    });
  }

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
    el.style.display = (mode === 'noise' || mode === 'blend') ? 'block' : 'none';
  });
  document.querySelectorAll<HTMLElement>('.depth-map-only').forEach(el => {
    el.style.display = (mode === 'depthmap' || mode === 'blend') ? 'block' : 'none';
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
