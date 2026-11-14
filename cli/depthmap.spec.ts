/**
 * Depth-map sampling and share-link contracts.
 * Run: npm run test:depthmap  (or: npx tsx cli/depthmap.spec.ts)
 *
 *   T13  luma sampling (Rec. 709; grayscale matches the old red-channel sampler)
 *   T13b the carving is not mirrored (image top-left lands at world top-left)
 *   T13c a constant image is not normalized into relief
 *   T14  background cutoff
 *   T15  share links: version reset, round trip, numeric clamps and enum types
 * Moved here from the procedural drape spec when the Drape tab became a cloth simulation (2026-10-21).
 */

import { applyBackgroundCutoff, normalizeGrid, sampleLumaGrid } from '../src/geometry';
import { STATE, CURRENT_PAYLOAD_VERSION, consumeOutdatedLinkReset, boardIsLinkBoard, deserializeConfig, rememberLinkBoard, restoreNoiseDims, saveNoiseDims, serializeConfig, stockTopIn } from '../src/state';
import { generateNoiseMesh, generateDepthMapMesh } from '../src/mesh';
import { updateEffectiveOffsetDisplay } from '../src/sbp-export';
import { fitAspectToBed, loadDepthMap, syncDepthCaps } from '../src/ui';
import { DEFAULTS } from '../src/state';
import type { ReliefMaster } from '../src/relief-master';

let failures = 0;
function assert(condition: boolean, label: string, detail = ''): void {
  if (condition) {
    process.stdout.write(`  ok  ${label}${detail ? ` (${detail})` : ''}\n`);
  } else {
    process.stdout.write(`  FAIL ${label}${detail ? `: ${detail}` : ''}\n`);
    failures++;
  }
}

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let d = 0; for (let k = 0; k < a.length; k++) d = Math.max(d, Math.abs(a[k] - b[k])); return d;
}

// ---------- T13 luma ----------
process.stdout.write('T13 luma sampling\n');
{
  const w = 7, h = 5, gray = new Uint8ClampedArray(w * h * 4), color = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) {
    const v = (k * 37) % 256;
    gray.set([v, v, v, 255], k * 4);
    color.set([v, (k * 11) % 256, (k * 53) % 256, 255], k * 4);
  }
  // The pre-2026-10-19 sampler read the red channel only.
  const redOnly = (data: Uint8ClampedArray, cols: number, rows: number): number[][] => {
    const g: number[][] = [];
    for (let j = 0; j < rows; j++) { g[j] = [];
      const fy = (j / (rows - 1)) * (h - 1), iy0 = Math.min(Math.floor(fy), h - 1), iy1 = Math.min(iy0 + 1, h - 1), ty = fy - iy0;
      for (let i = 0; i < cols; i++) {
        const fx = (i / (cols - 1)) * (w - 1), ix0 = Math.min(Math.floor(fx), w - 1), ix1 = Math.min(ix0 + 1, w - 1), tx = fx - ix0;
        const top = data[(iy0 * w + ix0) * 4] * (1 - tx) + data[(iy0 * w + ix1) * 4] * tx;
        const bot = data[(iy1 * w + ix0) * 4] * (1 - tx) + data[(iy1 * w + ix1) * 4] * tx;
        g[j][i] = (top * (1 - ty) + bot * ty) / 255; } }
    return g;
  };
  // Same values as the old sampler, with rows in world order (grid row 0 = image bottom).
  const a = sampleLumaGrid(gray, w, h, 13, 9).flat(), b = redOnly(gray, 13, 9).reverse().flat();
  assert(maxAbsDiff(a, b) < 1e-12, 'grayscale input matches the old sampler, rows in world order', `max diff ${maxAbsDiff(a, b).toExponential(2)}`);
  const px = sampleLumaGrid(color, w, h, w, h)[h - 2][3], k = w + 3;   // grid row h-2 = image row 1
  const expect = (0.2126 * color[k * 4] + 0.7152 * color[k * 4 + 1] + 0.0722 * color[k * 4 + 2]) / 255;
  assert(Math.abs(px - expect) < 1e-12, 'color input uses Rec. 709 luma');
}

