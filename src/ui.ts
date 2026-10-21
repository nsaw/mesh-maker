import { STATE, DEFAULTS, RELIEF_LOCKED_KEYS, boardIsLinkBoard, reliefMasterActive, saveNoiseDims } from './state';
import { cancelDrape, downloadDrapeRelief, drapeCarve, drapeControls, drapeStatusText, FIGURE_EXTENSIONS, generateDrape, loadFigureFile, onDrapeCarveChanged, onDrapeClothChanged, onDrapePoseChanged, restoreSizeAfterDrape } from './drape-ui';
import { DRAPE_CONTROLS, DRAPE_PRESETS, DRAPE_STOCK_RANGE, drapeControlEffect, MIN_DRAPE_BACKING_IN, type DrapeGroup } from './drape-controls';
import { RELIEF_EXTENSION, parseReliefMaster } from './relief-master';
import type { ReliefMaster } from './relief-master';
import { attachValueEdit, formatSliderValue } from './slider-utils';
import { CNC_PRESETS, PROFILES } from './noise/presets';
import { generateMesh, debouncedGenerate } from './mesh';
import { buildSBPSection, wireSBPControls, syncSbpSafeZ, syncSbpSafeZIfStockMoved } from './sbp-export';
import { updateExportControls } from './toolbar';
import { estimateDepth } from './depth-estimate';
import { showToast } from './toast';
import { applySurfaceMaterial } from './render';


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
    ...buildDrapeSections(),
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
  syncSbpSafeZIfStockMoved();
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
  const valueText = typeof val === 'number' ? formatSliderValue(val, step) : String(val);
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
    // DRAPE cuts its relief into at most 4 in of material (src/drape-controls.ts).
    slider('baseThickness', 'Material Thickness (in)', 0.25, STATE.mode === 'drape' ? DRAPE_STOCK_RANGE[1] : 6, 0.05),
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
    slider('reliefSeamDepth', 'Wall Extent (floor inset)', 0.05, 1, 0.05),
    // v16: fraction of the normalized cell distance held at surface level around every
    // cell boundary — walls get finite width instead of knife-edge ridge lines. The
    // measured response is aggressive (0.3 already floors ~88% of pixels), so presets
    // use small values (0.08–0.12).
    slider('reliefWallWidth', 'Wall Width', 0, 0.5, 0.01),
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
    // v15.1: 0 = smooth round-bottom gutter at cell boundary; 1 = knife-edge V-groove.
    // Linear blend of the profile curve toward a `bowlT` ramp. High values produce real
    // V-grooves but the rendered mesh will show polygon aliasing along seam ridges — fine
    // for CNC V-bit carving paths.
    slider('reliefSeamSharpness', 'Seam V-Groove Sharpness', 0, 1, 0.05),
    // v16.1: double-curvature pocket floors — past the bowl's saturation point the floor
    // rises into a soft central mound. Coverage gates which cells pillow (per-cell hash).
    slider('reliefPillow', 'Pillowed Floors', 0, 1, 0.05),
    slider('reliefPillowCoverage', 'Pillow Coverage', 0, 1, 0.05),
    // v16.3: per-cell depth tiers (deep/intermediate/suppressed) + asymmetric wall
    // profiles; junction crest lift with widened star-shaped nodes.
    slider('reliefDepthVariation', 'Depth Variation', 0, 1, 0.05),
    slider('reliefJunctionLift', 'Junction Peaks', 0, 1, 0.05),
    // v17: ridge-local crest height noise — mesas/saddles/fragmented envelope.
    slider('reliefCrestVariation', 'Crest Variation', 0, 1, 0.05),
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
    // v16: low-frequency noise on site density — giant and small cells coexist (the
    // lafabrica multi-scale patchiness). Independent of the attractor gradient above.
    slider('reliefDensityNoise', 'Cell Size Patchiness', 0, 1.5, 0.05),
    slider('reliefDensityNoiseFreq', 'Patch Scale', 0.02, 0.3, 0.01),
    slider('reliefCellSizeGradient', 'Cell Size Gradient', 0, 2, 0.05),
    slider('reliefIntensityStrength', 'Intensity Strength', 0, 1, 0.05),
    slider('reliefTransitionSoftness', 'Transition Softness', 0, 1, 0.05),
    slider('reliefVoidStrength', 'Void / Cut-Through', 0, 1, 0.02),
    slider('reliefAttractorNoise', 'Attractor Patchiness', 0, 1, 0.05),
    slider('reliefAttractorNoiseFreq', 'Patch Frequency', 0.02, 0.5, 0.01),
    radialLabel,
    slider('reliefRadialFociCount', 'Starburst Foci (0=off)', 0, 3, 1),
    slider('reliefRadialFocus1X', 'Focus 1 X', 0, 1, 0.01),
    slider('reliefRadialFocus1Y', 'Focus 1 Y', 0, 1, 0.01),
    slider('reliefRadialFocus2X', 'Focus 2 X', 0, 1, 0.01),
    slider('reliefRadialFocus2Y', 'Focus 2 Y', 0, 1, 0.01),
    slider('reliefRadialFocus3X', 'Focus 3 X', 0, 1, 0.01),
    slider('reliefRadialFocus3Y', 'Focus 3 Y', 0, 1, 0.01),
    slider('reliefRadialStrength', 'Starburst Strength', 0, 3, 0.05),
    slider('reliefRadialFalloff', 'Starburst Width', 0.05, 0.6, 0.01),
    slider('reliefRadialGrow', 'Focal Expansion', 0, 2, 0.05),
    slider('reliefRadialWarp', 'Starburst Wobble', 0, 1, 0.02),
    enumSelect('reliefRadialMode', 'Radial Mode', [['rays', 'Rays'], ['rings', 'Rings'], ['spiral', 'Spiral']]),
    baseLabel,
    enumSelect('reliefBaseMode', 'Base', [['flat', 'Flat'], ['wave', 'Smooth Wave']]),
    // v16 superposition: the cellular carve rides ON this wave — ridge tops undulate.
    slider('reliefBaseAmplitude', 'Base Wave Amplitude', 0, 2, 0.05),
    slider('reliefBaseFrequency', 'Base Wave Frequency', 0.02, 0.3, 0.01),
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
  const uploadZone = createElement('div', `upload-zone${STATE.depthMap || STATE.reliefMaster ? ' has-image' : ''}`);
  uploadZone.id = 'uploadZone';
  uploadZone.tabIndex = 0;
  uploadZone.setAttribute('role', 'button');
  uploadZone.setAttribute('aria-label', 'Upload depth map image');

  const uploadText = createElement('div', 'upload-text', STATE.depthMapName || 'Click or drag to upload depth map');
  const input = createElement('input') as HTMLInputElement;
  input.type = 'file';
  input.id = 'depthMapInput';
  input.accept = `image/*,${RELIEF_EXTENSION}`;
  uploadZone.append(uploadText, input);

  // AI depth estimation — converts the current photo into a real depth map (photos feed
  // luminance into the height field otherwise: marble highlights read as peaks). Lazy
  // model download on first use; on failure the luminance path stays untouched.
  const aiBtn = createElement('button', 'btn btn-sm', 'AI DEPTH FROM PHOTO') as HTMLButtonElement;
  aiBtn.id = 'aiDepthBtn';
  aiBtn.style.width = '100%';
  aiBtn.style.marginTop = '6px';
  aiBtn.addEventListener('click', () => { void runDepthEstimation(aiBtn); });

  // Image-only rows have no meaning for a relief master (its heights are final), so they hide
  // while one is active; the master's own facts take their place.
  const imageOnly = (el: HTMLElement): HTMLElement => { el.classList.add('image-only'); return el; };

  return buildSection('Depth Map', [
    uploadZone,
    reliefMasterInfo(),
    imageOnly(aiBtn),
    imageOnly(slider('dmHeightScale', 'Depth Map Height Scale', 0, 6, 0.05)),
    imageOnly(slider('dmOffset', 'Depth Map Offset', -1, 1, 0.01)),
    imageOnly(slider('dmBackgroundCutoff', 'Background Cutoff (0=off)', 0, 0.9, 0.01)),
    imageOnly(slider('dmSmoothing', 'Depth Map Smoothing', 0, 15, 1)),
  ], false, 'depth-map-only');
}

