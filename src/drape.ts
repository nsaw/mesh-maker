/**
 * Drape compositor: BLEND mode's veil-over-form model.
 *
 * Composition (all heights in inches, grids row-major Float64Array, k = j * cols + i; row j runs
 * UP the panel: j = 0 is the bottom edge of the source image, world Y = 0, see sampleLumaGrid):
 *   obstacle = form + thickness: what the cloth rests on, exactly (thickness is a true clearance)
 *   membrane = argmin u >= obstacle, laplacian(u) = kappa: the obstacle problem a draped sheet
 *              solves (rests on supports, sags between them, never inflates peaks), then smoothed
 *              over the fabric's bend length and re-projected onto the obstacle, so a stiff
 *              fabric bridges fine concavities without ever sinking into a peak
 *   folds    = line-integral convolution of band-limited noise along a direction field that blends
 *              in-plane gravity (hanging veil) with downhill-from-supports (cloth pressed into the
 *              panel). Folds carry no height input, so thickness or absolute height cannot move them.
 *   surface  = max(membrane + amplitude(contact) * folds, obstacle): no penetration, no clamp to
 *              the form's maximum (the CNC mapping in mesh.ts makes headroom instead).
 *
 * Why not the previous model: it dilated the form with a square max filter (peaks swelled into
 * plateaus), phased folds by height (contour rings, which real cloth does not make: a cloth
 * simulation gives fold/contour alignment cos^2 = 0.10 on a dome vs 0.81 for the old fields), and
 * clamped the composite to the form's maximum before the CNC offset (zero clearance at peaks).
 *
 * All functions are pure grid -> grid transforms with no DOM or STATE access, so the Node specs
 * (cli/drape.spec.ts, cli/drape-physics.spec.ts) exercise exactly what the browser runs.
 */
import { SimplexNoiseGen } from './noise/generators';

// Projected SOR for the membrane obstacle problem, cascaded coarse-to-fine (see solveMembrane).
// Measured 2026-10-19 against a single-grid SOR run to a 1e-10 fixed point, 400x600: on the demo
// depth map 400 fine sweeps leave 0.0000 in max error at curvature 3/in and 0.0001 in at
// 0.47/in (~0.5 s); on a harsher speckled fixture (cli/drape.spec.ts T12b) 0.010 in at the
// default 0.48/in and 0.028 in at 0.3/in, where long bridged spans converge slowly. 800 sweeps
// would reach 0.0008 in at ~1 s. A cascade cannot remove that long-wavelength error; a projected
// multigrid would. Blend is an experimental preview, so the residual is documented, not hidden.
const PSOR_OMEGA = 1.9;
const PSOR_SWEEPS = 400;
// The coarsest level is small enough that brute-force sweeps converge outright.
const PSOR_BASE_SWEEPS = 400;
// Stop coarsening once either side would drop below this many cells.
const PSOR_MIN_LEVEL = 24;

// Fabric tension maps log-linearly onto membrane curvature (per inch): 0 hugs the form (strong sag
// pulls the sheet onto every support), 1 bridges between supports. The best fits to a cloth
// simulation fell at ~0.3 and ~1.0 per inch; the bridge end stops at 0.3 because flatter spans
// were never supported by the simulation and the solver cannot converge them (0.03/in left
// 0.15-0.29 in of error).
const KAPPA_HUG = 3;
const KAPPA_BRIDGE = 0.3;

// Detail Transmission: at conform 0 the fabric cannot follow features finer than this bend length.
const BEND_LENGTH_MAX_IN = 0.5;
// Smooth-then-project passes for fabric stiffness (layDrape). Two passes round the tent a single
// projection leaves at each contact edge.
const FABRIC_STIFFNESS_PASSES = 2;

// Stock fit (composeDrape). The form leaves headroom for folds of FOLD_HEADROOM_SIGMAS standard
// deviations of fold depth (the fold field has unit std), but never more than
// FOLD_HEADROOM_MAX_FRACTION of the cut, so the figure is laid at >= 0.75 x cut - thickness.
// Folds still rising past the cut are scaled down by the exact closed-form factor.
const FOLD_HEADROOM_SIGMAS = 2.5;
const FOLD_HEADROOM_MAX_FRACTION = 0.25;

