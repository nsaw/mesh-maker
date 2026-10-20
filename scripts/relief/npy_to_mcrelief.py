"""Package a float heightfield (.npy) as a MeshCraft relief master (.mcrelief).

The format is defined in src/relief-master.ts. Heights are stored bit-for-bit as given (float32 or
float64, no rescaling), so the .mcrelief decodes to exactly the source array.

  python3 scripts/relief/npy_to_mcrelief.py HEIGHTS.npy OUT.mcrelief \
      --units m --width 0.3048 --height 0.6096 --backing 0.003175 --stock 0.01905 \
      --row-order top-down --triangulation tr-bl [--mask MASK.npy] [--name ...] [--source ...] [--license ...]

`--width/--height` are node-to-node extents (first to last column / row), in --units, as are the
heights, backing and stock. Requires only NumPy.
"""
import argparse, hashlib, json, struct
import numpy as np

a = argparse.ArgumentParser()
a.add_argument('heights'); a.add_argument('out')
a.add_argument('--units', choices=['in', 'mm', 'm'], required=True)
a.add_argument('--width', type=float, required=True); a.add_argument('--height', type=float, required=True)
a.add_argument('--backing', type=float, required=True); a.add_argument('--stock', type=float, required=True)
a.add_argument('--row-order', choices=['top-down', 'bottom-up'], required=True)
a.add_argument('--triangulation', choices=['tr-bl', 'tl-br'], required=True)
a.add_argument('--mask'); a.add_argument('--name'); a.add_argument('--source'); a.add_argument('--license')
A = a.parse_args()

h = np.load(A.heights)
if h.ndim != 2 or h.dtype not in (np.float32, np.float64):
    raise SystemExit(f'heights must be a 2-D float32/float64 array, got {h.dtype} {h.shape}')
if not np.isfinite(h).all():
    raise SystemExit('heights contain NaN/Inf: fill the background with the backing height first')
rows, cols = h.shape
data = np.ascontiguousarray(h.astype(h.dtype.newbyteorder('<'))).tobytes()
mask = None
if A.mask:
    m = np.load(A.mask)
    if m.shape != h.shape:
        raise SystemExit('mask shape differs from heights')
    mask = np.ascontiguousarray(m != 0).astype(np.uint8).tobytes()  # any nonzero value is foreground

header = {
    'format': 'meshcraft-relief', 'version': 1, 'units': A.units, 'cols': cols, 'rows': rows,
    'width': A.width, 'height': A.height, 'dtype': 'float32' if h.dtype == np.float32 else 'float64',
    'rowOrder': A.row_order, 'heightOrigin': 'panel-back', 'backing': A.backing, 'stock': A.stock,
    'triangulation': A.triangulation, 'mask': mask is not None,
    'sha256': {'heights': hashlib.sha256(data).hexdigest(), **({'mask': hashlib.sha256(mask).hexdigest()} if mask else {})},
}
for k in ('name', 'source', 'license'):
    if getattr(A, k):
        header[k] = getattr(A, k)
hj = json.dumps(header, separators=(',', ':')).encode('utf-8')
start = -(-(12 + len(hj)) // 8) * 8
with open(A.out, 'wb') as f:
    f.write(b'MCRELIEF' + struct.pack('<I', len(hj)) + hj + b'\0' * (start - 12 - len(hj)) + data + (mask or b''))
print(json.dumps({'out': A.out, 'cols': cols, 'rows': rows, 'sha256_heights': header['sha256']['heights']}))