/** Units, up axis and turn applied to the next uploaded STL / OBJ / glTF figure (a .mcfig is
 *  already placed). Kept across sidebar rebuilds, not in share links. */
const figurePlacement = { metresPerUnit: 0.001, up: 'z' as 'z' | 'y', turnDeg: 0 };

/** DRAPE: a silk veil simulated over a 3D figure (src/drape-ui.ts, src/drape-sim), the web
 *  version of the Blender drapes in scripts/drape. One section runs it; the others hold its controls
 *  (src/drape-controls.ts), grouped. */
function buildDrapeSections(): HTMLElement[] {
  const zone = createElement('div', `upload-zone${STATE.drapeFigureName ? ' has-image' : ''}`);
  zone.id = 'drapeZone';
  zone.tabIndex = 0;
  zone.setAttribute('role', 'button');
  zone.setAttribute('aria-label', 'Upload a 3D figure to drape');
  const text = createElement('div', 'upload-text', STATE.drapeFigureName || 'Click or drag a 3D figure (.mcfig, .stl, .obj, .glb)');
  const input = createElement('input') as HTMLInputElement;
  input.type = 'file';
  input.id = 'drapeFigureInput';
  input.accept = FIGURE_EXTENSIONS.join(',');
  zone.append(text, input);
  const load = (f: File): void => { void loadFigureFile(f, { ...figurePlacement }); };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('dragover'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('dragover'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('dragover');
    const f = e.dataTransfer?.files[0];
    if (f) load(f);
  });
  input.addEventListener('change', () => { if (input.files?.[0]) load(input.files[0]); input.value = ''; });

  // Placement of an uploaded mesh: the drape assumes Z up, the face toward the viewer (-Y).
  const placeRow = createElement('div', 'control-row');
  placeRow.style.display = 'flex';
  placeRow.style.gap = '6px';
  placeRow.style.margin = '6px 0';
  const units = createElement('select') as HTMLSelectElement;
  units.setAttribute('aria-label', 'Units of an uploaded mesh');
  for (const [v, l] of [['0.001', 'mm'], ['0.01', 'cm'], ['1', 'm'], ['0.0254', 'in']]) units.add(new Option(l, v));
  units.value = String(figurePlacement.metresPerUnit);
  units.addEventListener('change', () => { figurePlacement.metresPerUnit = parseFloat(units.value); });
  const up = createElement('select') as HTMLSelectElement;
  up.setAttribute('aria-label', 'Up axis of an uploaded mesh');
  up.add(new Option('Z up', 'z')); up.add(new Option('Y up', 'y'));
  up.value = figurePlacement.up;
  up.addEventListener('change', () => { figurePlacement.up = up.value === 'y' ? 'y' : 'z'; });
  const turn = createElement('input') as HTMLInputElement;
  turn.type = 'number'; turn.min = '-180'; turn.max = '180'; turn.step = '5';
  turn.value = String(figurePlacement.turnDeg);
  turn.title = 'Turn the uploaded mesh about its vertical axis so the face looks at you, degrees';
  turn.setAttribute('aria-label', 'Turn of an uploaded mesh, degrees');
  turn.style.width = '64px';
  turn.addEventListener('change', () => { const v = parseFloat(turn.value); figurePlacement.turnDeg = Number.isFinite(v) ? Math.max(-180, Math.min(180, v)) : 0; });
  placeRow.append(units, up, turn);
  const placeNote = createElement('div', undefined, 'Upload placement: units, up axis, turn (deg). Applied when a mesh is loaded.');
  placeNote.style.fontSize = '10px';
  placeNote.style.color = 'var(--text3)';

  const btnRow = createElement('div');
  btnRow.style.display = 'flex';
  btnRow.style.gap = '6px';
  btnRow.style.margin = '8px 0 4px';
  const gen = createElement('button', 'btn btn-sm btn-primary', 'GENERATE DRAPE') as HTMLButtonElement;
  gen.id = 'drapeGenerateBtn';
  gen.style.flex = '1';
  gen.addEventListener('click', () => generateDrape());
  const run = drapeControls();
  gen.disabled = !run.canGenerate;
  const cancel = createElement('button', 'btn btn-sm', 'CANCEL') as HTMLButtonElement;
  cancel.id = 'drapeCancelBtn';
  cancel.style.display = run.running ? '' : 'none';
  cancel.addEventListener('click', () => cancelDrape());
  btnRow.append(gen, cancel);
  const dl = createElement('button', 'btn btn-sm', 'DOWNLOAD .MCRELIEF') as HTMLButtonElement;
  dl.style.width = '100%';
  dl.addEventListener('click', () => { void downloadDrapeRelief(); });

  const status = createElement('div', undefined, drapeStatusText());
  status.id = 'drapeStatus';
  status.setAttribute('role', 'status');
  status.style.margin = '6px 0';
  status.style.fontSize = '10px';
  status.style.color = 'var(--text2)';
  const about = createElement('div', undefined,
    'Silk cloth hung from the crown under gravity, simulated in this tab (Jolt Physics). The relief is the front view, 12 x 16 in, cut to Material Thickness and Relief Depth.');
  about.style.fontSize = '10px';
  about.style.color = 'var(--text3)';

  // Presets: one click sets every cloth, force and pose control.
  const presetRow = createElement('div', 'btn-row');
  presetRow.style.margin = '6px 0';
  for (const [id, preset] of Object.entries(DRAPE_PRESETS)) {
    const b = createElement('button', 'preset-pill', preset.label) as HTMLButtonElement;
    b.type = 'button';
    b.title = preset.about;
    b.dataset.drapePreset = id;
    b.addEventListener('click', () => {
      // A preset sets the drape, not the carve: Relief Depth stays as the user set it.
      const { drapeReliefDepth: _carve, ...settings } = preset.settings;
      Object.assign(STATE, settings, { drapeWindMode: preset.windMode });
      buildSidebar();
      // One toast: the cancel notice (if a drape was running) would be replaced by the preset's at once.
      const wasRunning = drapeControls().running;
      onDrapePoseChanged(`the ${preset.label} preset was applied`);
      onDrapeClothChanged();
      showToast(`${wasRunning ? 'Drape cancelled. ' : ''}${preset.label}: ${preset.about} Press Generate Drape.`, wasRunning ? 6000 : 4000);
    });
    presetRow.append(b);
  }

  const group = (g: DrapeGroup): HTMLDivElement[] => DRAPE_CONTROLS.filter(c => c.group === g).map(c => {
    // Relief Depth can use all but the minimum backing of the material.
    const max = c.key === 'drapeReliefDepth' ? Math.max(c.min, drapeCarve().stockIn - MIN_DRAPE_BACKING_IN) : c.max;
    return slider(c.key, c.label, c.min, max, c.step);
  });
  const note = (text: string): HTMLDivElement => {
    const n = createElement('div', undefined, text);
    n.style.fontSize = '10px'; n.style.color = 'var(--text3)'; n.style.margin = '4px 0';
    return n;
  };
  const windMode = enumSelect('drapeWindMode', 'Mode', [['off', 'Off'], ['wind', 'Wind (fixed direction)'], ['pressure', 'Pressure (onto the cloth)']]);

  return [
    buildSection('Drape', [zone, placeRow, placeNote, presetRow, btnRow, dl, status, about], false, 'drape-section'),
    buildSection('Drape: Figure', [...group('figure'), note('Changing the pose shows the bare figure again.')], false, 'drape-section'),
    buildSection('Drape: Cloth', [...group('cloth'),
      note('Sizes are life size (the bust is about 2.4 head-units of 12.5 cm). Fabric Thickness thickens the carved veil toward you; the solve treats the cloth as a sheet. Higher resolution takes longer.')],
    false, 'drape-section'),
    buildSection('Drape: Attraction', [...group('attraction'),
      note('Pulls the cloth toward the nearest point of the figure, as Blender\'s surface force field does: strength 1000 is about 1.4 g. It ramps in smoothly between the two frames.')],
    true, 'drape-section'),
    buildSection('Drape: Face (local attraction, surface fit)', [...group('face'),
      note('Local attraction pulls only the cloth over the face region toward the figure. Surface Fit moves that cloth toward the figure after the solve, keeping the collision clearance. The Blender study found both look glued; they are off by default.')],
    true, 'drape-section'),
    buildSection('Drape: Wind / Pressure', [windMode, ...group('wind'),
      note('Acts on the cloth inside the target circle of the front view. Wind pushes in one direction; pressure pushes the cloth onto the figure.')],
    true, 'drape-section'),
    buildSection('Drape: Solver', [...group('solver'),
      note('More steps and iterations solve contact and stretch more exactly and take proportionally longer. Display Subdivision smooths the solved cloth before carving; it adds no simulated detail.')],
    true, 'drape-section'),
    buildSection('Drape: Carve', [...group('carve'),
      note('Material Thickness is under Mesh Dimensions (up to 4 in). The relief is remapped at once; no new simulation.')],
    false, 'drape-section'),
  ];
}