// Fold directions are taken from a membrane on a grid decimated so that the direction smoothing
// length (FOLD_DIRECTION_SMOOTH_IN) spans about this many coarse cells. The field is smoothed over
// 3 in anyway, so the coarse grid loses nothing and the extra solve costs ~1% of the fine one.
const DIRECTION_CELLS_PER_SMOOTH = 8;

// Gap (inches) between membrane and obstacle over which contact fades from 1 to 0.
const CONTACT_GAP_LO_IN = 0.002;
const CONTACT_GAP_HI_IN = 0.02;

// Folds continue, shallower, across areas pressed onto the form (the Veiled Virgin shows folds
// running continuously across the cheeks); full depth where the cloth spans free.
const FOLD_CONTACT_FLOOR = 0.35;

// Smoothing length of the membrane used to derive the "downhill from supports" direction. It
// carries radial structure past a support's edge onto flat ground (unsmoothed, flat ground stayed
// isotropic: contour alignment 0.36-0.42). Calibrated 2026-10-19 against the reference cloth
// (cli/drape-physics.spec.ts, Coulomb friction, 128 grid): 3 in gives dome 0.048 (sim 0.107),
// two domes 0.230 (sim 0.276), hanging dome vertical 0.977 (sim 0.954). 0.5 in gave two domes 0.066
// and, with a unit-vector slope term, hanging 0.871.
const FOLD_DIRECTION_SMOOTH_IN = 3;

// Skew toward sharp-topped ridges: cloth lying on a support can only buckle upward. A cloth
// simulation's fold field has skew +0.56; 0.085 lands the line-integral fold field at +0.55
// (cli/drape.spec.ts T8).
const FOLD_SKEW = 0.085;

// Blurs wider than this many cells (sigma) run on a block-averaged grid (see decimatedBlur).
const BLUR_DECIMATE_ABOVE_SIGMA = 8;

// Line-integral-convolution strides per fold spacing (see foldField).
const LIC_STRIDES_PER_SPACING = 4;

export interface DrapeParams {
  cols: number;
  rows: number;
  /** Cell size in inches (grid is near-square: rows derive from cols x meshY / meshX). */
  dxIn: number;
  /** Height in inches that the normalized form spans. */
  formDepthIn: number;
  thicknessIn: number;
  /** 0 = hug the form, 1 = bridge between supports. */
  tension: number;
  /** Detail Transmission: 0 = felt (bends over ~0.5 in), 1 = silk (follows every detail). */
  conform: number;
  foldSpacingIn: number;
  foldAmpIn: number;
  /** Streamline half-length as a multiple of fold spacing (longer = straighter, longer folds). */
  foldLength: number;
  /** 0 = gravity into the panel (folds radiate from supports), 1 = hanging down the panel. */
  hang: number;
  /** In-plane gravity direction: 0 = down the image, positive = clockwise. */
  gravityAngleDeg: number;
  seed: number;
  /** When set, the total height (form + fabric) must fit within this many inches: the form is
   *  scaled down by however far the veil rises above it, so thickness and folds stay exact and
   *  nothing is clipped at the floor. Unset, the form spans exactly formDepthIn. */
  fitDepthIn?: number;
}

export interface DrapeResult {
  surface: Float64Array;
  obstacle: Float64Array;
  /** Cloth surface before folds: the membrane solve, stiffened by the fabric bend length. */
  membrane: Float64Array;
  contact: Float64Array;
  /** Unit-variance fold field (before amplitude). */
  folds: Float64Array;
  /** With fitDepthIn: how far the drape still exceeds it (inches). Nonzero only when the fabric
   *  thickness alone is deeper than the cut, i.e. the settings are infeasible. */
  fitOverflowIn: number;
  /** Depth (inches) the normalized form was laid at: formDepthIn, or (fit - thickness - fold
   *  headroom) if smaller. */
  formDepthUsedIn: number;
  /** Fraction of the requested fold depth used (1 unless the folds had to shrink to fit the cut). */
  foldScaleUsed: number;
}

/** Separable Gaussian blur, kernel radius ceil(3 sigma). Samples past an edge use odd reflection
 *  about the edge value (v(-t) = 2 v(0) - v(t)), which reproduces any linear ramp exactly; plain
 *  edge replication would lift a form that slopes into the panel edge. sigma <= 0 returns a copy. */
