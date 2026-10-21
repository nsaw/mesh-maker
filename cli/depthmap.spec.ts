/**
 * Depth-map sampling and share-link contracts.
 * Run: npm run test:depthmap  (or: npx tsx cli/depthmap.spec.ts)
 *
 *   T13  luma sampling (Rec. 709; grayscale matches the old red-channel sampler)
 *   T13b the carving is not mirrored (image top-left lands at world top-left)
 *   T13c a constant image is not normalized into relief
 *   T14  background cutoff
 *   T15  share links: round trip, the BLEND -> DRAPE rename, retired drape keys, clamps, enum types
 * Moved here from the procedural drape spec when the Drape tab became a cloth simulation (2026-10-21).
 */

import { applyBackgroundCutoff, normalizeGrid, sampleLumaGrid } from '../src/geometry';
import { STATE, deserializeConfig, serializeConfig, stockTopIn } from '../src/state';
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
  const enc = (o: object) => '?c=' + Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  // The tab was BLEND until 2026-10-20: an old link's mode 'blend' opens the renamed DRAPE tab.
  const v12 = deserializeConfig(enc({ _v: 12, mode: 'blend', blend: 0.3, drapeFoldScale: 20, drapeThickness: 0.05, drapeConform: 0.4 }));
  assert(v12.mode === 'drape', 'old blend-mode link opens the Drape tab', `mode ${String(v12.mode)}`);
  // v14 replaced the procedural drape: none of its keys survives into the state.
  const v13 = deserializeConfig(enc({ _v: 13, mode: 'blend', blend: 0.6, drapeFoldSpacing: 0.8, drapeFoldAmp: 0.05, drapeFoldLength: 4,
    drapeHang: 0.5, drapeGravityAngle: 10, drapeThickness: 0.04, drapeConform: 0.3 }));
  const retired = ['blend', 'drapeFoldScale', 'drapeFoldDepth', 'drapeFoldWarp', 'drapeFoldSpacing', 'drapeFoldAmp', 'drapeFoldLength',
    'drapeHang', 'drapeGravityAngle', 'drapeThickness', 'drapeConform'].filter(k => k in v12 || k in v13);
  assert(retired.length === 0, 'retired procedural-drape keys are dropped from v12 and v13 links', retired.join(',') || 'none survived');
  const crafted = deserializeConfig(enc({ _v: 15, drapeTilt: 1e9, dmBackgroundCutoff: 5, viewMaterial: 'chrome', mode: 'evil', viewMode: 'x' }));
  assert(crafted.drapeTilt === 60 && crafted.dmBackgroundCutoff === 0.9, 'crafted numeric values clamp to slider ranges', JSON.stringify(crafted));
  assert(deserializeConfig(enc({ _v: 15, drapeTilt: -300 })).drapeTilt === -20, 'a tilt below the slider clamps to -20');
  assert(!('drapeTilt' in deserializeConfig(enc({ _v: 15, drapeTilt: 'NaN' }))), 'a non-numeric tilt is dropped');
  // Every DRAPE control is clamped to its slider: resolution and frames set the solver's work.
  const heavy = deserializeConfig(enc({ _v: 15, mode: 'drape', drapeClothRes: 1e6, drapeFrames: 1e6, drapeAttract: -5, drapeStock: 40,
    drapeReliefDepth: 'x', drapeWindMode: 'tornado' }));
  assert(heavy.drapeClothRes === 200 && heavy.drapeFrames === 240 && heavy.drapeAttract === 0 && heavy.drapeStock === 4
    && heavy.drapeReliefDepth === 0.625 && !('drapeWindMode' in heavy), 'crafted DRAPE controls clamp to their sliders or drop (a junk depth falls back to the default, capped to the stock)', JSON.stringify(heavy));
  const thin = deserializeConfig(enc({ _v: 15, mode: 'drape', drapeStock: 0.25, drapeReliefDepth: 3.95 }));
  assert(Math.abs(Number(thin.drapeReliefDepth) - 0.2) < 1e-9, 'a link\'s Relief Depth is capped to its material, keeping the minimum backing',
    `depth ${String(thin.drapeReliefDepth)} in 0.25 in`);
  const thinOnly = deserializeConfig(enc({ _v: 15, mode: 'drape', drapeStock: 0.25 }));
  assert(Math.abs(Number(thinOnly.drapeReliefDepth) - 0.2) < 1e-9, 'a thin-stock link without a depth gets the default depth capped too',
    `depth ${String(thinOnly.drapeReliefDepth)}`);
  // v15 changed only DRAPE keys: a v14 link that matches an old starburst fingerprint is already current
  // and must load as saved (main did not migrate v14 links); an older one still migrates.
  const polar = { mode: 'noise', reliefRadialFociCount: 2, reliefCellSize: 3.5, reliefRadialStrength: 1.8, reliefRadialFalloff: 0.5,
    reliefRadialGrow: 0.7, reliefRadialWarp: 0.35, baseThickness: 1.0, meshX: 10, meshY: 10 };
  const v14star = deserializeConfig(enc({ _v: 14, ...polar })), v13star = deserializeConfig(enc({ _v: 13, ...polar }));
  assert(v14star.baseThickness === 1.0 && v14star.meshX === 10 && v14star.activePreset === undefined,
    'a v14 starburst-fingerprint link loads as saved', JSON.stringify({ bt: v14star.baseThickness, x: v14star.meshX, preset: v14star.activePreset }));
  assert(v13star.activePreset === 'relief-starburst', 'an older starburst-fingerprint link still migrates to the current preset (control)');
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
  // v15 made the gathered silk the default: a v14 drape link was the plain silk proof and stays it.
  const v14 = deserializeConfig(enc({ _v: 14, mode: 'drape', drapeTilt: 30 }));
  assert(v14.drapeTilt === 30 && v14.drapeAttract === 0 && v14.drapeFrames === 100, 'a v14 drape link opens as the silk proof at its tilt',
    `tilt ${String(v14.drapeTilt)}, attraction ${String(v14.drapeAttract)}, frames ${String(v14.drapeFrames)}`);
  assert(!('drapeAttract' in deserializeConfig(enc({ _v: 14, mode: 'noise', frequency: 0.2 }))), 'a v14 noise link gets no drape keys');
  Object.assign(STATE, { mode: 'drape', drapeWindMode: 'wind', drapeClothRes: 140, drapeStock: 2.5, drapeReliefDepth: 1.75, drapeAttract: 1500 });
  const dl = deserializeConfig('?c=' + serializeConfig());
  assert(dl.drapeWindMode === 'wind' && dl.drapeClothRes === 140 && dl.drapeStock === 2.5 && dl.drapeReliefDepth === 1.75 && dl.drapeAttract === 1500,
    'DRAPE controls round-trip through a share link');
  Object.assign(STATE, saved);
  assert(!('viewMaterial' in crafted) && !('mode' in crafted) && !('viewMode' in crafted), 'unknown enum values fall back to defaults');
  // GPT review: ["blend"] stringifies to "blend" and passed a String()-coerced check, then failed
  // every strict comparison downstream. Every string-enum key must reject non-strings.
  const arrays = deserializeConfig(enc({ _v: 14, mode: ['blend'], viewMode: ['solid'], viewMaterial: ['neutral'], noiseType: ['perlin'],
    reliefPolarity: ['domes'], reliefProfile: { a: 1 }, reliefAttractorMode: null, reliefBaseMode: 1, reliefRadialMode: ['rays'],
    activePreset: 'no-such-preset', activeProfile: 'no-such-profile' }));
  const enumKeys = ['mode', 'viewMode', 'viewMaterial', 'noiseType', 'reliefPolarity', 'reliefProfile', 'reliefAttractorMode', 'reliefBaseMode', 'reliefRadialMode', 'activePreset', 'activeProfile'];
  const survivors = enumKeys.filter(k => k in arrays);
  assert(survivors.length === 0, 'non-string or unknown enum values are dropped for all 11 enum keys', survivors.join(',') || 'none survived');
  const presetArray = deserializeConfig(enc({ _v: 14, activePreset: ['relief-starburst'] }));
  assert(!('activePreset' in presetArray), 'an array that stringifies to a real preset name is dropped');
  for (const bad of ['false', 0, ['true'], null]) {
    const w = deserializeConfig(enc({ _v: 14, watertight: bad }));
    assert(!('watertight' in w), `watertight ${JSON.stringify(bad)} is dropped (only booleans load)`);
  }
  assert(deserializeConfig(enc({ _v: 14, watertight: false })).watertight === false, 'watertight false loads');
  const ok = deserializeConfig(enc({ _v: 14, noiseType: 'perlin', reliefPolarity: 'pockets', activePreset: null, activeProfile: null }));
  assert(ok.noiseType === 'perlin' && ok.reliefPolarity === 'pockets' && ok.activePreset === null && ok.activeProfile === null,
    'valid enum strings and null presets still load');
}


process.stdout.write(failures ? `\n${failures} FAILURE(S)\n` : '\nALL OK\n');
process.exit(failures ? 1 : 0);
