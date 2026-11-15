#! python 2
# -*- coding: utf-8 -*-
# Original full scans at a57b0fa. Independent regression oracles.

class FullScanNoise(VoronoiReliefNoise):
    def _gen_sites(self, p, density_gen, exclusion_foci, exclusion_r, suppress_gen):
        # v16: sites live on the unwarped jittered grid and are NEVER displaced — cell flow
        # comes entirely from warping the query points (see _make_warp). Density is modulated
        # by the attractor mask and a low-frequency noise field (giant-vs-small patches).
        spacing = max(0.2, p['cell_size'])
        nx = max(2, int(math.ceil(p['mesh_x'] / spacing)) + 1)
        ny = max(2, int(math.ceil(p['mesh_y'] / spacing)) + 1)
        sx = p['mesh_x'] / nx; sy = p['mesh_y'] / ny
        dn_amt = max(0.0, min(1.5, p.get('density_noise', 0.0)))
        dn_freq = max(0.02, min(0.3, p.get('density_noise_freq', 0.08)))
        # v19 giant merged cells: the SAME low-frequency field that melts depth in the
        # height pass (seed offset +103, freq 0.16/cell_size) deletes sites here — several
        # neighboring cells merge into one giant territory whose surviving perimeter walls
        # read as long sweeping creases across the calm zone.
        dv_amt = max(0.0, min(1.0, p.get('depth_variation', 0.0)))
        suppress_freq_sites = 0.16 / max(0.2, p['cell_size'])
        killed_reserve = []
        sites = []
        # Hard caps prevent O(rows*cols*sites) blowup from crafted params or unwired density attractors.
        for j in range(ny):
            for i in range(nx):
                cx = (i + 0.5) * sx; cy = (j + 0.5) * sy
                u = cx / p['mesh_x']; v = cy / p['mesh_y']
                mask = self._attractor_mask(p['attractor_mode'], u, v,
                    p['attractor_x'], p['attractor_y'],
                    p['attractor_radius'], p['attractor_falloff'])
                if suppress_gen is not None and dv_amt > 0.0:
                    sn01 = (suppress_gen.noise(cx * suppress_freq_sites, cy * suppress_freq_sites) + 1.0) * 0.5
                    kill = self._smoothstep(0.66, 0.8, sn01) * self.SUPPRESSION_KILL * dv_amt
                    if kill > 0.0 and self._rand() < kill:
                        if len(killed_reserve) < 8:
                            killed_reserve.append([cx, cy])
                        continue
                local = max(0.0, min(self.LOCAL_DENSITY_MAX, 1.0 + p['density_strength'] * mask))
                if density_gen is not None and dn_amt > 0.0:
                    n = density_gen.noise(cx * dn_freq, cy * dn_freq)
                    local *= max(0.1, min(self.LOCAL_DENSITY_MAX, 1.0 + dn_amt * n * self.DENSITY_NOISE_GAIN))
                    # v17 heavy-tail spikes: abrupt scale jumps beside calm masses.
                    spike = self._rand()
                    if spike < 0.03 * dn_amt: local *= 3.0
                    elif spike < 0.08 * dn_amt: local *= 0.12
                local = min(self.LOCAL_DENSITY_MAX, max(0.1, local))
                reps = int(math.floor(local))
                if self._rand() < (local - math.floor(local)):
                    reps += 1
                for _ in range(reps):
                    jx = (self._rand() - 0.5) * p['jitter'] * sx
                    jy = (self._rand() - 0.5) * p['jitter'] * sy
                    px = max(0.0, min(p['mesh_x'], cx + jx))
                    py = max(0.0, min(p['mesh_y'], cy + jy))
                    # v21.1 minimum separation: jittered reps can land two sites arbitrarily
                    # close, producing sliver cells narrower than any cuttable feature.
                    min_sep2 = (0.35 * spacing) * (0.35 * spacing)
                    too_close = False
                    for sq in sites:
                        ddx = sq[0] - px
                        ddy = sq[1] - py
                        if ddx * ddx + ddy * ddy < min_sep2:
                            too_close = True
                            break
                    if too_close:
                        continue
                    # v16.2: polar lattices own the focal zones — Cartesian sites inside
                    # an exclusion disc would shred the petal structure.
                    if exclusion_r > 0.0:
                        excluded = False
                        for f in range(len(exclusion_foci)):
                            dx = px - exclusion_foci[f][0]
                            dy = py - exclusion_foci[f][1]
                            if dx * dx + dy * dy < exclusion_r * exclusion_r:
                                excluded = True
                                break
                        if excluded:
                            continue
                    sites.append([px, py, 0.0])
        # Minimum-site floor: deletion is independent per candidate, so a small grid
        # inside a strong suppression field can wipe out EVERY site — restore deleted
        # cell centers (deterministic order) so the panel degrades to giant merged
        # cells, never to the flat zero-site fallback. Reserve centers were captured
        # BEFORE the focal exclusion check — revalidate so a restored site can't land
        # inside a polar-owned disc and shred the petal lattice.
        ri = 0
        while len(sites) < 3 and ri < len(killed_reserve):
            rx = killed_reserve[ri][0]; ry = killed_reserve[ri][1]
            ri += 1
            if exclusion_r > 0:
                excluded = False
                for f in range(len(exclusion_foci)):
                    dx = rx - exclusion_foci[f][0]
                    dy = ry - exclusion_foci[f][1]
                    if dx * dx + dy * dy < exclusion_r * exclusion_r:
                        excluded = True
                        break
                if excluded:
                    continue
            sites.append([rx, ry, 0.0])
        return sites

    def _lloyd_relax(self, sites, p, samples, warp_fn, pinned_from):
        # One Lloyd pass — move each site toward the centroid of its assigned low-discrepancy
        # samples. Samples are warped through W so relaxation happens in the same space the
        # distance queries use.
        n = len(sites)
        sumX = [0.0] * n; sumY = [0.0] * n; counts = [0] * n
        for s in range(samples):
            x = self._halton(s + 1, 2) * p['mesh_x']
            y = self._halton(s + 1, 3) * p['mesh_y']
            if warp_fn is not None:
                x, y = warp_fn(x, y)
            best_idx = 0; best_d = float('inf')
            for i in range(n):
                dx = sites[i][0] - x; dy = sites[i][1] - y
                d = dx * dx + dy * dy
                if d < best_d:
                    best_d = d; best_idx = i
            sumX[best_idx] += x; sumY[best_idx] += y; counts[best_idx] += 1
        move_limit = min(n, max(0, pinned_from))
        min_sep2 = 0.3 * 0.3
        for i in range(move_limit):
            if counts[i] > 0:
                # Warped centroids can land slightly outside the physical panel at high
                # distortion — clamp so edge sites cannot drift off-panel and starve
                # boundary cells.
                nx = max(0.0, min(p['mesh_x'], sumX[i] / counts[i]))
                ny = max(0.0, min(p['mesh_y'], sumY[i] / counts[i]))
                # Relaxation must not defeat the minimum separation — reject moves that
                # would land within the feature floor of any other site.
                ok = True
                for q in range(n):
                    if q == i:
                        continue
                    ddx = sites[q][0] - nx
                    ddy = sites[q][1] - ny
                    if ddx * ddx + ddy * ddy < min_sep2:
                        ok = False
                        break
                if ok:
                    sites[i][0] = nx
                    sites[i][1] = ny

def native_full_scan(pts):
    # Halton-sample centroid pass (mirrors the web sampler's lloydRelax) --
    # keeps relaxation working when ghcomp.Voronoi is unavailable.
    n = len(pts)
    if n == 0:
        return pts
    samples = n * 64
    sum_x = [0.0] * n
    sum_y = [0.0] * n
    counts = [0] * n
    for si in xrange(samples):
        x = _halton(si + 1, 2) * mesh_x
        y = _halton(si + 1, 3) * mesh_y
        best = 0
        best_d = 1.0e30
        for i in xrange(n):
            dx = pts[i].X - x
            dy = pts[i].Y - y
            d = dx * dx + dy * dy
            if d < best_d:
                best_d = d
                best = i
        sum_x[best] += x
        sum_y[best] += y
        counts[best] += 1
    out = []
    for i in xrange(n):
        if counts[i] > 0:
            out.append(rg.Point3d(sum_x[i] / counts[i], sum_y[i] / counts[i], 0.0))
        else:
            out.append(pts[i])
    return out
