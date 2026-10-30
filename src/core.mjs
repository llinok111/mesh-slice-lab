// src/core.mjs — pure geometry kernel: glTF decode, BVH, plane/mesh cross-section.
// No three.js, no DOM, no I/O. Everything here runs under plain `node`.

/* ------------------------------------------------------------------ glTF */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Decode base64 into a Uint8Array without Buffer/atob (works in node + browser). */
export function b64decode(str) {
  const clean = str.replace(/[^A-Za-z0-9+/]/g, "");
  const out = new Uint8Array((clean.length * 3) >> 2);
  let o = 0, acc = 0, bits = 0;
  for (let i = 0; i < clean.length; i++) {
    acc = (acc << 6) | B64.indexOf(clean[i]);
    bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (acc >> bits) & 255; }
  }
  return out.subarray(0, o);
}

const COMP = { 5120: [Int8Array, 1], 5121: [Uint8Array, 1], 5122: [Int16Array, 2],
  5123: [Uint16Array, 2], 5125: [Uint32Array, 4], 5126: [Float32Array, 4] };
const NCOMP = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

/**
 * Minimal glTF 2.0 reader: embedded or external buffer, one mesh, one primitive.
 * `buffers` maps buffer index -> Uint8Array (caller supplies external .bin bytes).
 */
export function parseGltf(json, buffers = {}) {
  const doc = typeof json === "string" ? JSON.parse(json) : json;
  const bin = (i) => {
    if (buffers[i]) return buffers[i];
    const uri = doc.buffers[i].uri;
    if (!uri || !uri.startsWith("data:")) throw new Error("buffer " + i + " needs external bytes");
    return b64decode(uri.slice(uri.indexOf(",") + 1));
  };
  const readAccessor = (ai) => {
    const acc = doc.accessors[ai];
    const bv = doc.bufferViews[acc.bufferView];
    const [Ctor, sz] = COMP[acc.componentType];
    const n = NCOMP[acc.type];
    const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
    const bytes = bin(bv.buffer);
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const stride = bv.byteStride || sz * n;
    const count = acc.count;
    const out = new Ctor(count * n);
    for (let i = 0; i < count; i++) {
      const off = base + i * stride;
      for (let c = 0; c < n; c++) {
        const p = off + c * sz;
        out[i * n + c] = Ctor === Float32Array ? dv.getFloat32(p, true)
          : Ctor === Uint32Array ? dv.getUint32(p, true)
            : Ctor === Uint16Array ? dv.getUint16(p, true)
              : Ctor === Int16Array ? dv.getInt16(p, true)
                : Ctor === Int8Array ? dv.getInt8(p) : dv.getUint8(p);
      }
    }
    return out;
  };
  const prim = doc.meshes[0].primitives[0];
  const positions = readAccessor(prim.attributes.POSITION);
  let indices;
  if (prim.indices !== undefined) indices = readAccessor(prim.indices);
  else { indices = new Uint32Array(positions.length / 3); for (let i = 0; i < indices.length; i++) indices[i] = i; }
  return { positions, indices, name: doc.meshes[0].name || "mesh" };
}

/* ----------------------------------------------------------------- bounds */

export function meshBounds(positions) {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < x0) x0 = x; if (y < y0) y0 = y; if (z < z0) z0 = z;
    if (x > x1) x1 = x; if (y > y1) y1 = y; if (z > z1) z1 = z;
  }
  return { min: [x0, y0, z0], max: [x1, y1, z1], diagonal: Math.hypot(x1 - x0, y1 - y0, z1 - z0) };
}

/** Plane n·x = d, normal normalised. */
export function makePlane(normal, point) {
  const l = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const n = [normal[0] / l, normal[1] / l, normal[2] / l];
  return { n, d: n[0] * point[0] + n[1] * point[1] + n[2] * point[2] };
}

/* -------------------------------------------------------------------- BVH */

/**
 * Median-split BVH over triangle AABBs. Nodes carry a bounding sphere so the
 * per-plane rejection test is 3 mults instead of 8 corner projections.
 */
