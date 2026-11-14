import { buildCellGraph } from './graph';
import type { CellGraphWorkerRequest, CellGraphWorkerResponse } from './messages';
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<CellGraphWorkerRequest>) => void) | null;
  postMessage: (value: CellGraphWorkerResponse) => void;
};
scope.onmessage = (event) => {
  const { id, revision, source, maxSteps } = event.data;
  const result = buildCellGraph({ source, revision, maxSteps });
  scope.postMessage({ id, revision, result });
};