// ---------- T13b orientation ----------
process.stdout.write('T13b the carving is not mirrored\n');
{
  // Image with a bright TOP-LEFT quadrant. World Y grows away from the machine front (exports put
  // grid row j at y = j / (rows - 1) x meshY), so the bright patch must land at high j, low i.
  const w = 8, h = 8, img = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = x < w / 2 && y < h / 2 ? 255 : 0; img.set([v, v, v, 255], (y * w + x) * 4); }
  const g = sampleLumaGrid(img, w, h, w, h);
  assert(g[h - 1][0] > 1 - 1e-12 && g[0][0] === 0 && g[h - 1][w - 1] === 0, 'image top-left lands at world top-left (high Y, low X)',
    `g[top][left]=${g[h - 1][0]}, g[bottom][left]=${g[0][0]}, g[top][right]=${g[h - 1][w - 1]}`);
}

// ---------- T13c flat images stay flat ----------
process.stdout.write('T13c a constant image is not normalized into relief\n');
{
  // GPT's reproduction: RGB(144,144,144) everywhere carved 0.01-0.67 in, because luma rounding
  // (~2e-16 across bilinear samples) was stretched to the full depth.
  const w = 7, h = 5, img = new Uint8ClampedArray(w * h * 4);
  for (let k = 0; k < w * h; k++) img.set([144, 144, 144, 255], k * 4);
  const g = sampleLumaGrid(img, w, h, 400, 282);
  const flat = g.flat(), raw = Math.max(...flat) - Math.min(...flat);
  normalizeGrid(g, 282, 400);
  const after = g.flat();
  assert(after.every(v => v === 0), 'constant gray normalizes to all zeros', `raw range ${raw.toExponential(2)}, after max ${Math.max(...after)}`);
  // Real contrast of one 8-bit level still normalizes to the full range.
  const img2 = img.slice(); img2.set([145, 145, 145, 255], 0);
  const g2 = sampleLumaGrid(img2, w, h, 400, 282);
  normalizeGrid(g2, 282, 400);
  assert(Math.max(...g2.flat()) === 1, 'one gray level of contrast still spans [0, 1]');
}

// ---------- T14 background cutoff ----------
process.stdout.write('T14 background cutoff\n');
{
  const g = [[0, 0.25, 0.5, 0.75, 1]], g0 = g.map(r => r.slice());
  applyBackgroundCutoff(g0, 1, 5, 0);
  assert(maxAbsDiff(g0[0], g[0]) === 0, 'cutoff 0 is the identity');
  const g1 = g.map(r => r.slice());
  applyBackgroundCutoff(g1, 1, 5, 0.5);
  assert(g1[0][0] === 0 && g1[0][1] === 0 && g1[0][2] === 0 && Math.abs(g1[0][3] - 0.5) < 1e-12 && g1[0][4] === 1,
    'cutoff 0.5 flattens <= 0.5 and stretches the rest to [0, 1]', g1[0].map(v => v.toFixed(2)).join(','));
}

