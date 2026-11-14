#! python 2
# -*- coding: utf-8 -*-
# Exact ordered-site queries. Embedded in standalone components for GhPython paste/open.
import math


class _SiteGrid(object):
    # Squared differences stay finite within this supported coordinate range.
    MAX_COORDINATE = 1e150
    EPSILON = 2.220446049250313e-16

    def __init__(self, sites, spacing, bounds=None):
        self.sites = sites
        if bounds is None:
            if sites:
                xs = [p[0] for p in sites]
                ys = [p[1] for p in sites]
                bounds = (min(xs), min(ys), max(xs), max(ys))
            else:
                bounds = (0.0, 0.0, 0.0, 0.0)
        if any(v != v or abs(v) > self.MAX_COORDINATE for v in bounds) or spacing != spacing or spacing <= 0 or spacing == float('inf'):
            raise ValueError('Site index bounds or spacing exceed supported numeric range')
        self.min_x, self.min_y, self.max_x, self.max_y = bounds
        self.coordinate_scale = max([1.0] + [abs(v) for v in bounds])
        width = self.max_x - self.min_x
        height = self.max_y - self.min_y
        if width < 0 or height < 0:
            raise ValueError('Site index bounds are reversed')
        self.spacing = max(spacing, width / 4096.0, height / 4096.0)
        self.columns = max(1, int(math.floor(width / self.spacing)) + 1)
        self.rows = max(1, int(math.floor(height / self.spacing)) + 1)
        self.buckets = {}
        for i in range(len(sites)):
            self.add(i)

    @classmethod
    def from_sites(cls, sites, bounds=None):
        if not sites:
            return cls(sites, 1.0)
        xs = [p[0] for p in sites]
        ys = [p[1] for p in sites]
        measured = (min(xs), min(ys), max(xs), max(ys))
        bounds = bounds if bounds is not None else measured
        width = measured[2] - measured[0]
        height = measured[3] - measured[1]
        spacing = math.sqrt(width) * math.sqrt(height) / math.sqrt(len(sites))
        if spacing <= 0:
            spacing = max(width, height) / len(sites) or 1.0
        return cls(sites, spacing, bounds)

    def _column(self, x):
        return max(0, min(self.columns - 1, int(math.floor((x - self.min_x) / self.spacing))))

    def _row(self, y):
        return max(0, min(self.rows - 1, int(math.floor((y - self.min_y) / self.spacing))))

    def add(self, index):
        p = self.sites[index]
        if any(v != v or abs(v) > self.MAX_COORDINATE for v in p[:2]):
            raise ValueError('Site coordinates exceed supported numeric range')
        if not (self.min_x <= p[0] <= self.max_x and self.min_y <= p[1] <= self.max_y):
            raise ValueError('Site lies outside index bounds')
        key = (self._column(p[0]), self._row(p[1]))
        self.buckets.setdefault(key, []).append(index)

    def move(self, index, x, y):
        if not (self.min_x <= x <= self.max_x and self.min_y <= y <= self.max_y):
            raise ValueError('Site move lies outside index bounds')
        p = self.sites[index]
        self.buckets[(self._column(p[0]), self._row(p[1]))].remove(index)
        p[0] = x
        p[1] = y
        self.add(index)

    def has_within(self, x, y, radius, exclude=-1):
        if any(v != v or abs(v) > self.MAX_COORDINATE for v in [x, y, radius]) or radius < 0:
            raise ValueError('Site query coordinates or radius exceed supported numeric range')
        if not self.sites:
            return False
        radius2 = radius * radius
        margin = 16 * self.EPSILON * max(self.coordinate_scale, abs(x), abs(y), radius)
        for j in range(self._row(y - radius - margin), self._row(y + radius + margin) + 1):
            for i in range(self._column(x - radius - margin), self._column(x + radius + margin) + 1):
                for index in self.buckets.get((i, j), ()):
                    if index == exclude:
                        continue
                    dx = self.sites[index][0] - x
                    dy = self.sites[index][1] - y
                    if dx * dx + dy * dy < radius2:
                        return True
        return False

    def nearest(self, x, y, distance_limit=float('inf')):
        if x != x or y != y or abs(x) > self.MAX_COORDINATE or abs(y) > self.MAX_COORDINATE:
            raise ValueError('Site query coordinates exceed supported numeric range')
        if distance_limit != distance_limit or distance_limit < 0:
            raise ValueError('Site index distance limit must be nonnegative')
        if not self.sites:
            return 0
        cx = self._column(x)
        cy = self._row(y)
        best = 0
        best_d = distance_limit
        # Distance to the occupied bounds on the perpendicular axis strengthens the bound
        # for collinear populations and warped queries outside the board.
        dx_bounds = max(0.0, self.min_x - x, x - self.max_x)
        dy_bounds = max(0.0, self.min_y - y, y - self.max_y)
        ring = 0
        while ring < max(self.columns, self.rows):
            left = max(0, cx - ring)
            right = min(self.columns - 1, cx + ring)
            bottom = max(0, cy - ring)
            top = min(self.rows - 1, cy + ring)
            keys = []
            if ring == 0:
                keys.append((cx, cy))
            else:
                if cy - ring >= 0:
                    keys.extend((i, cy - ring) for i in range(left, right + 1))
                if cy + ring < self.rows:
                    keys.extend((i, cy + ring) for i in range(left, right + 1))
                y0 = max(0, cy - ring + 1)
                y1 = min(self.rows - 1, cy + ring - 1)
                if cx - ring >= 0:
                    keys.extend((cx - ring, j) for j in range(y0, y1 + 1))
                if cx + ring < self.columns:
                    keys.extend((cx + ring, j) for j in range(y0, y1 + 1))
            for key in keys:
                for index in self.buckets.get(key, ()):
                    dx = self.sites[index][0] - x
                    dy = self.sites[index][1] - y
                    d = dx * dx + dy * dy
                    if d < best_d or (d == best_d and index < best):
                        best_d = d
                        best = index
            if left == 0 and right == self.columns - 1 and bottom == 0 and top == self.rows - 1:
                return best
            bounds = []
            if left > 0:
                bounds.append(max(0.0, x - (self.min_x + left * self.spacing)) ** 2 + dy_bounds * dy_bounds)
            if right < self.columns - 1:
                bounds.append(max(0.0, self.min_x + (right + 1) * self.spacing - x) ** 2 + dy_bounds * dy_bounds)
            if bottom > 0:
                bounds.append(max(0.0, y - (self.min_y + bottom * self.spacing)) ** 2 + dx_bounds * dx_bounds)
            if top < self.rows - 1:
                bounds.append(max(0.0, self.min_y + (top + 1) * self.spacing - y) ** 2 + dx_bounds * dx_bounds)
            # Strict inequality includes lower-index sites tied in an unvisited bucket.
            error = 16 * self.EPSILON * max(self.coordinate_scale, abs(x), abs(y))
            tolerance = error * (2 * math.sqrt(best_d) + error) + 16 * self.EPSILON * max(1.0, best_d)
            if min(bounds) > best_d + tolerance:
                return best
            ring += 1
        return best