/** What a loaded relief master is, so the numbers can be checked against its source. */
function reliefMasterInfo(): HTMLDivElement {
  const note = createElement('div', 'relief-master-info');
  note.style.margin = '6px 0 8px';
  note.style.fontSize = '10px';
  note.style.color = 'var(--text3)';
  const m = STATE.reliefMaster;
  if (!m) { note.style.display = 'none'; return note; }
  const lines = [
    `Relief master: ${m.cols} x ${m.rows} samples, ${m.widthIn.toFixed(3)}" x ${m.heightIn.toFixed(3)}", stock ${m.stockIn.toFixed(3)}", backing ${m.backingIn.toFixed(3)}".`,
    `Heights SHA-256 ${m.header.sha256.heights.slice(0, 12)}... verified. Exports and SBP use these heights at full resolution; Grid Resolution only sets the preview.`,
  ];
  if (m.header.license) lines.push(`License: ${m.header.license}.`);
  for (const text of lines) note.appendChild(createElement('div', undefined, text));
  return note;
}

function buildViewControlsSection(): HTMLElement {
  const note = createElement('div');
  note.style.marginTop = '8px';
  note.style.fontSize = '10px';
  note.style.color = 'var(--text3)';
  note.textContent = 'Left drag = orbit/tilt · Right/Shift drag = pan · Scroll = zoom · Double-click = fit';

  return buildSection('View Controls', [
    enumSelect('viewMaterial', 'Surface Shading', [['elevation', 'Elevation colors'], ['neutral', 'Neutral (judge form)']]),
    slider('orbit', 'Orbit', 0, 360, 1),
    slider('tilt', 'Tilt', -90, 90, 1),
    slider('roll', 'Roll', -180, 180, 1),
    slider('zoom', 'Zoom', 0.1, 10, 0.05),
    note,
  ], false);
}

