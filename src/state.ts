export interface MeshState {
  mode: 'noise' | 'depthmap' | 'blend';
  viewMode: 'solid' | 'wireframe' | 'both' | 'points';
  exportFormat: 'stl' | 'obj' | '3dm' | 'heightmap';
  // Noise params
  noiseType: 'simplex' | 'perlin' | 'ridged' | 'fbm' | 'voronoi'
    | 'value' | 'opensimplex2' | 'worley' | 'billow' | 'turbulence'
    | 'hybrid' | 'hetero' | 'domainwarp' | 'gabor' | 'wavelet';
  frequency: number;
  amplitude: number;
  noiseExp: number;
  peakExp: number;
  valleyExp: number;
  valleyFloor: number;
  offset: number;
  seed: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  distortion: number;
  contrast: number;
  sharpness: number;
  gaborAngle: number;
  gaborBandwidth: number;
  // Mesh params
  meshX: number;
  meshY: number;
  resolution: number;
  smoothIter: number;
  smoothStr: number;
  baseThickness: number;
  // Depth map
  depthMap: HTMLImageElement | null;
  depthMapName: string;
  blend: number;
  dmHeightScale: number;
  dmOffset: number;
  dmSmoothing: number;
  depthMapAR: number | null;
  aspectLocked: boolean;
  // View
  orbit: number;
  tilt: number;
  roll: number;
  zoom: number;
  panX: number;
  panY: number;
  // Export
  watertight: boolean;
  binary: boolean;
  /** When true, 3DM export outputs a PointCloud (vertices only) instead of a polygon mesh. */
  export3dmAsPointCloud: boolean;
  filename: string;
  // Presets
  activePreset: string | null;
  activeProfile: string | null;
  // Internal
  vertices: number[][] | null;
  cols: number;
  rows: number;
  isDragging: boolean;
  lastMX: number;
  lastMY: number;
  genTime: number;
}

const DEFAULTS: MeshState = {
  mode: 'noise',
  viewMode: 'wireframe',
  exportFormat: 'stl',
  noiseType: 'simplex',
  frequency: 0.1,
  amplitude: 0.50,
  noiseExp: 0.5,
  peakExp: 1.0,
  valleyExp: 1.0,
  valleyFloor: 0,
  offset: 0,
  seed: 0,
  octaves: 2,
  persistence: 0.5,
  lacunarity: 2.0,
  distortion: 0,
  contrast: 1.0,
  sharpness: 0,
  gaborAngle: 45,
  gaborBandwidth: 1.5,
  meshX: 36,
  meshY: 24,
  resolution: 256,
  smoothIter: 0,
  smoothStr: 0.5,
  baseThickness: 0.75,
  depthMap: null,
  depthMapName: '',
  blend: 0.2,
  dmHeightScale: 1.0,
  dmOffset: -0.08,
  dmSmoothing: 7,
  depthMapAR: null,
  aspectLocked: false,
  orbit: 235,
  tilt: -25,
  roll: 0,
  zoom: 1.0,
  panX: 0,
  panY: 0,
  watertight: true,
  binary: true,
  export3dmAsPointCloud: false,
  filename: 'meshcraft_export',
  activePreset: null,
  activeProfile: null,
  vertices: null,
  cols: 256,
  rows: 256,
  isDragging: false,
  lastMX: 0,
  lastMY: 0,
  genTime: 0,
};

export const STATE: MeshState = { ...DEFAULTS };

export const noiseDims = { meshX: 36, meshY: 24, resolution: 256 };

export let demoDepthMap: HTMLImageElement | null = null;
export function setDemoDepthMap(img: HTMLImageElement | null): void {
  demoDepthMap = img;
}

// URL state serialization — only serialize keys that define a mesh config
const URL_SERIALIZABLE_KEYS: (keyof MeshState)[] = [
  'mode', 'noiseType', 'frequency', 'amplitude', 'noiseExp', 'peakExp', 'valleyExp',
  'valleyFloor', 'offset', 'seed', 'octaves', 'persistence', 'lacunarity', 'distortion',
  'contrast', 'sharpness', 'gaborAngle', 'gaborBandwidth', 'meshX', 'meshY', 'resolution', 'smoothIter', 'smoothStr',
  'baseThickness', 'blend', 'dmHeightScale', 'dmOffset', 'dmSmoothing', 'watertight',
  'viewMode', 'activePreset', 'activeProfile',
];

export function serializeConfig(): string {
  const diff: Record<string, unknown> = {};
  for (const key of URL_SERIALIZABLE_KEYS) {
    if (STATE[key] !== DEFAULTS[key]) {
      diff[key] = STATE[key];
    }
  }
  if (Object.keys(diff).length === 0) return '';
  return btoa(JSON.stringify(diff))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

export function deserializeConfig(searchParams: URLSearchParams): Partial<MeshState> {
  const encoded = searchParams.get('c');
  if (!encoded) return {};
  try {
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(padded);
    const parsed = JSON.parse(json);
    const result: Partial<MeshState> = {};
    for (const key of URL_SERIALIZABLE_KEYS) {
      if (key in parsed) {
        (result as Record<string, unknown>)[key] = parsed[key];
      }
    }
    return result;
  } catch {
    return {};
  }
}
