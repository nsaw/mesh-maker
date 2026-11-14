/** Exact bucket queries over ordered sites. Distances and index ties match a full scan. */
export interface GridSite { x: number; y: number }

export interface NearestFour {
  f1: number; f2: number; f3: number; f4: number;
  idx: number; idx2: number; idx3: number; idx4: number;
}

export class SiteGrid {
  private readonly buckets: (number[] | undefined)[];
  private readonly columns: number;
  private readonly rows: number;
  private readonly minX: number;
  private readonly minY: number;
  private readonly spacing: number;

  constructor(
    private readonly sites: readonly GridSite[],
    spacing: number,
    bounds?: { minX: number; minY: number; maxX: number; maxY: number },
  ) {
    let minX = bounds?.minX ?? Infinity, minY = bounds?.minY ?? Infinity;
    let maxX = bounds?.maxX ?? -Infinity, maxY = bounds?.maxY ?? -Infinity;
    if (!bounds) for (const site of sites) {
      minX = Math.min(minX, site.x); minY = Math.min(minY, site.y);
      maxX = Math.max(maxX, site.x); maxY = Math.max(maxY, site.y);
    }
    this.minX = Number.isFinite(minX) ? minX : 0;
    this.minY = Number.isFinite(minY) ? minY : 0;
    const width = Math.max(0, maxX - this.minX), height = Math.max(0, maxY - this.minY);
    this.spacing = Math.max(Number.isFinite(spacing) && spacing > 0 ? spacing : 1,
      width / 4096, height / 4096);
    this.columns = Math.max(1, Math.floor(width / this.spacing) + 1);
    this.rows = Math.max(1, Math.floor(height / this.spacing) + 1);
    this.buckets = new Array(this.columns * this.rows);
    for (let i = 0; i < sites.length; i++) this.add(i);
  }