// ---------- T15 share links ----------
process.stdout.write('T15 share links\n');
{
  const saved = { ...STATE };
  Object.assign(STATE, { mode: 'drape', drapeTilt: 33, dmBackgroundCutoff: 0.45, viewMaterial: 'neutral' });
  const back = deserializeConfig('?c=' + serializeConfig());
  const keys = ['mode', 'drapeTilt', 'dmBackgroundCutoff', 'viewMaterial'] as const;
  assert(keys.every(k => back[k] === STATE[k]), 'Drape and depth-map keys round-trip through a share link');
  Object.assign(STATE, saved);
  const enc = (o: unknown) => '?c=' + Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  for (const version of [undefined, 0, 12, 13, 14, 15, 16]) {
    const old = deserializeConfig(enc({ _v: version, mode: 'drape', amplitude: 2 }));
    assert(Object.keys(old).length === 0 && consumeOutdatedLinkReset(), `version ${String(version)} resets settings with a notice`);
    assert(!consumeOutdatedLinkReset(), 'reset notice is consumed once');
  }
  deserializeConfig(enc({ _v: 16 }));
  deserializeConfig('');
  assert(!consumeOutdatedLinkReset(), 'a later decode without a link clears the reset notice');
  for (const payload of [null, [], 7, { _v: '17' }, { _v: 17.5 }, { _v: 18 }]) {
    assert(Object.keys(deserializeConfig(enc(payload))).length === 0, `invalid or unsupported payload ${JSON.stringify(payload)} is rejected`);
  }
  const crafted = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, drapeTilt: 1e9, dmBackgroundCutoff: 5, viewMaterial: 'chrome', mode: 'evil', viewMode: 'x' }));
  assert(crafted.drapeTilt === 60 && crafted.dmBackgroundCutoff === 0.9, 'crafted numeric values clamp to slider ranges', JSON.stringify(crafted));
  assert(deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, drapeTilt: -300 })).drapeTilt === -20, 'a tilt below the slider clamps to -20');
  assert(!('drapeTilt' in deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, drapeTilt: 'NaN' }))), 'a non-numeric tilt is dropped');
  // Every DRAPE control is clamped to its slider: resolution and frames set the solver's work.
  const heavy = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, mode: 'drape', drapeClothRes: 1e6, drapeFrames: 1e6, drapeAttract: -5, drapeStock: 40,
    drapeReliefDepth: 'x', drapeWindMode: 'tornado' }));
  assert(heavy.drapeClothRes === 200 && heavy.drapeFrames === 240 && heavy.drapeAttract === 0 && heavy.drapeStock === 2.6
    && heavy.drapeReliefDepth === 0.625 && !('drapeWindMode' in heavy), 'crafted DRAPE controls clamp to their sliders or drop (a junk depth falls back to the default, capped to the stock)', JSON.stringify(heavy));
  const thin = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, mode: 'drape', drapeStock: 0.25, drapeReliefDepth: 3.95 }));
  assert(Math.abs(Number(thin.drapeReliefDepth) - 0.1875) < 1e-9, 'a link\'s Relief Depth is capped to its material, keeping the minimum backing',
    `depth ${String(thin.drapeReliefDepth)} in 0.25 in`);
  const thinOnly = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, mode: 'drape', drapeStock: 0.25 }));
  assert(Math.abs(Number(thinOnly.drapeReliefDepth) - 0.1875) < 1e-9, 'a thin-stock link without a depth gets the default depth capped too',
    `depth ${String(thinOnly.drapeReliefDepth)}`);
  // SBP takes its stock top from the relief master while one drives the heights, so a Material
  // Thickness change that is still being remapped cannot pair a new stock top with old heights.
  {
    const keep = { mode: STATE.mode, drapeMaster: STATE.drapeMaster, baseThickness: STATE.baseThickness };
    Object.assign(STATE, { mode: 'drape', drapeMaster: { stockIn: 0.75 } as unknown as ReliefMaster, baseThickness: 2 });
    const withMaster = stockTopIn();
    Object.assign(STATE, { mode: 'noise' });
    const noise = stockTopIn();
    Object.assign(STATE, keep);
    assert(withMaster === 0.75 && noise === 2, 'the stock top is the master\'s while it drives the heights, Material Thickness otherwise',
      `drape ${withMaster}, noise ${noise}`);
  }
  const v16pos = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, mode: 'drape', drapeFaceX: 6, drapeCarveWidth: 40, drapeFigureScale: 1000 }));
  assert(v16pos.drapeFaceX === 6 && v16pos.drapeCarveWidth === 18 && v16pos.drapeFigureScale === 300,
    'a current link keeps its percentages; carve width and Figure Size clamp to their sliders', JSON.stringify(v16pos));
  const offGrid = [9.1, 12.1875, 'x'].map(w => deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, mode: 'drape', drapeCarveWidth: w })).drapeCarveWidth);
  assert(offGrid[0] === 9 && offGrid[1] === 12 && offGrid[2] === undefined, 'a link\'s carve width snaps to the sliders\' 0.75 in grid (junk dropped)', JSON.stringify(offGrid));
  {
    const keep = { ...STATE };
    Object.assign(STATE, { mode: 'drape', drapeCarveWidth: 9, drapeFigureScale: 140 });
    const back = deserializeConfig('?c=' + serializeConfig());
    Object.assign(STATE, keep);
    assert(back.drapeCarveWidth === 9 && back.drapeFigureScale === 140, 'carve width and Figure Size round-trip through a share link');
  }
  const capped = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, baseThickness: 4, amplitude: 4, dmHeightScale: 5, meshX: 48, meshY: 48, drapeStock: 4, drapeReliefDepth: 3.95 }));
  assert(capped.amplitude === 2.6 && capped.dmHeightScale === 2.6 && capped.drapeReliefDepth === 2.5375 && capped.meshX === 36 && capped.meshY === 24,
    'every cut depth and both dimensions respect the carve and bed limits', JSON.stringify(capped));
  const thinDepths = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, baseThickness: 0.25, amplitude: 4, dmHeightScale: 4 }));
  assert(thinDepths.amplitude === 0.25 && thinDepths.dmHeightScale === 2.6, 'an omitted mode caps the active Noise depth to thin stock and the inactive image depth globally');
  // The board a link carries is clamped to the sliders (a meshX 200 link kept a 200 in board).
  const wide = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, mode: 'depthmap', meshX: 200, meshY: -4, resolution: 1e6, baseThickness: 99 }));
  assert(wide.meshX === 36 && wide.meshY === 1 && wide.resolution === 1024 && wide.baseThickness === 2.6, 'link board sizes clamp to their sliders', JSON.stringify(wide));
  // The demo image keeps a DEPTH MAP link's board only while the board still is that size.
  {
    const keep = { ...STATE };
    const link = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, mode: 'depthmap', meshX: 20, meshY: 10 }));
    Object.assign(STATE, link); rememberLinkBoard(link);
    const kept = boardIsLinkBoard();
    Object.assign(STATE, { meshX: 36, meshY: 24 }); const changed = boardIsLinkBoard();
    Object.assign(STATE, { meshX: 20, meshY: 10 }); const back = boardIsLinkBoard();
    const noiseLink = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, mode: 'noise', meshX: 20, meshY: 10 }));
    Object.assign(STATE, noiseLink); rememberLinkBoard(noiseLink); const noise = boardIsLinkBoard();
    rememberLinkBoard({}); Object.assign(STATE, keep);
    assert(kept && !changed && back && !noise, 'a DEPTH MAP link keeps its board for the demo image while the board is unchanged; other links do not',
      JSON.stringify({ kept, changed, back, noise }));
  }
  // NOISE keeps its board, material thickness included, while DEPTH MAP (or a relief master) takes over
  // the shared controls (a 0.75 in master used to leave NOISE at 0.75 in).
  {
    const keep = { ...STATE };
    Object.assign(STATE, { meshX: 30, meshY: 20, resolution: 300, baseThickness: 1.5 });
    saveNoiseDims();
    Object.assign(STATE, { meshX: 12, meshY: 16, resolution: 400, baseThickness: 0.75, aspectLocked: true });
    restoreNoiseDims();
    const back = [STATE.meshX, STATE.meshY, STATE.resolution, STATE.baseThickness, STATE.aspectLocked];
    Object.assign(STATE, keep);
    assert(JSON.stringify(back) === JSON.stringify([30, 20, 300, 1.5, false]), 'NOISE gets its own size and material thickness back after DEPTH MAP', JSON.stringify(back));
  }
  Object.assign(STATE, { mode: 'drape', drapeWindMode: 'wind', drapeClothRes: 140, drapeStock: 2.5, drapeReliefDepth: 1.75, drapeAttract: 1500 });
  const dl = deserializeConfig('?c=' + serializeConfig());
  assert(dl.drapeWindMode === 'wind' && dl.drapeClothRes === 140 && dl.drapeStock === 2.5 && dl.drapeReliefDepth === 1.75 && dl.drapeAttract === 1500,
    'DRAPE controls round-trip through a share link');
  Object.assign(STATE, saved);
  assert(!('viewMaterial' in crafted) && !('mode' in crafted) && !('viewMode' in crafted), 'unknown enum values fall back to defaults');
  // GPT review: ["blend"] stringifies to "blend" and passed a String()-coerced check, then failed
  // every strict comparison downstream. Every string-enum key must reject non-strings.
  const arrays = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, mode: ['blend'], viewMode: ['solid'], viewMaterial: ['neutral'], noiseType: ['perlin'],
    reliefPolarity: ['domes'], reliefProfile: { a: 1 }, reliefAttractorMode: null, reliefBaseMode: 1, reliefRadialMode: ['rays'],
    activePreset: 'no-such-preset', activeProfile: 'no-such-profile' }));
  const enumKeys = ['mode', 'viewMode', 'viewMaterial', 'noiseType', 'reliefPolarity', 'reliefProfile', 'reliefAttractorMode', 'reliefBaseMode', 'reliefRadialMode', 'activePreset', 'activeProfile'];
  const survivors = enumKeys.filter(k => k in arrays);
  assert(survivors.length === 0, 'non-string or unknown enum values are dropped for all 11 enum keys', survivors.join(',') || 'none survived');
  const presetArray = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, activePreset: ['relief-starburst'] }));
  assert(!('activePreset' in presetArray), 'an array that stringifies to a real preset name is dropped');
  for (const bad of ['false', 0, ['true'], null]) {
    const w = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, watertight: bad }));
    assert(!('watertight' in w), `watertight ${JSON.stringify(bad)} is dropped (only booleans load)`);
  }
  assert(deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, watertight: false })).watertight === false, 'watertight false loads');
  const ok = deserializeConfig(enc({ _v: CURRENT_PAYLOAD_VERSION, noiseType: 'perlin', reliefPolarity: 'pockets', activePreset: null, activeProfile: null }));
  assert(ok.noiseType === 'perlin' && ok.reliefPolarity === 'pockets' && ok.activePreset === null && ok.activeProfile === null,
    'valid enum strings and null presets still load');
}