export function gaussianBlur(src: Float64Array, rows: number, cols: number, sigmaCells: number): Float64Array {
  if (!(sigmaCells > 0)) return src.slice();
  if (sigmaCells > BLUR_DECIMATE_ABOVE_SIGMA) return decimatedBlur(src, rows, cols, sigmaCells);
  return directBlur(src, rows, cols, sigmaCells);
}

/** Wide blurs (the 3 in fold-direction smoothing is ~75 cells at 400 columns) cost O(sigma) per
 *  cell directly. Block-average down by q, blur with sigma / q, and interpolate back up with linear
 *  extrapolation at the edges, so a linear ramp still survives exactly. */
function decimatedBlur(src: Float64Array, rows: number, cols: number, sigmaCells: number): Float64Array {
  const q = Math.max(2, Math.floor(sigmaCells / BLUR_DECIMATE_ABOVE_SIGMA * 2));
  const cr = Math.ceil(rows / q), cc = Math.ceil(cols / q);
  const coarse = new Float64Array(cr * cc);
  // Block centres in fine-cell coordinates (partial edge blocks centre on their own cells).
  const cy = new Float64Array(cr), cx = new Float64Array(cc);
  for (let J = 0; J < cr; J++) { const j0 = J * q, j1 = Math.min(rows, j0 + q); cy[J] = (j0 + j1 - 1) / 2; }
  for (let I = 0; I < cc; I++) { const i0 = I * q, i1 = Math.min(cols, i0 + q); cx[I] = (i0 + i1 - 1) / 2; }
  for (let J = 0; J < cr; J++) {
    const j0 = J * q, j1 = Math.min(rows, j0 + q);
    for (let I = 0; I < cc; I++) {
      const i0 = I * q, i1 = Math.min(cols, i0 + q);
      let acc = 0;
      for (let j = j0; j < j1; j++) for (let i = i0; i < i1; i++) acc += src[j * cols + i];
      coarse[J * cc + I] = acc / ((j1 - j0) * (i1 - i0));
    }
  }
  const blurred = directBlur(coarse, cr, cc, sigmaCells / q);
  // Separable linear interpolation from block centres back to cells, extrapolating past the ends.
  const lerpIndex = (centres: Float64Array, x: number): [number, number] => {
    const nC = centres.length;
    if (nC === 1) return [0, 0];
    let a = 0;
    while (a < nC - 2 && centres[a + 1] < x) a++;
    return [a, (x - centres[a]) / (centres[a + 1] - centres[a])];
  };
  const tmp = new Float64Array(cr * cols);
  for (let i = 0; i < cols; i++) {
    const [a, t] = lerpIndex(cx, i);
    const b = Math.min(cc - 1, a + 1);
    for (let J = 0; J < cr; J++) tmp[J * cols + i] = blurred[J * cc + a] * (1 - t) + blurred[J * cc + b] * t;
  }
  const out = new Float64Array(rows * cols);
  for (let j = 0; j < rows; j++) {
    const [a, t] = lerpIndex(cy, j);
    const b = Math.min(cr - 1, a + 1);
    for (let i = 0; i < cols; i++) out[j * cols + i] = tmp[a * cols + i] * (1 - t) + tmp[b * cols + i] * t;
  }
  return out;
}

