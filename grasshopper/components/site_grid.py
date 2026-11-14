#! python 2
# -*- coding: utf-8 -*-
# Exact ordered-site queries. Embedded in standalone components for GhPython paste/open.
import math


class _SiteGrid(object):
    # Squared differences stay finite within this supported coordinate range.
    MAX_COORDINATE = 1e150
    EPSILON = 2.220446049250313e-16

    @staticmethod
    def _dyadic(value):
        if value != value or abs(value) == float('inf'):
            raise ValueError('Metric comparison requires finite coordinates')
        if value == 0.0:
            return (0, 0)
        mantissa, exponent = math.frexp(value)
        return (int(math.ldexp(mantissa, 53)), exponent - 53)

    @staticmethod
    def _dyadic_add(a, b):
        exponent = min(a[1], b[1])
        return ((a[0] << (a[1] - exponent)) + (b[0] << (b[1] - exponent)), exponent)

    @staticmethod
    def _dyadic_sub(a, b):
        return _SiteGrid._dyadic_add(a, (-b[0], b[1]))

    @staticmethod
    def _dyadic_mul(a, b):
        return (a[0] * b[0], a[1] + b[1])

    @staticmethod
    def exact_metric_order(a, b, x, y, c=1.0, s=0.0, scale=1.0):
        if a[0] == b[0] and a[1] == b[1]:
            return 0
        dyadic = _SiteGrid._dyadic
        add = _SiteGrid._dyadic_add
        sub = _SiteGrid._dyadic_sub
        mul = _SiteGrid._dyadic_mul
        ax, ay = dyadic(a[0]), dyadic(a[1])
        ux, uy = sub(dyadic(b[0]), ax), sub(dyadic(b[1]), ay)
        vx = sub(mul((2, 0), sub(dyadic(x), ax)), ux)
        vy = sub(mul((2, 0), sub(dyadic(y), ay)), uy)
        if scale > 1.0001:
            dc, ds, dk = dyadic(c), dyadic(s), dyadic(scale)
            def transform(px, py):
                return mul(add(mul(px, dc), mul(py, ds)), dk), sub(mul(py, dc), mul(px, ds))
            u, v = transform(ux, uy), transform(vx, vy)
        else:
            u, v = (ux, uy), (vx, vy)
        sign = add(mul(u[0], v[0]), mul(u[1], v[1]))[0]
        return -1 if sign < 0 else 1 if sign > 0 else 0

    @staticmethod
    def ordering(sites, x, y, cos_a=1.0, sin_a=0.0, scale=1.0, squared=False, coordinate_scale=None):
        if coordinate_scale is None:
            coordinate_scale = max([1.0] + [abs(v) for p in sites for v in p[:2]])
        factor = 1.0 if scale <= 1.0001 else max(1.0, abs(cos_a) + abs(sin_a)) * max(1.0, abs(scale))
        magnitude = max(1.0, coordinate_scale, abs(x), abs(y)) * factor
        error = 256 * _SiteGrid.EPSILON * magnitude
        def precedes(index, current, distance, current_distance):
            if current < 0 or current_distance == float('inf'):
                return True
            difference = distance - current_distance
            guard = error * (2 * max(1.0, distance, current_distance) + error) if squared else error
            if difference < -guard:
                return True
            if difference > guard:
                return False
            order = _SiteGrid.exact_metric_order(sites[index], sites[current], x, y, cos_a, sin_a, scale)
            return order < 0 or (order == 0 and index < current)
        return precedes

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
        self.coordinate_scale = max(self.coordinate_scale, abs(x), abs(y))
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

    def within_radius(self, x, y, radius, cos_a=1.0, sin_a=0.0, scale=1.0):
        if radius != radius or radius < 0 or radius > self.MAX_COORDINATE:
            raise ValueError('Site radius exceeds supported numeric range')
        result = []
        margin = 16 * self.EPSILON * max(self.coordinate_scale, abs(x), abs(y), radius)
        isotropic = scale <= 1.0001
        for j in range(self._row(y - radius - margin), self._row(y + radius + margin) + 1):
            for i in range(self._column(x - radius - margin), self._column(x + radius + margin) + 1):
                for index in self.buckets.get((i, j), ()):
                    dx = x - self.sites[index][0]
                    dy = y - self.sites[index][1]
                    xr = dx * cos_a + dy * sin_a
                    yr = -dx * sin_a + dy * cos_a
                    d = math.sqrt(dx * dx + dy * dy) if isotropic else math.sqrt((xr * scale) ** 2 + yr * yr)
                    if d < radius:
                        result.append((index, d))
        return sorted(result, key=lambda item: item[0])

    def bisector_distance(self, x, y, owner, index, cos_a=1.0, sin_a=0.0, scale=1.0):
        dx = self.sites[index][0] - self.sites[owner][0]
        dy = self.sites[index][1] - self.sites[owner][1]
        qx = x - self.sites[owner][0]; qy = y - self.sites[owner][1]
        if scale > 1.0001:
            sx = (dx * cos_a + dy * sin_a) * scale
            dy = -dx * sin_a + dy * cos_a; dx = sx
            tx = (qx * cos_a + qy * sin_a) * scale
            qy = -qx * sin_a + qy * cos_a; qx = tx
        separation = math.hypot(dx, dy)
        if separation == 0.0:
            return float('inf')  # Coincident IDs retain field weights, but define no plane.
        return max(0.0, separation / 2.0 - qx * (dx / separation) - qy * (dy / separation))

    def boundary_distance(self, x, y, owner, nearest, bound, cos_a=1.0, sin_a=0.0, scale=1.0):
        return self.boundary_neighborhood(x, y, owner, nearest, bound, cos_a, sin_a, scale)[0]

    def boundary_neighborhood(self, x, y, owner, nearest, bound, cos_a=1.0, sin_a=0.0, scale=1.0, support_radius=0.0):
        margin = 64 * self.EPSILON * max(self.coordinate_scale, abs(x), abs(y), nearest, bound) * max(1.0, scale)
        candidates = self.within_radius(x, y, max(support_radius, nearest + 2 * bound + margin), cos_a, sin_a, scale)
        for index, distance in candidates:
            if index == owner:
                continue
            plane = self.bisector_distance(x, y, owner, index, cos_a, sin_a, scale)
            bound = min(bound, plane)
        return bound, candidates

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
        have_owner = False
        precedes = self.ordering(self.sites, x, y, squared=True, coordinate_scale=self.coordinate_scale)
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
                    # The optional cap admits candidates by the legacy strict Float
                    # predicate. Exact ranking applies only after this eligibility test.
                    if not d < distance_limit:
                        continue
                    if not have_owner:
                        best_d = d
                        best = index
                        have_owner = True
                    elif precedes(index, best, d, best_d):
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