process.stdout.write('T15b share links preserve inactive mode depth requests\n');
{
  const saved = { ...STATE };
  try {
    for (const mode of ['noise', 'depthmap', 'drape'] as const) {
      Object.assign(STATE, DEFAULTS, { mode, baseThickness: 0.25,
        amplitude: mode === 'noise' ? 0.2 : 2, dmHeightScale: mode === 'depthmap' ? 0.2 : 1.5,
        drapeStock: 0.25, drapeReliefDepth: 0.1875 });
      const encoded = serializeConfig();
      const payload: Record<string, unknown> = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
      const back = { ...DEFAULTS, ...deserializeConfig('?c=' + encoded) };
      assert(back.mode === mode && back.amplitude === STATE.amplitude && back.dmHeightScale === STATE.dmHeightScale,
        `${mode} serializer round-trip keeps inactive depths above the current thin stock`,
        JSON.stringify({ amplitude: back.amplitude, dmHeightScale: back.dmHeightScale }));
      if (mode === 'noise') assert(!('mode' in payload), 'the Noise round-trip exercises a serialized payload with its default mode omitted');
      if (mode === 'drape') assert(back.drapeReliefDepth === 0.1875, 'the active Drape depth still respects its own thin stock');

      Object.assign(STATE, { amplitude: 4, dmHeightScale: 5 });
      const capped = { ...DEFAULTS, ...deserializeConfig('?c=' + serializeConfig()) };
      assert(capped.amplitude === (mode === 'noise' ? 0.25 : 2.6)
        && capped.dmHeightScale === (mode === 'depthmap' ? 0.25 : 2.6),
        `${mode} stock-caps only its active request and globally caps oversized inactive requests`,
        JSON.stringify({ amplitude: capped.amplitude, dmHeightScale: capped.dmHeightScale }));
    }
    Object.assign(STATE, DEFAULTS, { mode: 'depthmap', amplitude: 2, dmHeightScale: 4 });
    const encoded = serializeConfig();
    const payload: Record<string, unknown> = JSON.parse(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')));
    const back = { ...DEFAULTS, ...deserializeConfig('?c=' + encoded) };
    assert(!('baseThickness' in payload) && back.amplitude === 2 && back.dmHeightScale === DEFAULTS.baseThickness,
      'an omitted stock uses the default stock for the active request without shrinking the inactive request');
    const invalidMode = '?c=' + Buffer.from(JSON.stringify({ _v: CURRENT_PAYLOAD_VERSION, mode: 'invalid',
      baseThickness: 0.25, amplitude: 4, dmHeightScale: 5 })).toString('base64url');
    const fallback = deserializeConfig(invalidMode);
    assert(!('mode' in fallback) && fallback.amplitude === 0.25 && fallback.dmHeightScale === 2.6,
      'an invalid mode is sanitized before selecting the default Noise stock cap');
  } finally {
    Object.assign(STATE, saved);
  }
}


// Measure produced heights as well as controls: offsets are applied after requested depth.
process.stdout.write('T16 generated depth limits including negative offsets\n');
{
  const saved = { ...STATE };
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  try {
    for (const watertight of [false, true]) {
      Object.assign(STATE, DEFAULTS, { resolution: 16, meshX: 4, meshY: 4, baseThickness: 2.6, amplitude: 4, offset: -2, watertight });
      generateNoiseMesh();
      assert(STATE.vertices !== null && STATE.vertices.every(row => row.every(z => z >= 0 && z <= 2.6)), `noise heights respect stock and carving cap, watertight ${watertight}`);
    }
    const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
    const offsetNote = { textContent: '', classList: { toggle: () => undefined } };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: {
      querySelector: () => null, getElementById: (id: string) => id === 'sbpEffectiveOffsets' ? offsetNote : null,
      createElement: () => ({ width: 2, height: 2, getContext: () => ({ drawImage: () => undefined, getImageData: () => ({ data: pixels }) }) }),
    } });
    Object.assign(STATE, DEFAULTS, { mode: 'drape', baseThickness: 0.75, amplitude: 2, dmHeightScale: 1.5 });
    syncDepthCaps();
    assert(STATE.amplitude === 2 && STATE.dmHeightScale === 1.5, 'drape sidebar rebuild preserves the other modes cut requests');
    Object.assign(STATE, { mode: 'depthmap', baseThickness: 0.75 });
    syncDepthCaps();
    assert(STATE.amplitude === 2 && STATE.dmHeightScale === 0.75, 'image controls clamp only the image depth request');
    Object.assign(STATE, { mode: 'noise', baseThickness: 2.5 });
    syncDepthCaps();
    assert(STATE.amplitude === 2, 'returning to noise restores its stock without losing its depth request');
    Object.assign(STATE, { meshX: 35.96, meshY: 23.96 });
    updateEffectiveOffsetDisplay();
    assert(offsetNote.textContent.includes('X 0.04, Y 0.04'), 'offset readout preserves sub-tenth placement from decimal part dimensions', offsetNote.textContent);
    // Only dimensions are used from the image; the canvas supplies a known black-to-white ramp.
    Object.assign(STATE, DEFAULTS, { mode: 'depthmap', depthMap: { width: 2, height: 2 }, resolution: 16, meshX: 4, meshY: 4,
      baseThickness: 2.6, dmHeightScale: 4, dmOffset: -1, dmSmoothing: 0 });
    generateDepthMapMesh();
    assert(STATE.vertices !== null && STATE.vertices.every(row => row.every(z => z >= 0.01 && z <= 2.6)), 'depth-map heights respect stock and carving cap after a negative offset');
  } finally {
    Object.assign(STATE, saved);
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}