  /** Median nearest-neighbour spacing, measured through a provisional bucket grid. */
  static fromSites(sites: readonly GridSite[]): SiteGrid {
    if (sites.length < 2) return new SiteGrid(sites, 1);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const site of sites) {
      minX = Math.min(minX, site.x); minY = Math.min(minY, site.y);
      maxX = Math.max(maxX, site.x); maxY = Math.max(maxY, site.y);
    }
    const width = maxX - minX, height = maxY - minY;
    const guess = Math.sqrt(width * height / sites.length) || Math.max(width, height) / sites.length || 1;
    const provisional = new SiteGrid(sites, guess);
    const distances = sites.map(site => provisional.nearestFour(site.x, site.y).f2)
      .filter(distance => Number.isFinite(distance) && distance > 0).sort((a, b) => a - b);
    return new SiteGrid(sites, distances[Math.floor(distances.length / 2)] ?? guess);
  }

  private column(x: number): number {
    return Math.max(0, Math.min(this.columns - 1, Math.floor((x - this.minX) / this.spacing)));
  }

  private row(y: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.minY) / this.spacing)));
  }

  add(index: number): void {
    const site = this.sites[index];
    const key = this.row(site.y) * this.columns + this.column(site.x);
    (this.buckets[key] ??= []).push(index);
  }

  move(index: number, x: number, y: number): void {
    const site = this.sites[index];
    const bucket = this.buckets[this.row(site.y) * this.columns + this.column(site.x)];
    if (!bucket) throw new Error("Moving an unindexed site");
    const position = bucket.indexOf(index);
    if (position < 0) throw new Error("Moving an unindexed site");
    bucket.splice(position, 1);
    site.x = x; site.y = y;
    this.add(index);
  }

  hasWithin(x: number, y: number, radius: number, exclude = -1): boolean {
    const radius2 = radius * radius;
    const x0 = this.column(x - radius), x1 = this.column(x + radius);
    const y0 = this.row(y - radius), y1 = this.row(y + radius);
    for (let j = y0; j <= y1; j++) for (let i = x0; i <= x1; i++) {
      for (const index of this.buckets[j * this.columns + i] ?? []) {
        if (index === exclude) continue;
        const dx = this.sites[index].x - x, dy = this.sites[index].y - y;
        if (dx * dx + dy * dy < radius2) return true;
      }
    }
    return false;
  }

  nearestOwner(x: number, y: number): number {
    return this.query(x, y, 1, 0, 1, true).idx;
  }

  nearestFour(x: number, y: number, cosA = 1, sinA = 0, scale = 1): NearestFour {
    return this.query(x, y, cosA, sinA, scale, false);
  }

  private query(x: number, y: number, cosA: number, sinA: number, scale: number, squared: boolean): NearestFour {
    let f1 = Infinity, f2 = Infinity, f3 = Infinity, f4 = Infinity;
    let idx = 0, idx2 = -1, idx3 = -1, idx4 = -1;
    const isotropic = scale <= 1.0001;
    const cx = this.column(x), cy = this.row(y);
    const visit = (column: number, row: number): void => {
      for (const index of this.buckets[row * this.columns + column] ?? []) {
        const dx = x - this.sites[index].x, dy = y - this.sites[index].y;
        const distance = squared ? dx * dx + dy * dy : isotropic ? Math.hypot(dx, dy)
          : Math.hypot((dx * cosA + dy * sinA) * scale, -dx * sinA + dy * cosA);
        if (distance < f1 || (distance === f1 && index < idx)) {
          f4 = f3; idx4 = idx3; f3 = f2; idx3 = idx2; f2 = f1; idx2 = idx; f1 = distance; idx = index;
        } else if (distance < f2 || (distance === f2 && index < idx2)) {
          f4 = f3; idx4 = idx3; f3 = f2; idx3 = idx2; f2 = distance; idx2 = index;
        } else if (distance < f3 || (distance === f3 && index < idx3)) {
          f4 = f3; idx4 = idx3; f3 = distance; idx3 = index;
        } else if (distance < f4 || (distance === f4 && index < idx4)) {
          f4 = distance; idx4 = index;
        }
      }
    };
    for (let ring = 0; ; ring++) {
      const left = Math.max(0, cx - ring), right = Math.min(this.columns - 1, cx + ring);
      const bottom = Math.max(0, cy - ring), top = Math.min(this.rows - 1, cy + ring);
      if (ring === 0) visit(cx, cy);
      else {
        if (cy - ring >= 0) for (let i = left; i <= right; i++) visit(i, cy - ring);
        if (cy + ring < this.rows) for (let i = left; i <= right; i++) visit(i, cy + ring);
        const y0 = Math.max(0, cy - ring + 1), y1 = Math.min(this.rows - 1, cy + ring - 1);
        if (cx - ring >= 0) for (let j = y0; j <= y1; j++) visit(cx - ring, j);
        if (cx + ring < this.columns) for (let j = y0; j <= y1; j++) visit(cx + ring, j);
      }
      if (left === 0 && right === this.columns - 1 && bottom === 0 && top === this.rows - 1) break;
      // Scale >= 1 makes Euclidean distance a lower bound on the metric distance.
      // Strict inequality retains equal-distance lower-index sites in unvisited buckets.
      let outside = Infinity;
      if (left > 0) outside = Math.min(outside, x - (this.minX + left * this.spacing));
      if (right < this.columns - 1) outside = Math.min(outside, this.minX + (right + 1) * this.spacing - x);
      if (bottom > 0) outside = Math.min(outside, y - (this.minY + bottom * this.spacing));
      if (top < this.rows - 1) outside = Math.min(outside, this.minY + (top + 1) * this.spacing - y);
      const bound = squared && outside >= 0 ? outside * outside : outside;
      if (bound > f4 + 16 * Number.EPSILON * Math.max(1, Math.abs(x), Math.abs(y), f4)) break;
    }
    if (!Number.isFinite(f2)) idx2 = -1;
    if (!Number.isFinite(f3)) idx3 = -1;
    if (!Number.isFinite(f4)) idx4 = -1;
    return { f1, f2, f3, f4, idx, idx2, idx3, idx4 };
  }
}