/** Direct separable Gaussian (see gaussianBlur for the edge rule). */
function directBlur(src: Float64Array, rows: number, cols: number, sigmaCells: number): Float64Array {
  const r = Math.max(1, Math.ceil(3 * sigmaCells));
  const kernel = new Float64Array(2 * r + 1);
  let ksum = 0;
  for (let t = -r; t <= r; t++) { const w = Math.exp(-0.5 * (t / sigmaCells) ** 2); kernel[t + r] = w; ksum += w; }
  for (let t = 0; t < kernel.length; t++) kernel[t] /= ksum;
  // Odd-reflected sample of a 1-D line of length len read through get(idx).
  const sampleLine = (get: (idx: number) => number, len: number, idx: number): number => {
    if (idx < 0) { const m = Math.min(-idx, len - 1); return 2 * get(0) - get(m); }
    if (idx >= len) { const m = Math.max(0, 2 * (len - 1) - idx); return 2 * get(len - 1) - get(m); }
    return get(idx);
  };
  const tmp = new Float64Array(rows * cols);
  const out = new Float64Array(rows * cols);
  for (let j = 0; j < rows; j++) {
    const row = j * cols;
    const get = (idx: number): number => src[row + idx];
    for (let i = 0; i < cols; i++) {
      let acc = 0;
      if (i - r >= 0 && i + r < cols) {
        for (let t = -r; t <= r; t++) acc += src[row + i + t] * kernel[t + r];
      } else {
        for (let t = -r; t <= r; t++) acc += sampleLine(get, cols, i + t) * kernel[t + r];
      }
      tmp[row + i] = acc;
    }
  }
  for (let i = 0; i < cols; i++) {
    const get = (idx: number): number => tmp[idx * cols + i];
    for (let j = 0; j < rows; j++) {
      let acc = 0;
      if (j - r >= 0 && j + r < rows) {
        for (let t = -r; t <= r; t++) acc += tmp[(j + t) * cols + i] * kernel[t + r];
      } else {
        for (let t = -r; t <= r; t++) acc += sampleLine(get, rows, j + t) * kernel[t + r];
      }
      out[j * cols + i] = acc;
    }
  }
  return out;
}

/** In-place projected red-black SOR sweeps for u >= obstacle, avg4(u) - u = sagPerCell on the
 *  free set. Ghost cells past the panel edge are linearly extrapolated (u_ghost = 2 u_edge -
 *  u_inner): zero curvature at the edge, so a form sloping out of the frame keeps the cloth on it.
 *  Clamped (zero-slope) ghosts would lift the membrane off every form the panel edge cuts. */
function psorSweeps(u: Float64Array, obstacle: Float64Array, rows: number, cols: number, sagPerCell: number, sweeps: number): void {
  for (let s = 0; s < sweeps; s++) {
    for (let color = 0; color < 2; color++) {
      for (let j = 0; j < rows; j++) {
        const row = j * cols;
        for (let i = (j + color) & 1; i < cols; i += 2) {
          const k = row + i;
          const c = u[k];
          const left = i > 0 ? u[k - 1] : (cols > 1 ? 2 * c - u[k + 1] : c);
          const right = i < cols - 1 ? u[k + 1] : (cols > 1 ? 2 * c - u[k - 1] : c);
          const up = j > 0 ? u[k - cols] : (rows > 1 ? 2 * c - u[k + cols] : c);
          const down = j < rows - 1 ? u[k + cols] : (rows > 1 ? 2 * c - u[k - cols] : c);
          const gs = 0.25 * (left + right + up + down) - sagPerCell;
          const v = c + PSOR_OMEGA * (gs - c);
          u[k] = v > obstacle[k] ? v : obstacle[k];
        }
      }
    }
  }
}

/** Membrane over an obstacle: the u >= obstacle minimizing membrane energy under uniform sag,
 *  i.e. discrete laplacian(u) = 4 sagPerCell / dx^2 where the sheet is free (zero-curvature
 *  extrapolation at the panel edge, see psorSweeps). Coarse-to-fine: the obstacle is restricted
 *  by 2x2 AVERAGE, solved, upsampled bilinearly as the starting guess, projected onto the fine
 *  obstacle, then relaxed. (A 2x2 max restriction grew every one-pixel depth-map speck into a
 *  plateau per level; the inflated guess tented far above the solution and the fine sweeps could
 *  not pull it down: 0.22 in of error at the default tension.) */
