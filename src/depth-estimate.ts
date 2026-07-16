/**
 * In-browser monocular depth estimation — photo → real depth map.
 *
 * Photos feed luminance into the height pipeline, which caps how good any drape or
 * depth-map carve can look (marble highlights read as peaks). This module runs
 * Depth-Anything-V2-small (Apache-2.0 — do NOT swap in the base/large variants, they are
 * CC-BY-NC) via transformers.js to produce an actual depth image from the current photo.
 *
 * The heavy dependency is loaded lazily via dynamic import so it never lands in the main
 * chunk; the model (~25-50MB) downloads from the HF hub on first use and is cached by the
 * browser. WebGPU is tried first, WASM is the fallback. Offline or on failure the caller
 * keeps the luminance path — this feature is strictly additive.
 */

const MODEL_ID = 'onnx-community/depth-anything-v2-small';

/** Minimal structural view of the transformers.js depth-estimation output we consume. */
interface DepthOutput {
  depth: {
    data: Uint8Array | Uint8ClampedArray;
    width: number;
    height: number;
  };
}

type DepthPipeline = (input: string) => Promise<DepthOutput | DepthOutput[]>;

let pipelinePromise: Promise<DepthPipeline> | null = null;

/** WebGPU support probe. `pipeline({device:'webgpu'})` does NOT reliably throw at creation
 *  when no adapter exists — the backend error surfaces at inference — so probe the adapter
 *  up front and only request webgpu when one is actually available. */
async function pickDevice(): Promise<'webgpu' | 'wasm'> {
  try {
    const nav = navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown | null> } };
    if (nav.gpu && await nav.gpu.requestAdapter()) return 'webgpu';
  } catch {
    // Adapter probe failed — treat as no WebGPU.
  }
  return 'wasm';
}

async function loadPipeline(): Promise<DepthPipeline> {
  const { pipeline } = await import('@huggingface/transformers');
  const device = await pickDevice();
  try {
    return await pipeline('depth-estimation', MODEL_ID, { device }) as unknown as DepthPipeline;
  } catch (err) {
    if (device === 'webgpu') {
      // Adapter existed but session creation still failed — WASM works everywhere.
      return await pipeline('depth-estimation', MODEL_ID, { device: 'wasm' }) as unknown as DepthPipeline;
    }
    throw err;
  }
}

/** Estimate a depth map from an image element. Returns a grayscale image (brighter =
 *  closer to viewer = higher relief) sized to the source image. Throws on model-load or
 *  inference failure — callers decide the fallback UX. */
export async function estimateDepth(source: HTMLImageElement): Promise<HTMLImageElement> {
  if (!pipelinePromise) {
    pipelinePromise = loadPipeline();
    // A failed load must not poison every later attempt (e.g. transient network).
    pipelinePromise.catch(() => { pipelinePromise = null; });
  }
  const pipe = await pipelinePromise;

  // The source's object URL is revoked after load (loadDepthMap), so re-serialize the
  // pixels through a canvas before handing them to the pipeline.
  const srcCanvas = document.createElement('canvas');
  srcCanvas.width = source.naturalWidth || source.width;
  srcCanvas.height = source.naturalHeight || source.height;
  const srcCtx = srcCanvas.getContext('2d');
  if (!srcCtx) throw new Error('2d canvas unavailable');
  srcCtx.drawImage(source, 0, 0);
  const dataUrl = srcCanvas.toDataURL('image/png');

  const raw = await pipe(dataUrl);
  const result = Array.isArray(raw) ? raw[0] : raw;
  const { data, width, height } = result.depth;

  const outCanvas = document.createElement('canvas');
  outCanvas.width = width;
  outCanvas.height = height;
  const outCtx = outCanvas.getContext('2d');
  if (!outCtx) throw new Error('2d canvas unavailable');
  const imgData = outCtx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    const v = data[i];
    imgData.data[i * 4] = v;
    imgData.data[i * 4 + 1] = v;
    imgData.data[i * 4 + 2] = v;
    imgData.data[i * 4 + 3] = 255;
  }
  outCtx.putImageData(imgData, 0, 0);

  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('depth image decode failed'));
    img.src = outCanvas.toDataURL('image/png');
  });
}