process.stdout.write('T17 locked image aspect fits both board dimensions\n');
{
  for (const [label, aspect, requestedWidth, expectedX, expectedY] of [
    ['square width at bed edge', 1, 36, 24, 24],
    ['wide image height at bed edge', 2, 24 * 2, 36, 18],
    ['wide image minimum height', 2, 0.1, 2, 1],
    ['tall image minimum width', 0.5, 0.1, 1, 2],
    ['narrowest feasible image', 1 / 24, 36, 1, 24],
    ['widest feasible image', 36, 1, 36, 1],
  ] as const) {
    const fit = fitAspectToBed(aspect, requestedWidth);
    assert(fit !== null && Math.abs(fit.meshX - expectedX) < 1e-12 && Math.abs(fit.meshY - expectedY) < 1e-12,
      label, JSON.stringify(fit));
  }
  const aspect = 17 / 13;
  const fractional = fitAspectToBed(aspect, 17.25);
  assert(fractional !== null && fractional.meshX === 17.25
    && Math.abs(fractional.meshX / fractional.meshY - aspect) < 1e-12
    && fractional.meshY !== Math.round(fractional.meshY),
    'non-integer dimensions preserve the image ratio without rounding a peer dimension', JSON.stringify(fractional));
  const capped = fitAspectToBed(aspect, 36);
  assert(capped !== null && capped.meshY <= 24 && capped.meshX <= 36
    && Math.abs(capped.meshX / capped.meshY - aspect) < 1e-12,
    'a non-integer aspect stays exact when the other bed axis limits its size', JSON.stringify(capped));
  for (const invalid of [0, -1, NaN, Infinity, -Infinity, 37, 1 / 25, 1e300, 1e-300]) {
    assert(fitAspectToBed(invalid, 12) === null, `invalid or bed-incompatible aspect ${invalid} is refused`);
  }
  for (const width of [NaN, Infinity, -Infinity]) {
    assert(fitAspectToBed(1, width) === null, `non-finite requested width ${width} is refused`);
  }
}