export function solveMembrane(obstacle: Float64Array, rows: number, cols: number, sagPerCell: number): Float64Array {
  if (rows < PSOR_MIN_LEVEL || cols < PSOR_MIN_LEVEL) {
    const u = obstacle.slice();
    psorSweeps(u, obstacle, rows, cols, sagPerCell, PSOR_BASE_SWEEPS);
    return u;
  }
  const cr = Math.ceil(rows / 2), cc = Math.ceil(cols / 2);
  const coarse = new Float64Array(cr * cc), count = new Float64Array(cr * cc);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = (j >> 1) * cc + (i >> 1);
      coarse[k] += obstacle[j * cols + i];
      count[k]++;
    }
  for (let k = 0; k < coarse.length; k++) coarse[k] /= count[k];
  // Curvature in cell units scales with dx^2: a coarse cell is twice as wide, so 4x the sag.
  const uc = solveMembrane(coarse, cr, cc, sagPerCell * 4);
  const u = new Float64Array(rows * cols);
  for (let j = 0; j < rows; j++) {
    // Fine cell j sits at coarse coordinate (j - 0.5) / 2 (block centres).
    const y = Math.min(cr - 1, Math.max(0, (j - 0.5) / 2));
    const y0 = Math.min(cr - 2 < 0 ? 0 : cr - 2, Math.floor(y)), ty = cr > 1 ? y - y0 : 0;
    const y1 = Math.min(cr - 1, y0 + 1);
    for (let i = 0; i < cols; i++) {
      const x = Math.min(cc - 1, Math.max(0, (i - 0.5) / 2));
      const x0 = Math.min(cc - 2 < 0 ? 0 : cc - 2, Math.floor(x)), tx = cc > 1 ? x - x0 : 0;
      const x1 = Math.min(cc - 1, x0 + 1);
      const v = (uc[y0 * cc + x0] * (1 - tx) + uc[y0 * cc + x1] * tx) * (1 - ty)
              + (uc[y1 * cc + x0] * (1 - tx) + uc[y1 * cc + x1] * tx) * ty;
      const k = j * cols + i;
      u[k] = v > obstacle[k] ? v : obstacle[k];
    }
  }
  psorSweeps(u, obstacle, rows, cols, sagPerCell, PSOR_SWEEPS);
  return u;
}

/** Fabric Tension (0..1) to membrane curvature in 1/inch, log-linear between hug and bridge. */
export function tensionToCurvature(tension: number): number {
  const t = Math.max(0, Math.min(1, tension));
  return 10 ** (Math.log10(KAPPA_HUG) + (Math.log10(KAPPA_BRIDGE) - Math.log10(KAPPA_HUG)) * t);
}

/** Unit fold-direction field (crest direction). hang 0: downhill from supports on the smoothed
 *  membrane (cloth pressed into the panel radiates from what holds it up). hang 1: in-plane gravity
 *  (a hanging veil falls straight). Where neither term has a direction, gravity is used. */
export function foldDirection(
  membrane: Float64Array, rows: number, cols: number, dxIn: number,
  gravityAngleDeg: number, hang: number, smoothIn = FOLD_DIRECTION_SMOOTH_IN,
): { dx: Float64Array; dy: Float64Array } {
  const smooth = gaussianBlur(membrane, rows, cols, smoothIn / dxIn);
  const theta = Math.max(0, Math.min(1, hang)) * Math.PI / 2;
  const a = gravityAngleDeg * Math.PI / 180;
  // Angle 0 = -j (down the image: rows run up the panel); positive rotates clockwise as seen on
  // the image, so 90 deg points left.
  const gx = -Math.sin(a), gy = -Math.cos(a);
  const wg = Math.sin(theta), wr = Math.cos(theta);
  const dx = new Float64Array(rows * cols), dy = new Float64Array(rows * cols);
  for (let j = 0; j < rows; j++) {
    const jm = j > 0 ? j - 1 : 0, jp = j < rows - 1 ? j + 1 : rows - 1;
    for (let i = 0; i < cols; i++) {
      const im = i > 0 ? i - 1 : 0, ip = i < cols - 1 ? i + 1 : cols - 1;
      const sx = (smooth[j * cols + ip] - smooth[j * cols + im]) / ((ip - im || 1) * dxIn);
      const sy = (smooth[jp * cols + i] - smooth[jm * cols + i]) / ((jp - jm || 1) * dxIn);
      // Tangential pull of gravity on the cloth: the in-panel part acts everywhere, the into-panel
      // part acts in proportion to the local slope (physical, not a unit vector), so on flat
      // ground a hanging veil falls straight and on steep flanks it runs downhill.
      let vx = wg * gx - wr * sx, vy = wg * gy - wr * sy;
      let n = Math.hypot(vx, vy);
      if (n < 1e-9) { vx = gx; vy = gy; n = 1; }
      dx[j * cols + i] = vx / n;
      dy[j * cols + i] = vy / n;
    }
  }
  return { dx, dy };
}

/** Unit-variance fold field: band-limited simplex noise (feature size = foldSpacing) smeared along
 *  the direction field by line-integral convolution, so it forms elongated crests that follow the
 *  field, then skewed toward sharp tops. Deterministic per seed. */
