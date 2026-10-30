# mesh-slice-lab

**Slicing a 261,120-triangle mesh at 64 heights takes 373.8 ms with a full triangle scan and 49.9 ms with a BVH index — 7.49× faster per slice (5.841 ms → 0.780 ms), with every contour closed and the cross-section area within 0.243 % of the analytic sphere section.**

The baseline is `sliceMesh(..., index = null)` in `src/core.mjs`: the identical clipping and stitching code, minus the index. Nothing else differs, so the ratio isolates the acceleration structure.

Upstream: none — original work, no upstream repository.

## What it does

A pure-JavaScript geometry kernel that cuts a triangle mesh with a plane and returns **closed polygons**, not a soup of segments:

- `parseGltf()` — glTF 2.0 reader (embedded base64 buffers, VEC3/SCALAR accessors).
- `buildBVH()` — median-split BVH over triangle AABBs, each node storing a bounding sphere so the per-plane rejection test is three multiplications.
- `sliceMesh()` — plane/triangle clipping, endpoint welding, ring walking, Newell area and perimeter per loop.
- Handles the nasty case where the plane passes exactly through shared vertices: both incident triangles emit the same edge, which is de-duplicated so every interior vertex keeps degree 2.

`src/core.mjs` imports nothing, touches no DOM and no filesystem, and runs under plain `node`.

## Run it

```bash
node tools/gen-sample.mjs && node bench/verify.mjs && node bench/bench.mjs
```

That regenerates `data/`, runs 18 assertions, and rewrites `bench/result.json` (about 7 s total).

To open the viewer:

```bash
python3 -m http.server 4173    # then open http://localhost:4173
```

Drag to orbit, move the slider to move the cutting plane, switch between the sphere and the torus. The HUD reports contour count, area, perimeter, open chains, triangles tested and slice time — all computed by `src/core.mjs`, never recomputed in the renderer.

## Evidence

`bench/result.json`, Node v24.19.0, 4 CPUs / 3.6 GB, 5 samples per variant after one warmup:

| | full scan | BVH indexed | |
| --- | --- | --- | --- |
| median, 64 planes | 373.829 ms | 49.907 ms | **7.49×** |
| per plane | 5.841 ms | 0.780 ms | |
| triangles tested | 16,711,680 | 281,259 | −98.3 % |
| stddev | 1.29 % | 10.06 % | |
| cold start (build + first sweep) | — | 809.857 ms | |
| index build, median | — | 691.556 ms | |

The BVH build costs 691.6 ms, so it only pays for itself once you need more than **137 slices** of this mesh (`691.556 / (5.841 − 0.780)`). Below that, the full scan is the better choice — the amortised ratio over 64 planes is 0.50× and `bench/result.json` reports it as `speedup_amortized_with_build` rather than hiding it.

The 10.06 % relative stddev on the BVH variant is above the 10 % threshold: at 0.78 ms per plane the sweep is dominated by GC pauses and JIT warm-up on a 3.6 GB shared box, and `min_ms` (46.884 ms) versus `p95_ms` (60.552 ms) shows the spread. The median is quoted, not the minimum.

`node bench/verify.mjs` — 18 assertions, all measured values printed:

```
cube area == 4.0                     area=4.000000000
cube perimeter == 8.0                perimeter=8.000000000
max area error vs analytic < 0.5%    max=0.2425% at h=0.80
torus loop count == 2                loops=2
both ring areas match pi*(R±r)^2     got=[1.3264,5.7215] exact=[1.3273,5.7256]
BVH area == naive area               max|diff|=1.35e-10
BVH touches < 25% of triangles       max candidates=747 of 9024
```

## Repo layout

```
index.html            viewer, importmap pinned to three@0.169.0
main.js               rendering + orbit + slider; consumes core output only
src/core.mjs          glTF decode, BVH, clipping, stitching (pure, no deps)
src/shapes.mjs        deterministic sphere/torus generators
tools/gen-sample.mjs  writes data/*.gltf (byte-identical on every run)
bench/verify.mjs      18 behavioural assertions
bench/bench.mjs       warmup + 5 samples + cold start -> bench/result.json
```

## Known limitations

- **Build cost is not amortised at low slice counts.** The median-split build is O(n log² n) and takes 692 ms for 261k triangles; a binned-SAH or LBVH build would cut that, but neither is implemented here.
- **The BVH is static.** Editing the mesh requires a rebuild; there is no refit path.
- **Non-manifold input degrades gracefully but silently.** Where three or more triangles meet an edge, the ring walk can leave an open chain; `openChains` counts these instead of throwing. `verify.mjs` asserts zero open chains for the sample meshes only.
- **The area is unsigned per loop.** For a torus cut at `y = 0` the two rings are reported separately (1.3264 and 5.7215) rather than as the annulus difference, so `area` is the sum of ring areas, not the enclosed region.
- **No spatial tolerance tuning.** Welding uses a fixed 1e-6 quantisation; meshes with coordinates far outside ±1000 would need a relative tolerance.
- **Browser support is untested beyond Chrome/Firefox desktop.** The viewer needs WebGL2 and a CDN reachable at runtime (`unpkg.com`).