process.stdout.write('T18 zero-sized decoded images preserve the current document\n');
{
  const saved = { ...STATE };
  const imageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const documentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const created: string[] = [], revoked: string[] = [];
  try {
    URL.createObjectURL = blob => { const url = create(blob); created.push(url); return url; };
    URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: () => null } });
    Object.assign(STATE, DEFAULTS, { meshX: 12.25, meshY: 16.125, depthMapName: 'retained image' });
    const before = { ...STATE };
    for (const [width, height] of [[0, 2], [2, 0], [0, 0]]) {
      Object.defineProperty(globalThis, 'Image', { configurable: true, value: class {
        width = width;
        height = height;
        onload: (() => void) | null = null;
        set src(_value: string) { this.onload?.(); }
      } });
      let error = '';
      try { loadDepthMap(new File(['zero image'], 'empty.svg', { type: 'image/svg+xml' })); }
      catch (e) { error = e instanceof Error ? e.message : String(e); }
      assert(error === '' && STATE.depthMap === before.depthMap && STATE.depthMapName === before.depthMapName
        && STATE.reliefMaster === before.reliefMaster && STATE.meshX === before.meshX && STATE.meshY === before.meshY,
      `decoded ${width} x ${height} image is rejected before replacing state`, error);
    }
    assert(created.length === 3 && created.every((url, i) => url === revoked[i]), 'every rejected image revokes its actual object URL');
  } finally {
    Object.assign(STATE, saved);
    URL.createObjectURL = create; URL.revokeObjectURL = revoke;
    if (imageDescriptor) Object.defineProperty(globalThis, 'Image', imageDescriptor);
    else Reflect.deleteProperty(globalThis, 'Image');
    if (documentDescriptor) Object.defineProperty(globalThis, 'document', documentDescriptor);
    else Reflect.deleteProperty(globalThis, 'document');
  }
}

process.stdout.write(failures ? `\n${failures} FAILURE(S)\n` : '\nALL OK\n');
process.exit(failures ? 1 : 0);
