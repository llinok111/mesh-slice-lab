#!/usr/bin/env node
// bench/bench.mjs — warmup + 5 timed repeats, cold start recorded separately.
// Writes bench/result.json; README quotes these numbers verbatim.
import { writeFileSync } from "node:fs";
import { cpus, totalmem, release } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { makePlane, sliceMesh, buildBVH } from "../src/core.mjs";
import { uvSphere } from "../src/shapes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SAMPLES = 5;
const PLANES = 64;

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return {
    min_ms: +s[0].toFixed(3),
    median_ms: +s[Math.floor(s.length / 2)].toFixed(3),
    p95_ms: +s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)].toFixed(3),
    stddev_ms: +sd.toFixed(3),
    rel_stddev_pct: +((sd / mean) * 100).toFixed(2),
  };
};

const mesh = uvSphere(512, 256);
const triCount = mesh.indices.length / 3;
const heights = Array.from({ length: PLANES }, (_, i) => -0.95 + (1.9 * i) / (PLANES - 1));
const planes = heights.map((h) => makePlane([0, 1, 0], [0, h, 0]));

const sweep = (index) => {
  let area = 0, segs = 0, open = 0, cand = 0;
  for (const p of planes) {
    const r = sliceMesh(mesh.positions, mesh.indices, p, index);
    area += r.area; segs += r.segments; open += r.openChains; cand += r.candidates;
  }
  return { area, segs, open, cand };
};

console.log(`mesh: ${triCount} triangles, ${mesh.positions.length / 3} vertices; ${PLANES} planes`);

// cold start: first index build + first full sweep, timed together
let t0 = performance.now();
const bvh0 = buildBVH(mesh.positions, mesh.indices);
const coldSweep = sweep(bvh0);
const coldMs = performance.now() - t0;
console.log(`cold start (build + sweep): ${coldMs.toFixed(1)} ms`);

// warmup
sweep(null); sweep(bvh0);

const naiveRuns = [], bvhRuns = [], buildRuns = [];
let naiveRef = null, bvhRef = null;
for (let i = 0; i < SAMPLES; i++) {
  let t = performance.now();
  const n = sweep(null);
  naiveRuns.push(performance.now() - t);
  naiveRef = n;

  t = performance.now();
  const idx = buildBVH(mesh.positions, mesh.indices);
  buildRuns.push(performance.now() - t);

  t = performance.now();
  const b = sweep(idx);
  bvhRuns.push(performance.now() - t);
  bvhRef = b;
  console.log(`  run ${i + 1}: naive ${naiveRuns[i].toFixed(1)} ms | bvh ${bvhRuns[i].toFixed(1)} ms | build ${buildRuns[i].toFixed(1)} ms`);
}

const naive = stats(naiveRuns), bvh = stats(bvhRuns), build = stats(buildRuns);
const coldTotal = coldMs;
const result = {
  generated_at: new Date().toISOString(),
  node: process.version,
  kernel: release(),
  machine: { cpus: cpus().length, mem_gb: +(totalmem() / 2 ** 30).toFixed(1) },
  workload: {
    mesh: "uvSphere(512,256) from src/shapes.mjs",
    triangles: triCount,
    vertices: mesh.positions.length / 3,
    planes: PLANES,
    plane_axis: "y",
    heights: [-0.95, 0.95],
  },
  samples: SAMPLES,
  naive_full_scan: { ...naive, per_plane_ms: +(naive.median_ms / PLANES).toFixed(3) },
  bvh_indexed: { ...bvh, per_plane_ms: +(bvh.median_ms / PLANES).toFixed(3) },
  bvh_build: build,
  cold_start_build_plus_first_sweep_ms: +coldTotal.toFixed(3),
  speedup_steady_state: +(naive.median_ms / bvh.median_ms).toFixed(2),
  speedup_amortized_with_build: +(naive.median_ms / (bvh.median_ms + build.median_ms)).toFixed(2),
  correctness: {
    areas_identical: Math.abs(naiveRef.area - bvhRef.area) < 1e-6,
    segments: naiveRef.segs,
    candidates_naive: naiveRef.cand,
    candidates_bvh: bvhRef.cand,
    candidate_reduction_pct: +((1 - bvhRef.cand / naiveRef.cand) * 100).toFixed(1),
    open_chains: naiveRef.open + bvhRef.open,
  },
};
writeFileSync(join(ROOT, "bench", "result.json"), JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
