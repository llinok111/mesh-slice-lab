// src/shapes.mjs — deterministic parametric meshes (pure, no I/O).
// Shared by tools/gen-sample.mjs (writes glTF) and bench/bench.mjs (in-memory).

/** UV sphere with outward winding. seg x rings quads, poles collapsed. */
export function uvSphere(seg, rings, radius = 1) {
  const verts = [];
  for (let r = 0; r <= rings; r++) {
    const phi = (Math.PI * r) / rings;
    for (let s = 0; s <= seg; s++) {
      const th = (2 * Math.PI * s) / seg;
      verts.push(radius * Math.sin(phi) * Math.cos(th), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(th));
    }
  }
  const tris = [];
  const V = (r, s) => r * (seg + 1) + s;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < seg; s++) {
      const a = V(r, s), b = V(r + 1, s), c = V(r + 1, s + 1), d = V(r, s + 1);
      if (r !== 0) tris.push(a, b, c);
      if (r !== rings - 1) tris.push(a, c, d);
    }
  }
  orient(verts, tris, 0, 0, 0);
  return { positions: new Float32Array(verts), indices: new Uint32Array(tris) };
}

/** Torus around Y, major radius R, tube radius r. Two loops when cut at y=0. */
export function torus(seg, tube, R = 1.0, r = 0.35) {
  const verts = [], tris = [];
  for (let i = 0; i <= seg; i++) {
    const u = (2 * Math.PI * i) / seg;
    for (let j = 0; j <= tube; j++) {
      const v = (2 * Math.PI * j) / tube;
      verts.push((R + r * Math.cos(v)) * Math.cos(u), r * Math.sin(v), (R + r * Math.cos(v)) * Math.sin(u));
    }
  }
  const V = (i, j) => i * (tube + 1) + j;
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < tube; j++) {
      const a = V(i, j), b = V(i + 1, j), c = V(i + 1, j + 1), d = V(i, j + 1);
      tris.push(a, b, c, a, c, d);
    }
  }
  orient(verts, tris, R, 0, 0); // reference point on the tube centre-line
  return { positions: new Float32Array(verts), indices: new Uint32Array(tris) };
}

/** Flip triangles whose normal points back toward the reference point. */
function orient(verts, tris, rx, ry, rz) {
  for (let t = 0; t < tris.length; t += 3) {
    const i = tris[t] * 3, j = tris[t + 1] * 3, k = tris[t + 2] * 3;
    const ux = verts[j] - verts[i], uy = verts[j + 1] - verts[i + 1], uz = verts[j + 2] - verts[i + 2];
    const vx = verts[k] - verts[i], vy = verts[k + 1] - verts[i + 1], vz = verts[k + 2] - verts[i + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const cx = (verts[i] + verts[j] + verts[k]) / 3 - rx;
    const cy = (verts[i + 1] + verts[j + 1] + verts[k + 1]) / 3 - ry;
    const cz = (verts[i + 2] + verts[j + 2] + verts[k + 2]) / 3 - rz;
    if (nx * cx + ny * cy + nz * cz < 0) {
      const tmp = tris[t + 1]; tris[t + 1] = tris[t + 2]; tris[t + 2] = tmp;
    }
  }
}
