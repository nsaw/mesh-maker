import assert from 'node:assert/strict';
import { fitDistance, type FitPoint, type Frame } from '../src/fit-frame';

// Replay the perspective projection independently, including world-space screen pan.
for (const [width, height] of [[390, 500], [834, 948], [1120, 760]]) {
  for (const [halfX, halfY, halfZ] of [[18, 2, 1.3], [1, 12, 0.2], [18, 12, 3]]) {
    const frame: Frame = { x: 16, y: 96, width: width - 32, height: height - 160 };
    const points: FitPoint[] = [];
    for (const x of [-halfX, halfX]) for (const y of [-halfY, halfY]) for (const z of [-halfZ, halfZ]) points.push({ x, y, z });
    const fov = Math.PI / 3;
    const distance = fitDistance(points, frame, width, height, fov);
    assert(distance !== null);
    const panX = frame.x + frame.width / 2 - width / 2;
    const panY = frame.y + frame.height / 2 - height / 2;
    for (const point of points) {
      const scale = height / (2 * Math.tan(fov / 2));
      const x = width / 2 + (point.x * scale + panX * distance) / (distance - point.z);
      const y = height / 2 + (-point.y * scale + panY * distance) / (distance - point.z);
      assert(x >= frame.x - 1e-8 && x <= frame.x + frame.width + 1e-8, `${x} fits horizontal frame`);
      assert(y >= frame.y - 1e-8 && y <= frame.y + frame.height + 1e-8, `${y} fits vertical frame`);
    }
  }
}
assert.equal(fitDistance([{ x: 1, y: 1, z: 1 }], { x: 0, y: 0, width: 0, height: 0 }, 390, 0, Math.PI / 3), null);
assert.equal(fitDistance([], { x: 0, y: 0, width: 1, height: 1 }, 1, 1, Math.PI / 3), null);
assert.equal(fitDistance([{ x: NaN, y: 1, z: 1 }], { x: 0, y: 0, width: 1, height: 1 }, 1, 1, Math.PI / 3), null);
process.stdout.write('PASS fit-frame perspective replay, wide/tall/stock bounds and unavailable frames\n');