export function buildBVH(positions, indices, leafSize = 8) {
  const triCount = (indices.length / 3) | 0;
  const tmin = new Float32Array(triCount * 3);
  const tmax = new Float32Array(triCount * 3);
  const cen = new Float32Array(triCount * 3);
  const order = new Uint32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    for (let k = 0; k < 3; k++) {
      const p = positions[a + k], q = positions[b + k], r = positions[c + k];
      const lo = p < q ? (p < r ? p : r) : (q < r ? q : r);
      const hi = p > q ? (p > r ? p : r) : (q > r ? q : r);
      tmin[t * 3 + k] = lo; tmax[t * 3 + k] = hi; cen[t * 3 + k] = (lo + hi) * 0.5;
    }
    order[t] = t;
  }
  const nodes = [];
  const build = (start, end) => {
    const id = nodes.length;
    nodes.push(null);
    let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
    for (let i = start; i < end; i++) {
      const t = order[i] * 3;
      if (tmin[t] < x0) x0 = tmin[t]; if (tmax[t] > x1) x1 = tmax[t];
      if (tmin[t + 1] < y0) y0 = tmin[t + 1]; if (tmax[t + 1] > y1) y1 = tmax[t + 1];
      if (tmin[t + 2] < z0) z0 = tmin[t + 2]; if (tmax[t + 2] > z1) z1 = tmax[t + 2];
    }
    const cx = (x0 + x1) * 0.5, cy = (y0 + y1) * 0.5, cz = (z0 + z1) * 0.5;
    const rad = 0.5 * Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const count = end - start;
    if (count <= leafSize) {
      nodes[id] = { cx, cy, cz, rad, start, count, left: -1, right: -1 };
      return id;
    }
    let axis = 0, best = x1 - x0;
    if (y1 - y0 > best) { best = y1 - y0; axis = 1; }
    if (z1 - z0 > best) { axis = 2; }
    order.subarray(start, end).sort((a, b) => cen[a * 3 + axis] - cen[b * 3 + axis]);
    const mid = start + (count >> 1);
    const l = build(start, mid), r = build(mid, end);
    nodes[id] = { cx, cy, cz, rad, start, count, left: l, right: r };
    return id;
  };
  const root = build(0, triCount);
  return { nodes, root, order, triCount };
}

/* ----------------------------------------------------------- cross-section */

const SCRATCH = new Float64Array(9);

/**
 * Intersect a triangle soup with a plane and stitch the segments into closed
 * polygons. `index` may be a BVH from buildBVH(); pass null for the naive
 * full-scan baseline. Returns loops with area (Newell) and perimeter.
 */
export function sliceMesh(positions, indices, plane, index = null, opts = {}) {
  const eps = opts.eps ?? 1e-9;
  const n0 = plane.n[0], n1 = plane.n[1], n2 = plane.n[2], d = plane.d;
  const triCount = (indices.length / 3) | 0;
  let cap = 2048, ns = 0;
  let sx = new Float64Array(cap), sy = new Float64Array(cap), sz = new Float64Array(cap);
  let candidates = 0;

  const emit = (ax, ay, az, bx, by, bz) => {
    if (ns >= cap) {
      const c2 = cap * 2;
      const a = new Float64Array(c2), b = new Float64Array(c2), c = new Float64Array(c2);
      a.set(sx); b.set(sy); c.set(sz); sx = a; sy = b; sz = c; cap = c2;
    }
    sx[ns] = ax; sy[ns] = ay; sz[ns] = az; ns++;
    sx[ns] = bx; sy[ns] = by; sz[ns] = bz; ns++;
  };

  const clipTri = (ia, ib, ic) => {
    const a = ia * 3, b = ib * 3, c = ic * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cx = positions[c], cy = positions[c + 1], cz = positions[c + 2];
    const da = n0 * ax + n1 * ay + n2 * az - d;
    const db = n0 * bx + n1 * by + n2 * bz - d;
    const dc = n0 * cx + n1 * cy + n2 * cz - d;
    const sa = da > eps ? 1 : da < -eps ? -1 : 0;
    const sb = db > eps ? 1 : db < -eps ? -1 : 0;
    const sc = dc > eps ? 1 : dc < -eps ? -1 : 0;
    if (sa === sb && sb === sc) return;               // one side, or coplanar
    const P = SCRATCH;
    let np = 0;
    if (sa === 0) { P[0] = ax; P[1] = ay; P[2] = az; np = 1; }
    else if (sb === 0) { P[0] = bx; P[1] = by; P[2] = bz; np = 1; }
    else if (sc === 0) { P[0] = cx; P[1] = cy; P[2] = cz; np = 1; }
    if (sa === 0 && sb === 0) { P[3] = bx; P[4] = by; P[5] = bz; np = 2; }
    else if (sb === 0 && sc === 0) { P[3] = cx; P[4] = cy; P[5] = cz; np = 2; }
    else if (sc === 0 && sa === 0) { P[3] = ax; P[4] = ay; P[5] = az; np = 2; }
    if (np === 2) { emit(P[0], P[1], P[2], P[3], P[4], P[5]); return; }
    let q = np * 3;
    if (sa * sb < 0) { const t = da / (da - db); P[q] = ax + (bx - ax) * t; P[q + 1] = ay + (by - ay) * t; P[q + 2] = az + (bz - az) * t; q += 3; }
    if (sb * sc < 0) { const t = db / (db - dc); P[q] = bx + (cx - bx) * t; P[q + 1] = by + (cy - by) * t; P[q + 2] = bz + (cz - bz) * t; q += 3; }
    if (sc * sa < 0) { const t = dc / (dc - da); P[q] = cx + (ax - cx) * t; P[q + 1] = cy + (ay - cy) * t; P[q + 2] = cz + (az - cz) * t; q += 3; }
    if (q === 6) emit(P[0], P[1], P[2], P[3], P[4], P[5]);
  };

  if (index) {
    const nodes = index.nodes, order = index.order;
    const stack = new Int32Array(256);
    let sp = 0;
    stack[sp++] = index.root;
    while (sp > 0) {
      const node = nodes[stack[--sp]];
      if (Math.abs(n0 * node.cx + n1 * node.cy + n2 * node.cz - d) > node.rad + eps) continue;
      if (node.left < 0) {
        const end = node.start + node.count;
        for (let i = node.start; i < end; i++) {
          const t = order[i];
          candidates++;
          clipTri(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
        }
      } else {
        stack[sp++] = node.left; stack[sp++] = node.right;
      }
    }
  } else {
    for (let t = 0; t < triCount; t++) {
      candidates++;
      clipTri(indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]);
    }
  }

  const nSeg = ns >> 1;
  const loops = stitch(sx, sy, sz, nSeg, opts.tol);
  let area = 0, perimeter = 0, openChains = 0;
  for (const L of loops) { area += L.area; perimeter += L.perimeter; if (L.open) openChains++; }
  return { segments: nSeg, candidates, loops, area: Math.abs(area), perimeter, openChains };
}