export function foldField(
  dirX: Float64Array, dirY: Float64Array, rows: number, cols: number,
  spacingCells: number, lengthRatio: number, seed: number,
): Float64Array {
  const n = rows * cols;
  const gen = new SimplexNoiseGen((seed >>> 0) + 101);
  const spacing = Math.max(1, spacingCells);
  const base = new Float64Array(n);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) base[j * cols + i] = gen.noise(i / spacing, j / spacing);
  // The noise varies over one spacing, so integrating the streamline in quarter-spacing strides
  // smooths the same as unit strides at a fraction of the cost (and independent of resolution).
  const stride = Math.max(1, spacing / LIC_STRIDES_PER_SPACING);
  const steps = Math.max(1, Math.round(lengthRatio * spacing / stride));
  const out = new Float64Array(n);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      let acc = base[j * cols + i], wsum = 1;
      for (let sgn = -1; sgn <= 1; sgn += 2) {
        let x = i, y = j;
        for (let s = 1; s <= steps; s++) {
          const ci = Math.round(x), cj = Math.round(y);
          const k = (cj < 0 ? 0 : cj >= rows ? rows - 1 : cj) * cols + (ci < 0 ? 0 : ci >= cols ? cols - 1 : ci);
          x += sgn * stride * dirX[k];
          y += sgn * stride * dirY[k];
          if (x < 0 || x > cols - 1 || y < 0 || y > rows - 1) break;
          // Bilinear: with strides longer than a cell, nearest-cell reads alias into beads.
          const x0 = Math.min(cols - 2, Math.floor(x)), y0 = Math.min(rows - 2, Math.floor(y));
          const tx = x - x0, ty = y - y0, b0 = y0 * cols + x0;
          const v = (base[b0] * (1 - tx) + base[b0 + 1] * tx) * (1 - ty) + (base[b0 + cols] * (1 - tx) + base[b0 + cols + 1] * tx) * ty;
          const w = 1 - s / (steps + 1);
          acc += v * w;
          wsum += w;
        }
      }
      out[j * cols + i] = acc / wsum;
    }
  }
  standardize(out);
  for (let k = 0; k < n; k++) out[k] += FOLD_SKEW * (out[k] * out[k] - 1);
  standardize(out);
  return out;
}