/** Relief Depth can use all but MIN_DRAPE_BACKING_IN of the drape's material: cap its slider (and the
 *  value, if the material got thinner). */
function syncDrapeDepthMax(): void {
  const max = Math.max(0.05, STATE.drapeStock - MIN_DRAPE_BACKING_IN);
  const sl = document.querySelector<HTMLInputElement>('input[data-key="drapeReliefDepth"]');
  if (sl) sl.max = String(max);
  if (STATE.drapeReliefDepth > max) {
    STATE.drapeReliefDepth = Math.round(max * 1000) / 1000;
    if (sl) sl.value = String(STATE.drapeReliefDepth);
    const val = document.getElementById('val_drapeReliefDepth');
    if (val) val.textContent = formatSliderValue(STATE.drapeReliefDepth, 0.005);
  }
}

function wireControls(): void {
  // Sliders
  document.querySelectorAll<HTMLInputElement>('input[type="range"][data-key]').forEach(sl => {
    const key = sl.dataset.key!;
    sl.addEventListener('input', () => {
      // DRAPE owns its material thickness (drapeStock); baseThickness follows it there.
      if (STATE.mode === 'drape' && key === 'baseThickness') {
        const v = Math.min(DRAPE_STOCK_RANGE[1], Math.max(DRAPE_STOCK_RANGE[0], parseFloat(sl.value)));
        STATE.drapeStock = v; STATE.baseThickness = v;
        const valEl = document.getElementById('val_baseThickness');
        if (valEl) valEl.textContent = formatSliderValue(v, parseFloat(sl.step));
        syncDrapeDepthMax();
        // Safe Z follows once the remapped master lands (drape-ui syncSizeControls); exports wait for it.
        onDrapeCarveChanged();
        return;
      }
      if (reliefMasterActive() && RELIEF_LOCKED_KEYS.has(key)) {
        sl.value = String(STATE[key as keyof typeof STATE]);
        showToast(STATE.mode === 'drape'
          ? 'The drape relief is 12 x 16 in. Set its material thickness here and its depth under Drape: Carve.'
          : 'A relief master fixes size, stock and heights. Load an image to change them.', 3000);
        return;
      }
      const v = parseFloat(sl.value);
      (STATE as unknown as Record<string, unknown>)[key] = v;
      const valEl = document.getElementById('val_' + key);
      if (valEl) valEl.textContent = formatSliderValue(v, parseFloat(sl.step));

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

      // DRAPE controls drive the drape, not the mesh settings: the pose rebuilds the bare figure, the
      // carve remaps the relief, the rest waits for Generate Drape.
      const effect = drapeControlEffect(key);
      if (effect === 'pose') { onDrapePoseChanged(); return; }
      if (effect === 'carve') { onDrapeCarveChanged(); return; }
      if (effect === 'cloth') { onDrapeClothChanged(); return; }

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
      // Shading is view-only: swap the material, keep the mesh and the active preset.
      if (key === 'viewMaterial') {
        applySurfaceMaterial();
        return;
      }
      if (key === 'drapeWindMode') { onDrapeClothChanged(); return; }
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

/** Show the demo image on DEPTH MAP: the board keeps a DEPTH MAP share link's size while it still is
 *  that size (boardIsLinkBoard), else it is fitted to the image. One path for the page load and the
 *  tab switch, so the image arriving on either side of a tab visit gives the same board. */
export function showDemoDepthMap(img: HTMLImageElement): void {
  STATE.depthMap = img;
  STATE.depthMapName = 'Mona Lisa (demo)';
  if (boardIsLinkBoard()) STATE.depthMapAR = img.width / img.height;
  else fitMeshToAspect(img.width, img.height);
  const zone = document.getElementById('uploadZone');
  if (zone) {
    zone.classList.add('has-image');
    const text = zone.querySelector('.upload-text');
    if (text) text.textContent = STATE.depthMapName;
  }
}

/** Show STATE.aspectLocked on the lock button (also when code, not a click, changes it). */
export function syncAspectLockButton(): void {
  const lockBtn = document.getElementById('btnAspectLock');
  if (!lockBtn) return;
  lockBtn.classList.toggle('locked', STATE.aspectLocked);
  lockBtn.textContent = STATE.aspectLocked ? '\u{1F512}' : '\u{1F513}';
  lockBtn.title = STATE.aspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio';
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
      syncAspectLockButton();
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
    el.style.display = mode === 'noise' ? 'block' : 'none';
  });
  document.querySelectorAll<HTMLElement>('.depth-map-only').forEach(el => {
    el.style.display = mode === 'depthmap' ? 'block' : 'none';
  });
  document.querySelectorAll<HTMLElement>('.drape-section').forEach(el => {
    el.style.display = mode === 'drape' ? 'block' : 'none';
  });
  const master = reliefMasterActive();
  document.querySelectorAll<HTMLElement>('.image-only').forEach(el => {
    el.style.display = master ? 'none' : '';
  });
  document.querySelectorAll<HTMLElement>('.relief-master-info').forEach(el => {
    el.style.display = master ? '' : 'none';
  });
}

/** An image fit that arrived while another tab owned the size controls (an image or AI depth result
 *  that finished after the user left DEPTH MAP). Applied when DEPTH MAP is next entered. */
let pendingFit: { w: number; h: number } | null = null;

/** Size the board to an image's aspect. Only DEPTH MAP's board follows its image: on another tab the
 *  fit waits for DEPTH MAP, so NOISE and DRAPE keep their own sizes. */
export function fitMeshToAspect(imgW: number, imgH: number): void {
  if (STATE.mode !== 'depthmap') { pendingFit = { w: imgW, h: imgH }; return; }
  pendingFit = null;
  fitSizes(imgW, imgH);
}

/** Entering DEPTH MAP: apply a fit that arrived while another tab was open. Returns whether it did. */
export function applyPendingFit(): boolean {
  if (!pendingFit || STATE.mode !== 'depthmap' || STATE.reliefMaster) { pendingFit = null; return false; }
  const { w, h } = pendingFit;
  pendingFit = null;
  fitSizes(w, h);
  return true;
}

function fitSizes(imgW: number, imgH: number): void {
  const ar = imgW / imgH;
  if (ar >= 36 / 24) {
    STATE.meshX = 36;
    STATE.meshY = Math.max(1, Math.round(36 / ar));
  } else {
    STATE.meshY = 24;
    STATE.meshX = Math.max(1, Math.round(24 * ar));
  }
  // Full grid resolution: image resolution is the hard gate for depth-map quality, and 256
  // visibly quantized fine features. Capped by total grid cells: rows scale with meshY/meshX,
  // and an extreme portrait aspect at resolution 400 would allocate millions of vertices and
  // freeze the tab.
  const aspectRowsPerCol = STATE.meshY / STATE.meshX;
  const maxGridCells = 250000;
  STATE.resolution = Math.max(
    64,
    Math.min(400, Math.floor(Math.sqrt(maxGridCells / Math.max(0.05, aspectRowsPerCol)))),
  );
  STATE.depthMapAR = ar;
  STATE.aspectLocked = true;
}

/** Run monocular depth estimation on the current depth-map image and swap the result in
 *  (same state pattern as loadDepthMap). Failures leave state untouched — the luminance
 *  path keeps working offline or when the model can't load. */
async function runDepthEstimation(btn: HTMLButtonElement): Promise<void> {
  if (!STATE.depthMap) {
    showToast('Upload or select an image first');
    return;
  }
  // Re-estimating an already-estimated depth map degrades it (depth-of-a-depth-image).
  if (/ \(AI depth\)$/.test(STATE.depthMapName)) {
    showToast('Already an AI depth map — upload a new photo to re-estimate');
    return;
  }
  const source = STATE.depthMap;
  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = 'ESTIMATING…';
  showToast('Loading depth model — first use downloads ~25-50MB', 4000);
  try {
    const depthImg = await estimateDepth(source);
    // Stale-closure guard: if the user swapped images while estimation ran, discard this
    // result instead of overwriting the newer image with the old photo's depth.
    if (STATE.depthMap !== source) {
      showToast('Image changed during estimation — result discarded');
      return;
    }
    STATE.depthMap = depthImg;
    STATE.depthMapName = STATE.depthMapName.replace(/ \(AI depth\)$/, '') + ' (AI depth)';
    fitMeshToAspect(depthImg.width, depthImg.height);
    const zone = document.getElementById('uploadZone');
    if (zone) {
      zone.classList.add('has-image');
      zone.querySelector('.upload-text')!.textContent = STATE.depthMapName;
    }
    buildSidebar();
    generateMesh();
    showToast('Depth map estimated');
  } catch (err) {
    const reason = err instanceof Error && err.message ? ` (${err.message})` : '';
    showToast(`Depth estimation unavailable — using image luminance${reason}`, 4500);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

/** Bumped by every upload (image or relief master). A load that finishes after a newer upload
 *  started is discarded: reads and checksums are asynchronous and need not finish in order. */
let uploadRevision = 0;

export function loadDepthMap(file: File): void {
  const revision = ++uploadRevision;
  if (file.name.toLowerCase().endsWith(RELIEF_EXTENSION)) { void loadReliefMaster(file, revision); return; }
  const img = new Image();
  const objUrl = URL.createObjectURL(file);
  img.onload = () => {
    URL.revokeObjectURL(objUrl);
    if (revision !== uploadRevision) return;
    STATE.reliefMaster = null;
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
    if (revision !== uploadRevision) return;
    showToast('Could not read that image file');
  };
  img.src = objUrl;
}

/** Point the depth-map controls at the loaded relief master: its label, size and stock (set before
 *  the sidebar is rebuilt so the sliders show them), and on a fresh load a preview density with
 *  the same cell budget as an image depth map, never above the master's own. Shared by the loader
 *  and by re-entering DEPTH MAP mode from another tab. */
export function applyReliefMasterControls(resetPreviewDensity: boolean): void {
  const master = STATE.reliefMaster;
  if (!master) return;
  STATE.depthMapName = STATE.reliefMasterName;
  STATE.meshX = master.widthIn;
  STATE.meshY = master.heightIn;
  STATE.baseThickness = master.stockIn;
  STATE.depthMapAR = master.widthIn / master.heightIn;
  STATE.aspectLocked = true;
  if (resetPreviewDensity) {
    const maxGridCells = 250000;
    STATE.resolution = Math.min(master.cols, 400,
      Math.max(64, Math.floor(Math.sqrt(maxGridCells / Math.max(0.05, master.heightIn / master.widthIn)))));
  }
  const zone = document.getElementById('uploadZone');
  if (zone) {
    zone.classList.add('has-image');
    zone.querySelector('.upload-text')!.textContent = STATE.depthMapName;
  }
}

/** Load a .mcrelief master (src/relief-master.ts) and switch to DEPTH MAP mode. A file that fails
 *  any contract check is rejected whole, with the reason, and the current state is kept. */
async function loadReliefMaster(file: File, revision: number): Promise<void> {
  let master: ReliefMaster;
  try {
    master = await parseReliefMaster(await file.arrayBuffer());
  } catch (err) {
    if (revision === uploadRevision) showToast(err instanceof Error ? err.message : 'Could not read that relief master', 8000);
    return;
  }
  if (revision !== uploadRevision) return; // a newer upload owns the state now
  if (STATE.mode === 'noise') saveNoiseDims();
  // Leaving DRAPE this way skips the tab switch: hand back the sizes DRAPE took over first.
  if (STATE.mode === 'drape') restoreSizeAfterDrape();
  STATE.mode = 'depthmap';
  document.body.className = 'mode-depthmap';
  document.querySelectorAll('.mode-tab').forEach(b => b.classList.toggle('active', (b as HTMLElement).dataset.mode === 'depthmap'));
  STATE.reliefMaster = master;
  STATE.reliefMasterName = `${file.name} (relief master)`;
  STATE.depthMap = null;
  applyReliefMasterControls(true);
  buildSidebar();
  generateMesh();
  showToast(`Relief master loaded: ${master.cols} x ${master.rows}, ${master.widthIn.toFixed(2)}" x ${master.heightIn.toFixed(2)}"`, 4000);
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