/**
 * Weld segment endpoints by quantised position and walk closed rings.
 * Duplicate segments (plane through shared vertices) are collapsed so every
 * interior vertex keeps degree 2.
 */
export function stitch(sx, sy, sz, nSeg, tol = 1e-6) {
  const inv = 1 / tol;
  const bx = new Map();
  const px = [], py = [], pz = [];
  const segA = new Int32Array(nSeg), segB = new Int32Array(nSeg);
  const vid = (x, y, z) => {
    const qx = Math.round(x * inv), qy = Math.round(y * inv), qz = Math.round(z * inv);
    let m1 = bx.get(qx); if (!m1) { m1 = new Map(); bx.set(qx, m1); }
    let m2 = m1.get(qy); if (!m2) { m2 = new Map(); m1.set(qy, m2); }
    let id = m2.get(qz);
    if (id === undefined) { id = px.length; m2.set(qz, id); px.push(x); py.push(y); pz.push(z); }
    return id;
  };
  const adj = new Map();
  const seen = new Map();
  for (let s = 0; s < nSeg; s++) {
    const a = vid(sx[s * 2], sy[s * 2], sz[s * 2]);
    const b = vid(sx[s * 2 + 1], sy[s * 2 + 1], sz[s * 2 + 1]);
    if (a === b) { segA[s] = a; segB[s] = a; continue; }
    const lo = a < b ? a : b, hi = a < b ? b : a;
    let bucket = seen.get(lo);
    if (bucket && bucket.has(hi)) { segA[s] = a; segB[s] = a; continue; }
    if (!bucket) { bucket = new Set(); seen.set(lo, bucket); }
    bucket.add(hi);
    segA[s] = a; segB[s] = b;
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(s); adj.get(b).push(s);
  }
  const used = new Uint8Array(nSeg);
  const loops = [];
  for (let s = 0; s < nSeg; s++) {
    if (used[s] || segA[s] === segB[s]) continue;
    const ring = [];
    let v = segA[s];
    const startV = v;
    let guard = 0, open = false;
    for (;;) {
      const list = adj.get(v);
      let next = -1;
      for (let i = 0; i < list.length; i++) if (!used[list[i]]) { next = list[i]; break; }
      if (next < 0) { open = true; break; }
      used[next] = 1;
      v = segA[next] === v ? segB[next] : segA[next];
      ring.push(v);
      if (v === startV) break;
      if (++guard > nSeg + 2) { open = true; break; }
    }
    if (ring.length < 3) continue;
    let ax = 0, ay = 0, az = 0, per = 0;
    for (let i = 0; i < ring.length; i++) {
      const u = ring[i], w = ring[(i + 1) % ring.length];
      ax += py[u] * pz[w] - pz[u] * py[w];
      ay += pz[u] * px[w] - px[u] * pz[w];
      az += px[u] * py[w] - py[u] * px[w];
      per += Math.hypot(px[w] - px[u], py[w] - py[u], pz[w] - pz[u]);
    }
    const pts = new Float64Array(ring.length * 3);
    for (let i = 0; i < ring.length; i++) { pts[i * 3] = px[ring[i]]; pts[i * 3 + 1] = py[ring[i]]; pts[i * 3 + 2] = pz[ring[i]]; }
    loops.push({ points: pts, area: 0.5 * Math.hypot(ax, ay, az), perimeter: per, open });
  }
  return loops;
}