/** Zero mean, unit standard deviation, in place. A constant field becomes all zeros. */
function standardize(a: Float64Array): void {
  let mean = 0;
  for (let k = 0; k < a.length; k++) mean += a[k];
  mean /= a.length || 1;
  let v = 0;
  for (let k = 0; k < a.length; k++) v += (a[k] - mean) ** 2;
  const sd = Math.sqrt(v / (a.length || 1));
  for (let k = 0; k < a.length; k++) a[k] = sd > 1e-12 ? (a[k] - mean) / sd : 0;
}

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Map a drape surface (inches above the form's floor) onto stock heights. The form's floor sits
 *  at bt - cutDepth; if the veil rises above the stock top, the whole surface shifts down by the
 *  overflow so form and fabric move together and clearance is preserved exactly. dmOffset is
 *  applied after that, then the result is clamped to [floorZ, bt]. */
export function drapeToStockHeights(
  surface: Float64Array, rows: number, cols: number,
  bt: number, cutDepth: number, dmOffset: number, floorZ: number,
): number[][] {
  let top = -Infinity;
  for (let k = 0; k < surface.length; k++) if (surface[k] > top) top = surface[k];
  const base = bt - cutDepth;
  const overflow = Math.max(0, base + top - bt);
  const out: number[][] = [];
  for (let j = 0; j < rows; j++) {
    out[j] = [];
    for (let i = 0; i < cols; i++) {
      const z = base + surface[j * cols + i] - overflow + dmOffset;
      out[j][i] = Math.max(floorZ, Math.min(bt, z));
    }
  }
  return out;
}

/** Fold directions from a membrane laid at the REQUESTED form depth (formDepthIn), with no
 *  thickness term, on a decimated grid. The fitted depth depends on thickness and fold depth, and
 *  taking directions from the fitted membrane made both sliders move the folds; a constant
 *  thickness cannot change a gradient, and this membrane never sees the fold depth. */
function directionsAtRequestedDepth(form01: Float64Array, p: DrapeParams): { dx: Float64Array; dy: Float64Array } {
  const { rows, cols, dxIn } = p;
  const q = Math.max(1, Math.floor(FOLD_DIRECTION_SMOOTH_IN / dxIn / DIRECTION_CELLS_PER_SMOOTH));
  const cr = Math.ceil(rows / q), cc = Math.ceil(cols / q);
  const coarse = new Float64Array(cr * cc), count = new Float64Array(cr * cc);
  for (let j = 0; j < rows; j++)
    for (let i = 0; i < cols; i++) {
      const k = Math.floor(j / q) * cc + Math.floor(i / q);
      coarse[k] += form01[j * cols + i] * p.formDepthIn;
      count[k]++;
    }
  for (let k = 0; k < coarse.length; k++) coarse[k] /= count[k];
  const cdx = dxIn * q;
  const membrane = solveMembrane(coarse, cr, cc, tensionToCurvature(p.tension) * cdx * cdx / 4);
  const dir = foldDirection(membrane, cr, cc, cdx, p.gravityAngleDeg, p.hang);
  if (q === 1) return dir;
  // Bilinear upsample from block centres, then renormalize to unit length.
  const dx = new Float64Array(rows * cols), dy = new Float64Array(rows * cols);
  for (let j = 0; j < rows; j++) {
    const y = Math.min(cr - 1, Math.max(0, (j + 0.5) / q - 0.5));
    const y0 = Math.min(Math.max(0, cr - 2), Math.floor(y)), ty = cr > 1 ? y - y0 : 0, y1 = Math.min(cr - 1, y0 + 1);
    for (let i = 0; i < cols; i++) {
      const x = Math.min(cc - 1, Math.max(0, (i + 0.5) / q - 0.5));
      const x0 = Math.min(Math.max(0, cc - 2), Math.floor(x)), tx = cc > 1 ? x - x0 : 0, x1 = Math.min(cc - 1, x0 + 1);
      const a = y0 * cc + x0, b = y0 * cc + x1, c = y1 * cc + x0, d = y1 * cc + x1;
      let vx = (dir.dx[a] * (1 - tx) + dir.dx[b] * tx) * (1 - ty) + (dir.dx[c] * (1 - tx) + dir.dx[d] * tx) * ty;
      let vy = (dir.dy[a] * (1 - tx) + dir.dy[b] * tx) * (1 - ty) + (dir.dy[c] * (1 - tx) + dir.dy[d] * tx) * ty;
      let n = Math.hypot(vx, vy);
      if (n < 1e-9) { vx = dir.dx[a]; vy = dir.dy[a]; n = Math.hypot(vx, vy) || 1; }
      dx[j * cols + i] = vx / n;
      dy[j * cols + i] = vy / n;
    }
  }
  return { dx, dy };
}

/** Obstacle, stiffened membrane, contact, fold field and per-cell fold amplitude for one form
 *  depth. The surface is assembled in composeDrape, where the fold scale is fitted. */
function layDrape(form01: Float64Array, formDepthIn: number, p: DrapeParams) {
  const { rows, cols, dxIn } = p;
  const n = rows * cols;
  const formIn = new Float64Array(n);
  for (let k = 0; k < n; k++) formIn[k] = form01[k] * formDepthIn;

  // The cloth may never sit closer to the form than its thickness: the obstacle is exact.
  const obstacle = new Float64Array(n);
  for (let k = 0; k < n; k++) obstacle[k] = formIn[k] + p.thicknessIn;

  // laplacian(u) = 4 s / dx^2 at the discrete fixed point, so s = kappa dx^2 / 4.
  const sagPerCell = tensionToCurvature(p.tension) * dxIn * dxIn / 4;
  let membrane = solveMembrane(obstacle, rows, cols, sagPerCell);

  // Fabric stiffness (Detail Transmission): a stiff cloth cannot follow detail finer than its
  // bend length, so smooth the CLOTH and project it back onto the obstacle. That bridges narrow
  // concavities and tents over narrow peaks, but never sinks below form + thickness. (Blurring
  // the form instead lowered narrow peaks and let the veil cut into them.)
  const conform = Math.max(0, Math.min(1, p.conform));
  const bendCells = (1 - conform) * BEND_LENGTH_MAX_IN / dxIn;
  if (bendCells > 0) {
    for (let pass = 0; pass < FABRIC_STIFFNESS_PASSES; pass++) {
      membrane = gaussianBlur(membrane, rows, cols, bendCells);
      for (let k = 0; k < n; k++) if (membrane[k] < obstacle[k]) membrane[k] = obstacle[k];
    }
  }

  const contact = new Float64Array(n);
  for (let k = 0; k < n; k++) contact[k] = 1 - smoothstep(CONTACT_GAP_LO_IN, CONTACT_GAP_HI_IN, membrane[k] - obstacle[k]);

  const { dx, dy } = directionsAtRequestedDepth(form01, p);
  const folds = foldField(dx, dy, rows, cols, p.foldSpacingIn / dxIn, p.foldLength, p.seed);

  // Fold height per cell at full scale: shallower where the cloth is pressed onto the form.
  const foldHeight = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    foldHeight[k] = p.foldAmpIn * (FOLD_CONTACT_FLOOR + (1 - FOLD_CONTACT_FLOOR) * (1 - contact[k])) * folds[k];
  }
  return { obstacle, membrane, contact, folds, foldHeight };
}

