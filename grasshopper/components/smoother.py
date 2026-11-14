# GHPython component script: MeshCraft | Smooth
# Runtime: IronPython 2.7 (Rhino 7)
# Inputs: pts (list of Point3d), cols, rows, smooth_radius_in (Gaussian sigma, inches)
# Outputs: pts (list of Point3d)
import math
import Rhino.Geometry as rg

def _transform(real, imag, inverse, cosine, sine):
    n = len(real)
    j = 0
    for i in range(1, n):
        bit = n // 2
        while j & bit:
            j ^= bit
            bit //= 2
        j ^= bit
        if i < j:
            real[i], real[j] = real[j], real[i]
            imag[i], imag[j] = imag[j], imag[i]
    length = 2
    while length <= n:
        half = length // 2
        stride = n // length
        for start in range(0, n, length):
            for j in range(half):
                k = j * stride
                c = cosine[k]
                s = sine[k] if inverse else -sine[k]
                a = start + j
                b = a + half
                re = real[b] * c - imag[b] * s
                im = real[b] * s + imag[b] * c
                real[b], imag[b] = real[a] - re, imag[a] - im
                real[a] += re
                imag[a] += im
        length *= 2
    if inverse:
        for i in range(n):
            real[i] /= n
            imag[i] /= n


def _gaussian_fft_pass(values, rows, cols, weights, horizontal):
    # Zero padding preserves linear convolution. A symmetric kernel has a real
    # spectrum, so two independent lanes fit in one complex transform.
    axis, lanes = (cols, rows) if horizontal else (rows, cols)
    radius = len(weights) - 1
    n = 1
    while n < axis + radius:
        n *= 2
    cosine = [math.cos(2.0 * math.pi * k / n) for k in range(n // 2)]
    sine = [math.sin(2.0 * math.pi * k / n) for k in range(n // 2)]
    real, imag = [0.0] * n, [0.0] * n
    real[0] = weights[0]
    for k in range(1, radius + 1):
        real[k] = real[n - k] = weights[k]
    _transform(real, imag, False, cosine, sine)
    spectrum = real[:]
    prefix = [0.0] * len(weights)
    for k in range(1, radius + 1):
        prefix[k] = prefix[k - 1] + weights[k]
    norm = []
    for i in range(axis):
        total = weights[0] + prefix[min(i, radius)] + prefix[min(axis - 1 - i, radius)]
        if i <= radius: total -= weights[i] * 0.5
        if axis - 1 - i <= radius: total -= weights[axis - 1 - i] * 0.5
        norm.append(total)
    out = [0.0] * len(values)
    for lane in range(0, lanes, 2):
        real, imag = [0.0] * n, [0.0] * n
        for i in range(axis):
            edge = 0.5 if i == 0 or i == axis - 1 else 1.0
            real[i] = values[lane * cols + i if horizontal else i * cols + lane] * edge
            if lane + 1 < lanes:
                imag[i] = values[(lane + 1) * cols + i if horizontal else i * cols + lane + 1] * edge
        _transform(real, imag, False, cosine, sine)
        for i in range(n):
            real[i] *= spectrum[i]
            imag[i] *= spectrum[i]
        _transform(real, imag, True, cosine, sine)
        for i in range(axis):
            out[lane * cols + i if horizontal else i * cols + lane] = real[i] / norm[i]
            if lane + 1 < lanes:
                out[(lane + 1) * cols + i if horizontal else i * cols + lane + 1] = imag[i] / norm[i]
    return out

if smooth_radius_in is None: smooth_radius_in = 0.0
sigma = float(smooth_radius_in)
cols_i = int(cols)
rows_i = int(rows)
pts = list(pts)
if sigma > 0.0 and any(p.Z != pts[0].Z for p in pts):
    xs = [p.X for p in pts]
    ys = [p.Y for p in pts]
    zv = [p.Z for p in pts]
    pitches = [abs(xs[1] - xs[0]), abs(ys[cols_i] - ys[0])]
    for axis in range(2):
        size = cols_i if axis == 0 else rows_i
        pitch = pitches[axis]
        radius = min(size - 1, int(math.ceil(3.0 * sigma / pitch)))
        weights = [math.exp(-0.5 * (i * pitch / sigma) ** 2) for i in range(radius + 1)]
        if len(weights) > 32:
            zv = _gaussian_fft_pass(zv, rows_i, cols_i, weights, axis == 0)
            continue
        out = [0.0] * len(zv)
        for j in range(rows_i):
            for i in range(cols_i):
                total = 0.0
                weighted = 0.0
                for d in range(-radius, radius + 1):
                    x = i + d if axis == 0 else i
                    y = j if axis == 0 else j + d
                    if x < 0 or x >= cols_i or y < 0 or y >= rows_i:
                        continue
                    # Half-weight physical panel endpoints before kernel renormalization.
                    index = x if axis == 0 else y
                    w = weights[abs(d)] * (0.5 if index == 0 or index == size - 1 else 1.0)
                    weighted += zv[y * cols_i + x] * w
                    total += w
                out[j * cols_i + i] = weighted / total
        zv = out
    pts = [rg.Point3d(xs[k], ys[k], zv[k]) for k in range(len(zv))]
