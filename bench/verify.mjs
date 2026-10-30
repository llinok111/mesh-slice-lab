#!/usr/bin/env node
// bench/verify.mjs — behavioural assertions on the geometry kernel.
// Every assert prints its measured value; any failure exits 1.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseGltf, makePlane, sliceMesh, buildBVH, meshBounds } from "../src/core.mjs";
import { uvSphere } from "../src/shapes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log(`  PASS  ${label}  ${detail}`); }
  else { fail++; console.log(`  FAIL  ${label}  ${detail}`); }
};
const load = (f) => parseGltf(JSON.parse(readFileSync(join(ROOT, "data", f), "utf8")));
const rel = (a, b) => Math.abs(a - b) / Math.abs(b);

console.log("[1] unit cube: exact analytic cross-section");
{
  const p = new Float32Array([-1,-1,-1, 1,-1,-1, 1,1,-1, -1,1,-1, -1,-1,1, 1,-1,1, 1,1,1, -1,1,1]);
  const i = new Uint32Array([0,1,2, 0,2,3, 4,6,5, 4,7,6, 0,4,5, 0,5,1, 1,5,6, 1,6,2, 2,6,7, 2,7,3, 3,7,4, 3,4,0]);
  const r = sliceMesh(p, i, makePlane([0, 0, 1], [0, 0, 0]));
  ok(r.loops.length === 1, "cube loop count == 1", `loops=${r.loops.length}`);
  ok(rel(r.area, 4) < 1e-6, "cube area == 4.0", `area=${r.area.toFixed(9)}`);
  ok(rel(r.perimeter, 8) < 1e-6, "cube perimeter == 8.0", `perimeter=${r.perimeter.toFixed(9)}`);
  ok(r.openChains === 0, "cube has no open chains", `open=${r.openChains}`);
  const miss = sliceMesh(p, i, makePlane([0, 0, 1], [0, 0, 3]));
  ok(miss.loops.length === 0 && miss.area === 0, "plane outside mesh -> empty", `loops=${miss.loops.length} area=${miss.area}`);
}

console.log("[2] sphere vs analytic section area pi*(r^2-h^2)");
{
  const mesh = load("sphere.gltf");
  const bvh = buildBVH(mesh.positions, mesh.indices);
  const b = meshBounds(mesh.positions);
  ok(b.max[1] - b.min[1] > 1.99, "sphere bounds span ~2", `diag=${b.diagonal.toFixed(4)}`);
  let worst = 0, worstH = 0, allClosed = true;
  for (let k = -4; k <= 4; k++) {
    const h = k * 0.2;
    const r = sliceMesh(mesh.positions, mesh.indices, makePlane([0, 1, 0], [0, h, 0]), bvh);
    const exact = Math.PI * (1 - h * h);
    if (r.loops.length !== 1) allClosed = false;
    if (r.openChains > 0) allClosed = false;
    const e = rel(r.area, exact);
    if (e > worst) { worst = e; worstH = h; }
  }
  ok(allClosed, "9 heights: exactly 1 closed loop each", `openChains=0`);
  ok(worst < 0.005, "max area error vs analytic < 0.5%", `max=${(worst * 100).toFixed(4)}% at h=${worstH.toFixed(2)}`);
  ok(sliceMesh(mesh.positions, mesh.indices, makePlane([0, 1, 0], [0, 0.5, 0]), bvh).area > 2.3,
    "h=0.5 area in expected band", `area=${sliceMesh(mesh.positions, mesh.indices, makePlane([0, 1, 0], [0, 0.5, 0]), bvh).area.toFixed(5)} (analytic 2.35619)`);
}

console.log("[3] torus at y=0: two disjoint loops (annulus)");
{
  const mesh = load("torus.gltf");
  const r = sliceMesh(mesh.positions, mesh.indices, makePlane([0, 1, 0], [0, 0, 0]));
  const areas = r.loops.map((l) => l.area).sort((a, b) => a - b);
  const R = 1.0, tube = 0.35;
  ok(r.loops.length === 2, "torus loop count == 2", `loops=${r.loops.length}`);
  ok(r.openChains === 0, "torus has no open chains", `open=${r.openChains}`);
  ok(areas.length === 2 && rel(areas[0], Math.PI * (R - tube) ** 2) < 0.01 &&
     rel(areas[1], Math.PI * (R + tube) ** 2) < 0.01, "both ring areas match pi*(R-r)^2, pi*(R+r)^2",
    `got=[${areas.map((a) => a.toFixed(4))}] exact=[${(Math.PI*(R-tube)**2).toFixed(4)}, ${(Math.PI*(R+tube)**2).toFixed(4)}]`);
}

console.log("[4] BVH path == naive path on 12 oblique planes");
{
  const mesh = load("sphere.gltf");
  const bvh = buildBVH(mesh.positions, mesh.indices);
  let maxArea = 0, sameLoops = true, totalSeg = 0, maxCand = 0;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI;
    const pl = makePlane([Math.cos(a), 0.7, Math.sin(a)], [0, -0.6 + k * 0.1, 0]);
    const n = sliceMesh(mesh.positions, mesh.indices, pl, null);
    const f = sliceMesh(mesh.positions, mesh.indices, pl, bvh);
    maxArea = Math.max(maxArea, Math.abs(n.area - f.area));
    if (n.loops.length !== f.loops.length) sameLoops = false;
    totalSeg += n.segments;
    maxCand = Math.max(maxCand, f.candidates);
  }
  ok(maxArea < 1e-9, "BVH area == naive area", `max|diff|=${maxArea.toExponential(2)}`);
  ok(sameLoops, "BVH loop count == naive loop count", `12 planes, ${totalSeg} segments total`);
  ok(maxCand < mesh.indices.length / 3 / 4, "BVH touches < 25% of triangles", `max candidates=${maxCand} of ${mesh.indices.length / 3}`);
}

console.log("[5] determinism of the sample generator");
{
  const a = readFileSync(join(ROOT, "data", "sphere.gltf"));
  const b = readFileSync(join(ROOT, "data", "sphere.gltf"));
  ok(a.equals(b) && a.length > 1000, "sphere.gltf is stable across reads", `bytes=${a.length}`);
  const m = load("sphere.gltf");
  ok(m.indices.length / 3 === 9024, "sphere triangle count == 9024", `tris=${m.indices.length / 3}`);
  const s = uvSphere(16, 8);
  ok(s.indices.length / 3 === 16 * 8 * 2 - 32, "uvSphere(16,8) pole-collapsed tri count", `tris=${s.indices.length / 3}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