/** surface = max(membrane + scale * foldHeight, obstacle): folds never push the veil into the form. */
function assembleSurface(lay: ReturnType<typeof layDrape>, scale: number): Float64Array {
  const { membrane, foldHeight, obstacle } = lay;
  const surface = new Float64Array(membrane.length);
  for (let k = 0; k < surface.length; k++) {
    const h = membrane[k] + scale * foldHeight[k];
    surface[k] = h > obstacle[k] ? h : obstacle[k];
  }
  return surface;
}

function maxOf(a: Float64Array): number {
  let m = -Infinity;
  for (let k = 0; k < a.length; k++) if (a[k] > m) m = a[k];
  return m;
}

/** Full drape composition. `form01` is the normalized form (0..1), row-major rows x cols.
 *
 *  With `fitDepthIn` (the cut), the form is laid at (cut - thickness - fold headroom), so the cloth
 *  without folds is bounded by the cut (maximum principle) and ordinary folds fit above it. If folds
 *  still rise past the cut, they are scaled by the exact factor min over cells of
 *  (cut - membrane) / foldHeight (valid because the membrane never exceeds the cut). The headroom
 *  is capped, so deep folds shrink instead of erasing the figure. (Re-laying the form shallower to make room, as
 *  before, cost a membrane solve per pass, could stop unconverged, and at a 0.25 in fold depth kept
 *  1% of the figure's depth to preserve the folds. Laying it at exactly cut - thickness left no
 *  headroom at the summit, so every fold was scaled to ~1%.) */
export function composeDrape(form01: Float64Array, p: DrapeParams): DrapeResult {
  const headroom = p.fitDepthIn === undefined
    ? 0
    : Math.min(FOLD_HEADROOM_SIGMAS * p.foldAmpIn, FOLD_HEADROOM_MAX_FRACTION * p.fitDepthIn);
  const depth = p.fitDepthIn === undefined
    ? p.formDepthIn
    : Math.max(0, Math.min(p.formDepthIn, p.fitDepthIn - p.thicknessIn - headroom));
  const lay = layDrape(form01, depth, p);
  let scale = 1;
  let fitOverflowIn = 0;
  if (p.fitDepthIn !== undefined) {
    const fit = p.fitDepthIn;
    for (let k = 0; k < lay.membrane.length; k++) {
      if (lay.foldHeight[k] > 0) {
        const room = (fit - lay.membrane[k]) / lay.foldHeight[k];
        if (room < scale) scale = room;
      }
    }
    scale = Math.max(0, scale);
  }
  const surface = assembleSurface(lay, scale);
  if (p.fitDepthIn !== undefined) {
    const fit = p.fitDepthIn;
    // Only possible when the thickness alone exceeds the cut (then depth is 0 and scale is 0).
    // Below 1e-9 it is float rounding in the solve, not an infeasible setting.
    const over = maxOf(surface) - fit;
    fitOverflowIn = over > 1e-9 ? over : 0;
  }
  return {
    surface, obstacle: lay.obstacle, membrane: lay.membrane, contact: lay.contact, folds: lay.folds,
    fitOverflowIn, formDepthUsedIn: depth, foldScaleUsed: scale,
  };
}
