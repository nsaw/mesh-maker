// MeshCraft | Voronoi Relief (native) height pass, compiled.
// A line-for-line port of the height-field pass in mesh-maker's
// grasshopper/components/voronoi_relief_native.py (the v24 lattice membrane; see Version): per-cell
// inradius and depth multipliers, the per-pixel node (exact four-nearest ordering with the
// same dyadic near-tie rule), the physical-lattice pillow membrane solved cell by cell, and
// the [0, 1] renormalization. Site generation and Lloyd relaxation stay in the component.
// Every expression keeps the Python operation order so results match IronPython bit for bit.
using System;
using System.Collections.Generic;
using System.Numerics;

public static class MeshCraftRelief
{
    const double EPSILON = 2.220446049250313e-16;

    /// <summary>The height-pass revision this build reproduces. voronoi_relief_native.py uses the
    /// DLL only when this equals its own RELIEF_DLL_VERSION, so a stale DLL falls back to Python.</summary>
    public const string Version = "v24-lattice-membrane-07d522836b69";

    // ---- exact metric ordering (isotropic, squared distances) ----
    struct Dyadic { public BigInteger M; public int E; public Dyadic(BigInteger m, int e) { M = m; E = e; } }

    static Dyadic ToDyadic(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value)) throw new ArgumentException("Metric comparison requires finite coordinates");
        if (value == 0.0) return new Dyadic(BigInteger.Zero, 0);
        long bits = BitConverter.DoubleToInt64Bits(value);
        bool negative = bits < 0;
        int exponent = (int)((bits >> 52) & 0x7FF);
        long mantissa = bits & 0xFFFFFFFFFFFFFL;
        if (exponent == 0) exponent = 1; else mantissa |= 1L << 52;
        BigInteger m = new BigInteger(negative ? -mantissa : mantissa);
        return new Dyadic(m, exponent - 1075);
    }
    static Dyadic Add(Dyadic a, Dyadic b)
    {
        int e = Math.Min(a.E, b.E);
        return new Dyadic((a.M << (a.E - e)) + (b.M << (b.E - e)), e);
    }
    static Dyadic Sub(Dyadic a, Dyadic b) { return Add(a, new Dyadic(-b.M, b.E)); }
    static Dyadic Mul(Dyadic a, Dyadic b) { return new Dyadic(a.M * b.M, a.E + b.E); }

    static int ExactOrder(double ax0, double ay0, double bx0, double by0, double x, double y)
    {
        if (ax0 == bx0 && ay0 == by0) return 0;
        Dyadic ax = ToDyadic(ax0), ay = ToDyadic(ay0);
        Dyadic ux = Sub(ToDyadic(bx0), ax), uy = Sub(ToDyadic(by0), ay);
        Dyadic two = new Dyadic(new BigInteger(2), 0);
        Dyadic vx = Sub(Mul(two, Sub(ToDyadic(x), ax)), ux);
        Dyadic vy = Sub(Mul(two, Sub(ToDyadic(y), ay)), uy);
        int sign = Add(Mul(ux, vx), Mul(uy, vy)).M.Sign;
        return sign < 0 ? -1 : sign > 0 ? 1 : 0;
    }

    // ---- hashes and value noise (Python int semantics: low 32 bits) ----
    static double VnHash(long ix, long iy, long s)
    {
        ulong h = unchecked((ulong)(ix * 374761393L + iy * 668265263L + s * 1442695041L)) & 0xffffffffUL;
        h = (h ^ (h >> 13)) & 0xffffffffUL;
        h = (h * 1274126177UL) & 0xffffffffUL;
        h = (h ^ (h >> 16)) & 0xffffffffUL;
        return (h / 4294967295.0) * 2.0 - 1.0;
    }
    static double CellHash01(long idx, long s)
    {
        ulong h = unchecked((ulong)((idx + 1) * 374761393L + (long)((ulong)s & 0xffffffffUL) * 668265263L)) & 0xffffffffUL;
        h = ((h ^ (h >> 13)) * 1274126177UL) & 0xffffffffUL;
        return (double)((h ^ (h >> 16)) & 0xffffffffUL) / 4294967296.0;
    }
    static double EdgeHash01(long a, long b, long seed) { return CellHash01(((a + 1) * 7919 + b + 1) & 0x7fffffffL, seed); }
    static double VNoise(double x, double y, long s)
    {
        long ix = (long)Math.Floor(x), iy = (long)Math.Floor(y);
        double fx = x - ix, fy = y - iy;
        double sx = fx * fx * (3.0 - 2.0 * fx);
        double sy = fy * fy * (3.0 - 2.0 * fy);
        double a = VnHash(ix, iy, s), b = VnHash(ix + 1, iy, s), c = VnHash(ix, iy + 1, s), d = VnHash(ix + 1, iy + 1, s);
        return (a * (1.0 - sx) * (1.0 - sy) + b * sx * (1.0 - sy)
                + c * (1.0 - sx) * sy + d * sx * sy);
    }

    sealed class Field
    {
        public double[] Sx, Sy, Inradius, SizeMul;
        public int N;
        public double MeshX, MeshY, CellSize, SeamSharpness, SeamDepth, BaseAmp, BaseFreq, WallWidth;
        public double Pillow, PillowCoverage, DepthVariation, JunctionLift, CrestVariation, MedianInr, CoordinateScale;
        public double WallNoiseFreq, CrestFreq, SuppressFreq;
        public long Seed;
        public string Profile, Polarity;

        double ProfileFn(double t)
        {
            if (t < 0.0) t = 0.0; else if (t > 1.0) t = 1.0;
            double outv;
            if (Profile == "cone") outv = t;
            else if (Profile == "spherical-cap") outv = Math.Sqrt(Math.Max(0.0, 2.0 * t - t * t));
            else if (Profile == "cosine") outv = 0.5 * (1.0 - Math.Cos(Math.PI * t));
            else outv = 2.0 * t - t * t;
            if (SeamSharpness > 0.0 && t < 0.5)
            {
                double k = 2.0 + 6.0 * SeamSharpness;
                double sharp = 1.0 - Math.Pow(1.0 - 2.0 * t, k);
                outv = outv * (1.0 - SeamSharpness) + Math.Max(outv, sharp) * SeamSharpness;
            }
            return outv;
        }

        bool Precedes(int index, int current, double distance, double currentDistance, double px, double py, double error)
        {
            if (current < 0 || double.IsPositiveInfinity(currentDistance)) return true;
            double difference = distance - currentDistance;
            double guard = error * (2 * Math.Max(Math.Max(1.0, distance), currentDistance) + error);
            if (difference < -guard) return true;
            if (difference > guard) return false;
            int order = ExactOrder(Sx[index], Sy[index], Sx[current], Sy[current], px, py);
            return order < 0 || (order == 0 && index < current);
        }

        // One height-field node at physical (px, py): z, cushion chain and owner.
        public double Node(double px, double py, out double cushion, out int owner)
        {
            double best1 = double.PositiveInfinity, best2 = best1, best3 = best1, best4 = best1;
            owner = 0; int owner2 = -1, owner3 = -1, owner4 = -1;
            double magnitude = Math.Max(Math.Max(Math.Max(1.0, CoordinateScale), Math.Abs(px)), Math.Abs(py)) * 1.0;
            double error = 256 * EPSILON * magnitude;
            for (int k = 0; k < N; k++)
            {
                double dx = Sx[k] - px, dy = Sy[k] - py;
                double d2v = dx * dx + dy * dy;
                if (Precedes(k, owner, d2v, best1, px, py, error))
                { best4 = best3; owner4 = owner3; best3 = best2; owner3 = owner2; best2 = best1; owner2 = owner; best1 = d2v; owner = k; }
                else if (Precedes(k, owner2, d2v, best2, px, py, error))
                { best4 = best3; owner4 = owner3; best3 = best2; owner3 = owner2; best2 = d2v; owner2 = k; }
                else if (Precedes(k, owner3, d2v, best3, px, py, error))
                { best4 = best3; owner4 = owner3; best3 = d2v; owner3 = k; }
                else if (Precedes(k, owner4, d2v, best4, px, py, error))
                { best4 = d2v; owner4 = k; }
            }
            if (double.IsInfinity(best2)) owner2 = -1;
            if (double.IsInfinity(best3)) owner3 = -1;
            if (double.IsInfinity(best4)) owner4 = -1;
            double d1 = Math.Sqrt(best1), d3 = Math.Sqrt(best3);
            double dbCap = MeshX + MeshY, db2v = dbCap, db3v = dbCap, db4v = dbCap, dxs, dys;
            if (owner2 >= 0) { dxs = Sx[owner2] - Sx[owner]; dys = Sy[owner2] - Sy[owner]; db2v = (best2 - best1) / (2.0 * Math.Max(1e-9, Math.Sqrt(dxs * dxs + dys * dys))); }
            if (owner3 >= 0) { dxs = Sx[owner3] - Sx[owner]; dys = Sy[owner3] - Sy[owner]; db3v = (best3 - best1) / (2.0 * Math.Max(1e-9, Math.Sqrt(dxs * dxs + dys * dys))); }
            if (owner4 >= 0) { dxs = Sx[owner4] - Sx[owner]; dys = Sy[owner4] - Sy[owner]; db4v = (best4 - best1) / (2.0 * Math.Max(1e-9, Math.Sqrt(dxs * dxs + dys * dys))); }
            double db = Math.Min(Math.Min(db2v, db3v), db4v);
            int nb2 = owner2 >= 0 ? owner2 : owner;
            int nb3 = owner3 >= 0 ? owner3 : nb2;
            double e2Side = EdgeHash01(owner, nb2, Seed + 59);
            double e2Shared = EdgeHash01(Math.Min(owner, nb2), Math.Max(owner, nb2), Seed + 53);
            double e3Side = EdgeHash01(owner, nb3, Seed + 59);
            double e3Shared = EdgeHash01(Math.Min(owner, nb3), Math.Max(owner, nb3), Seed + 53);
            double emr = (db3v - db2v) / Math.Max(1e-9, db3v + db2v);
            double ema = emr >= 0.0 ? emr : -emr;
            if (ema > 0.3) ema = 0.3;
            ema = ema / 0.3;
            ema = ema * ema * (3.0 - 2.0 * ema);
            double edgeMix = emr >= 0.0 ? 0.5 + 0.5 * ema : 0.5 - 0.5 * ema;
            double edgeSide = edgeMix * e2Side + (1.0 - edgeMix) * e3Side;
            double edgeShared = edgeMix * e2Shared + (1.0 - edgeMix) * e3Shared;
            double dt = (edgeShared - 0.06) / 0.24;
            if (dt < 0.0) dt = 0.0; else if (dt > 1.0) dt = 1.0;
            dt = dt * dt * (3.0 - 2.0 * dt);
            double dissolve = (1.0 - dt) * 0.7;
            double inr = Inradius[owner];
            if (inr < 0.01) inr = 0.01;
            double jn = double.IsInfinity(d3) ? 0.0 : 1.0 - Math.Min(1.0, (d3 - d1) / Math.Max(1e-9, d3 + d1));
            double jnS = (jn - 0.65) / 0.33;
            if (jnS < 0.0) jnS = 0.0; else if (jnS > 1.0) jnS = 1.0;
            jnS = jnS * jnS * (3.0 - 2.0 * jnS);
            double jg = (jn - 0.45) / 0.3;
            if (jg < 0.0) jg = 0.0; else if (jg > 1.0) jg = 1.0;
            jg = jg * jg * (3.0 - 2.0 * jg);
            dissolve *= (1.0 - jg);
            double ownerMix = 0.5 + 0.5 * Math.Min(1.0, db / Math.Max(1e-6, 0.35 * inr));
            double nbMul = edgeMix * SizeMul[nb2] + (1.0 - edgeMix) * SizeMul[nb3];
            double staticMulBlended = ownerMix * SizeMul[owner] + (1.0 - ownerMix) * nbMul;
            double ownerFade = 2.0 * ownerMix - 1.0;
            if (ownerFade < 0.0) ownerFade = 0.0;
            double crestW = WallWidth * Math.Max(0.2, CellSize) * 0.5;
            double wallScale = 0.7 + 0.7 * edgeSide;
            if (DepthVariation > 0.0)
            {
                double hSeam = CellHash01(owner, Seed + 29);
                wallScale *= 1.0 + (hSeam - 0.5) * 0.8 * DepthVariation;
            }
            if (WallWidth > 0.0)
            {
                double wn = VNoise(px * WallNoiseFreq, py * WallNoiseFreq, Seed + 83);
                wallScale *= Math.Max(0.3, 1.0 + 0.6 * wn + 1.1 * jnS);
                double jnW = (jn - 0.55) / 0.4;
                if (jnW < 0.0) jnW = 0.0; else if (jnW > 1.0) jnW = 1.0;
                jnW = jnW * jnW * (3.0 - 2.0 * jnW);
                crestW *= Math.Max(0.15, 1.0 + 1.2 * wn + 6.0 * JunctionLift * jnW);
            }
            double cwCap = inr - 0.3;
            if (cwCap < 0.0) cwCap = 0.0;
            if (crestW > 0.6 * inr) crestW = 0.6 * inr;
            if (crestW > cwCap) crestW = cwCap;
            double w = SeamDepth * Math.Max(0.02, inr - crestW) * wallScale;
            if (w < 0.3) w = 0.3;
            double twRaw = (db - crestW) / w;
            if (twRaw < 0.0) twRaw = 0.0;
            const double FILLET_BAND = 0.2;
            double tw;
            if (twRaw >= 1.0 + FILLET_BAND) tw = 1.0;
            else if (twRaw <= 1.0 - FILLET_BAND) tw = twRaw;
            else { double e = 1.0 + FILLET_BAND - twRaw; tw = 1.0 - (e * e) / (4.0 * FILLET_BAND); }
            if (tw < 0.0) tw = 0.0;
            double v;
            if (Profile == "cosine")
            {
                double cosH = 0.5 * (1.0 - Math.Cos(Math.PI * tw));
                double lateH = Math.Pow(tw, 1.5 + 0.6 * edgeShared);
                double profMix = 0.15 + 0.45 * edgeSide;
                v = (1.0 - profMix) * cosH + profMix * lateH;
            }
            else v = ProfileFn(tw);
            if (dissolve > 0.0) v += (1.0 - v) * dissolve;
            double cushionAmp = 0.0;
            if (Pillow > 0.0 && twRaw > 1.25)
            {
                double stSz = (Inradius[owner] / Math.Max(0.05, MedianInr) - 0.9) / 0.9;
                if (stSz < 0.0) stSz = 0.0; else if (stSz > 1.0) stSz = 1.0;
                stSz = stSz * stSz * (3.0 - 2.0 * stSz);
                if (stSz > 0.0)
                {
                    double fieldV = (VNoise(Sx[owner] * 0.045, Sy[owner] * 0.045, Seed + 61) + 1.0) * 0.5;
                    if (PillowCoverage <= 0.0) fieldV = -1.0;
                    double cg = (fieldV - (0.8 - PillowCoverage)) / 0.4;
                    if (cg < 0.0) cg = 0.0; else if (cg > 1.0) cg = 1.0;
                    cg = cg * cg * (3.0 - 2.0 * cg);
                    if (cg > 0.0)
                    {
                        double amtVar = 0.55 + 0.45 * fieldV;
                        cushionAmp = Pillow * amtVar * 0.28 * stSz * cg;
                    }
                }
            }
            double cellDepthMul = staticMulBlended;
            if (DepthVariation > 0.0)
            {
                double sn = (VNoise(px * SuppressFreq, py * SuppressFreq, Seed + 103) + 1.0) * 0.5;
                double st = (sn - 0.62) / 0.2;
                if (st < 0.0) st = 0.0; else if (st > 1.0) st = 1.0;
                st = st * st * (3.0 - 2.0 * st);
                cellDepthMul *= 1.0 - 0.5 * DepthVariation * st;
            }
            if (DepthVariation > 0.0 && v > 0.0)
            {
                double tiltAng = VNoise(Sx[owner] * 0.045 + 37.1, Sy[owner] * 0.045 + 11.7, Seed + 61) * Math.PI * 2.0;
                double rad = Math.Max(0.2, Inradius[owner] * 2.0);
                double tilt = (Math.Cos(tiltAng) * (px - Sx[owner])
                               + Math.Sin(tiltAng) * (py - Sy[owner])) / rad;
                double tiltT = (Math.Max(-0.9, Math.Min(0.9, tilt)) + 0.9) / 1.8;
                v *= 1.0 - 0.7 * DepthVariation * tiltT * v * ownerFade;
            }
            v = v * cellDepthMul;
            double baseWave = BaseAmp * VNoise(px * BaseFreq, py * BaseFreq, Seed + 99);
            double crest = 0.0;
            if (CrestVariation > 0.0)
                crest = CrestVariation * 0.4 * VNoise(px * CrestFreq, py * CrestFreq, Seed + 97) * Math.Pow(Math.Max(0.0, 1.0 - v), 1.5);
            double lift = JunctionLift > 0.0 ? JunctionLift * 0.1 * jnS * (1.0 - v) : 0.0;
            lift += crest;
            double crownTerm = 0.0;
            double crownW = crestW;
            if (crownW < 0.25) crownW = 0.25;
            if (WallWidth > 0.0 && crestW > 1e-6 && db < crownW)
            {
                double ct = db / crownW;
                ct = ct * ct * (3.0 - 2.0 * ct);
                crownTerm = 0.15 * (1.0 - ct) * (0.35 + 0.65 * cellDepthMul) * (0.35 + 0.9 * edgeShared) * (1.0 - dissolve);
            }
            cushion = cushionAmp > 0.0 ? cushionAmp * cellDepthMul : 0.0;
            if (Polarity == "domes") return baseWave + v + lift - crownTerm;
            double zc = baseWave + (1.0 - v) + lift + crownTerm;
            double hp = zc - (baseWave + 1.0);
            if (hp > 0.04) zc = baseWave + 1.0 + 0.04 + 0.13 * Math.Tanh((hp - 0.04) / 0.13);
            return zc;
        }
    }

    /// <summary>Normalized [0, 1] height field (row-major, gCols x gRows) for the given
    /// relaxed sites; identical in operation order to voronoi_relief_native.py.</summary>
    public static double[] VoronoiReliefHeights(double[] sx, double[] sy, double meshX, double meshY,
        int gCols, int gRows, double cellSize, long seed, string profile, string polarity,
        double seamSharpness, double seamDepth, double baseAmp, double baseFreq, double wallWidth,
        double pillow, double pillowCoverage, double depthVariation, double junctionLift, double crestVariation)
    {
        if (sx == null || sy == null || sx.Length != sy.Length || sx.Length == 0) throw new ArgumentException("Sites must be two equal non-empty arrays");
        if (gCols < 2 || gRows < 2 || (long)gCols * gRows > 4194304) throw new ArgumentException("Grid must be at least 2 x 2 and at most 4,194,304 nodes");
        int n = sx.Length;
        Field f = new Field();
        f.Sx = sx; f.Sy = sy; f.N = n; f.MeshX = meshX; f.MeshY = meshY; f.CellSize = cellSize; f.Seed = seed;
        f.Profile = profile; f.Polarity = polarity; f.SeamSharpness = seamSharpness; f.SeamDepth = seamDepth;
        f.BaseAmp = baseAmp; f.BaseFreq = baseFreq; f.WallWidth = wallWidth; f.Pillow = pillow; f.PillowCoverage = pillowCoverage;
        f.DepthVariation = depthVariation; f.JunctionLift = junctionLift; f.CrestVariation = crestVariation;
        double scale = 1.0;
        for (int k = 0; k < n; k++) scale = Math.Max(scale, Math.Max(Math.Abs(sx[k]), Math.Abs(sy[k])));
        f.CoordinateScale = scale;

        double dxPix = gCols > 1 ? meshX / (double)(gCols - 1) : meshX;
        double dyPix = gRows > 1 ? meshY / (double)(gRows - 1) : meshY;
        int total = gCols * gRows;
        double[] z = new double[total], cushA = new double[total];
        int[] cushOwner = new int[total];
        for (int i = 0; i < total; i++) cushOwner[i] = -1;

        double[] inradius = new double[n];
        for (int k = 0; k < n; k++)
        {
            inradius[k] = cellSize * 0.5;
            double best = double.PositiveInfinity;
            for (int m = 0; m < n; m++)
            {
                if (m == k) continue;
                double ddx = sx[m] - sx[k], ddy = sy[m] - sy[k];
                double dd = ddx * ddx + ddy * ddy;
                if (dd < best) best = dd;
            }
            if (!double.IsInfinity(best)) inradius[k] = Math.Sqrt(best) * 0.5;
        }
        double[] sorted = (double[])inradius.Clone();
        Array.Sort(sorted);
        double medianInr = Math.Max(0.05, sorted[n / 2]);
        double[] sizeMul = new double[n];
        for (int k = 0; k < n; k++)
        {
            double sm = Math.Sqrt(inradius[k] / medianInr);
            if (sm < 0.8) sm = 0.8; else if (sm > 1.2) sm = 1.2;
            double tierMul = 1.0;
            if (depthVariation > 0.0)
            {
                double hDepth = CellHash01(k, seed + 13);
                tierMul = 1.0 - depthVariation * (1.0 - (0.45 + 0.65 * hDepth));
            }
            double wTyp = seamDepth * inradius[k] * 0.52;
            if (wTyp < 0.05) wTyp = 0.05;
            double budget = 0.55 * wTyp;
            if (budget > 1.0) budget = 1.0;
            sizeMul[k] = sm * tierMul * budget;
        }
        f.Inradius = inradius; f.SizeMul = sizeMul; f.MedianInr = medianInr;
        f.WallNoiseFreq = 0.45 / Math.Max(0.2, cellSize);
        f.CrestFreq = 0.25 / Math.Max(0.2, cellSize);
        f.SuppressFreq = 0.16 / Math.Max(0.2, cellSize);

        for (int j = 0; j < gRows; j++)
        {
            double py = j * dyPix;
            int rowOff = j * gCols;
            for (int i = 0; i < gCols; i++)
            {
                double px = i * dxPix, cushion; int owner;
                z[rowOff + i] = f.Node(px, py, out cushion, out owner);
                if (cushion > 0.0) { cushA[rowOff + i] = cushion; cushOwner[rowOff + i] = owner; }
            }
        }

        bool anyCush = false;
        for (int i = 0; i < total; i++) if (cushA[i] > 0.0) { anyCush = true; break; }
        if (anyCush) Membrane(f, z, cushA, cushOwner, gCols, gRows, dxPix, dyPix);

        double zMin = double.PositiveInfinity, zMax = double.NegativeInfinity;
        for (int i = 0; i < total; i++) { if (z[i] < zMin) zMin = z[i]; if (z[i] > zMax) zMax = z[i]; }
        double span = zMax - zMin;
        if (span > 1e-12)
        {
            double invSpan = 1.0 / span;
            for (int i = 0; i < total; i++) z[i] = (z[i] - zMin) * invSpan;
        }
        return z;
    }

    static void Membrane(Field f, double[] z, double[] cushA, int[] cushOwner, int gCols, int gRows, double dxPix, double dyPix)
    {
        double meshX = f.MeshX, meshY = f.MeshY;
        int n = f.N;
        double[] sx = f.Sx, sy = f.Sy;
        double pitch = Math.Max(0.2, Math.Sqrt(meshX * meshY / 10000.0));
        int mc = Math.Max(3, (int)Math.Ceiling(meshX / pitch) + 1);
        int mr = Math.Max(3, (int)Math.Ceiling(meshY / pitch) + 1);
        int lattice = mc * mr;
        int[] owner = new int[lattice];
        for (int k = 0; k < lattice; k++) owner[k] = -1;
        HashSet<int> cushionCells = new HashSet<int>();
        for (int i = 0; i < cushOwner.Length; i++) if (cushOwner[i] >= 0) cushionCells.Add(cushOwner[i]);
        double reach = 1.25 * 0.3 * (1.0 - 1e-9);
        for (int lj = 1; lj < mr - 1; lj++)
        {
            double ly = lj / (double)(mr - 1) * meshY;
            for (int li = 1; li < mc - 1; li++)
            {
                double lx = li / (double)(mc - 1) * meshX;
                double a0 = double.PositiveInfinity, a1 = a0, a2 = a0, a3 = a0;
                int k0 = -1, k1 = -1, k2 = -1, k3 = -1;
                for (int k = 0; k < n; k++)
                {
                    double dx = sx[k] - lx, dy = sy[k] - ly;
                    double d2 = dx * dx + dy * dy;
                    if (d2 < a3)
                    {
                        if (d2 < a0) { a3 = a2; k3 = k2; a2 = a1; k2 = k1; a1 = a0; k1 = k0; a0 = d2; k0 = k; }
                        else if (d2 < a1) { a3 = a2; k3 = k2; a2 = a1; k2 = k1; a1 = d2; k1 = k; }
                        else if (d2 < a2) { a3 = a2; k3 = k2; a2 = d2; k2 = k; }
                        else { a3 = d2; k3 = k; }
                    }
                }
                if (!cushionCells.Contains(k0)) continue;
                double bound = 0.0;
                double[] ds = { a1, a2, a3 }; int[] ks = { k1, k2, k3 };
                for (int r = 0; r < 3; r++)
                {
                    if (ks[r] < 0) continue;
                    double sep = Math.Sqrt(Math.Pow(sx[ks[r]] - sx[k0], 2) + Math.Pow(sy[ks[r]] - sy[k0], 2));
                    bound = Math.Max(bound, (ds[r] - a0) / (2.0 * Math.Max(1e-9, sep)));
                }
                if (bound <= reach) continue;
                double cushion; int own;
                f.Node(lx, ly, out cushion, out own);
                if (cushion > 0.0) owner[lj * mc + li] = own;
            }
        }
        List<int> nodes = new List<int>();
        for (int k = 0; k < lattice; k++) if (owner[k] >= 0) nodes.Add(k);
        double[] u = new double[lattice], res = new double[lattice], dir = new double[lattice], applied = new double[lattice];
        int[][] links = new int[nodes.Count][];
        for (int m = 0; m < nodes.Count; m++)
        {
            int k = nodes[m], o = owner[k];
            List<int> l = new List<int>(4);
            foreach (int nb in new int[] { k - 1, k + 1, k - mc, k + mc }) if (owner[nb] == o) l.Add(nb);
            links[m] = l.ToArray();
        }
        SortedDictionary<int, List<int>> groups = new SortedDictionary<int, List<int>>();
        for (int m = 0; m < nodes.Count; m++)
        {
            List<int> g;
            if (!groups.TryGetValue(owner[nodes[m]], out g)) { g = new List<int>(); groups[owner[nodes[m]]] = g; }
            g.Add(m);
        }
        foreach (KeyValuePair<int, List<int>> entry in groups)
        {
            List<int> members = entry.Value;
            double rr = 0.0;
            foreach (int m in members) { int k = nodes[m]; res[k] = 4.0; dir[k] = 4.0; rr += 16.0; }
            double target = rr * 1e-20;
            int iteration = 0;
            while (iteration < 4 * (mc + mr) + 100 && rr > target)
            {
                double curvature = 0.0;
                foreach (int m in members)
                {
                    int k = nodes[m];
                    double value = 4.0 * dir[k];
                    foreach (int nb in links[m]) value -= dir[nb];
                    applied[k] = value;
                    curvature += dir[k] * value;
                }
                double alpha = rr / curvature;
                double next = 0.0;
                foreach (int m in members)
                {
                    int k = nodes[m];
                    u[k] += alpha * dir[k];
                    res[k] -= alpha * applied[k];
                    next += res[k] * res[k];
                }
                double beta = next / rr;
                rr = next;
                foreach (int m in members) { int k = nodes[m]; dir[k] = res[k] + beta * dir[k]; }
                iteration++;
            }
        }
        double[] uMax = new double[n];
        foreach (int k in nodes) if (u[k] > uMax[owner[k]]) uMax[owner[k]] = u[k];
        bool domes = f.Polarity == "domes";
        for (int j = 0; j < gRows; j++)
        {
            double gy = Math.Min(mr - 1.0, Math.Max(0.0, j * dyPix / meshY * (mr - 1)));
            int j0 = Math.Min(mr - 2, (int)Math.Floor(gy));
            double fy = gy - j0;
            for (int i = 0; i < gCols; i++)
            {
                int idx = j * gCols + i;
                if (cushA[idx] <= 0.0) continue;
                int o = cushOwner[idx];
                if (o < 0 || uMax[o] <= 1e-9) continue;
                double gx = Math.Min(mc - 1.0, Math.Max(0.0, i * dxPix / meshX * (mc - 1)));
                int i0 = Math.Min(mc - 2, (int)Math.Floor(gx));
                double fx = gx - i0;
                int k = j0 * mc + i0;
                double c00 = owner[k] == o ? u[k] : 0.0;
                double c10 = owner[k + 1] == o ? u[k + 1] : 0.0;
                double c01 = owner[k + mc] == o ? u[k + mc] : 0.0;
                double c11 = owner[k + mc + 1] == o ? u[k + mc + 1] : 0.0;
                double membrane = (1.0 - fy) * ((1.0 - fx) * c00 + fx * c10) + fy * ((1.0 - fx) * c01 + fx * c11);
                double un = membrane / uMax[o];
                double wv = un * un * un * (un * (un * 6.0 - 15.0) + 10.0);
                if (domes) z[idx] -= cushA[idx] * wv;
                else z[idx] += cushA[idx] * wv;
            }
        }
    }
}
