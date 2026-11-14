export interface Frame { x: number; y: number; width: number; height: number }
export interface FitPoint { x: number; y: number; z: number }

/** Perspective inequalities for every bounds corner, including its depth from the target. */
export function fitDistance(points: FitPoint[], frame: Frame, width: number, height: number, fov: number): number | null {
  if (frame.width <= 0 || frame.height <= 0 || width <= 0 || height <= 0 || !points.length) return null;
  const scale = height / (2 * Math.tan(fov / 2));
  const left = frame.x - width / 2, right = left + frame.width;
  const top = frame.y - height / 2, bottom = top + frame.height;
  const panX = (left + right) / 2, panY = (top + bottom) / 2;
  let distance = 0;
  for (const point of points) {
    distance = Math.max(distance,
      (scale * point.x + right * point.z) / (right - panX),
      (-scale * point.x - left * point.z) / (panX - left),
      (-scale * point.y + bottom * point.z) / (bottom - panY),
      (scale * point.y - top * point.z) / (panY - top),
      point.z + 0.01,
    );
  }
  return Number.isFinite(distance) ? Math.max(0.01, distance) : null;
}
