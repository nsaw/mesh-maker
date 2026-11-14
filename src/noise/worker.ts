import { buildNoiseSurface } from './surface';
import { packNoiseSurface, type NoiseWorkerInput, type NoiseWorkerOutput } from './messages';

const ctx = self as unknown as {
  onmessage: ((event: MessageEvent<NoiseWorkerInput>) => void) | null;
  postMessage(message: NoiseWorkerOutput, transfer: ArrayBuffer[]): void;
};
ctx.onmessage = ({ data }) => {
  try {
    const surface = packNoiseSurface(buildNoiseSurface(data.params));
    ctx.postMessage({ type: 'result', requestId: data.requestId, surface }, [surface.heights.buffer as ArrayBuffer]);
  } catch (error: unknown) {
    ctx.postMessage({ type: 'error', requestId: data.requestId,
      message: error instanceof Error ? error.message : String(error) }, []);
  }
};
