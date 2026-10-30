#!/usr/bin/env node
// tools/gen-sample.mjs — deterministic sample meshes -> data/*.gltf
// Same command twice => byte-identical output (integer parameters, no RNG).
import { mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { uvSphere, torus } from "../src/shapes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data");

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function b64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1] ?? 0, c = bytes[i + 2] ?? 0;
    s += B64[a >> 2] + B64[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? B64[((b & 15) << 2) | (c >> 6)] : "=") +
      (i + 2 < bytes.length ? B64[c & 63] : "=");
  }
  return s;
}

function toGltf(name, positions, indices) {
  const pBytes = positions.byteLength, iBytes = indices.byteLength;
  const buf = new Uint8Array(pBytes + iBytes);
  buf.set(new Uint8Array(positions.buffer, positions.byteOffset, pBytes), 0);
  buf.set(new Uint8Array(indices.buffer, indices.byteOffset, iBytes), pBytes);
  const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) for (let k = 0; k < 3; k++) {
    if (positions[i + k] < bmin[k]) bmin[k] = positions[i + k];
    if (positions[i + k] > bmax[k]) bmax[k] = positions[i + k];
  }
  return JSON.stringify({
    asset: { version: "2.0", generator: "mesh-slice-lab/gen-sample" },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: { POSITION: 0 }, indices: 1, mode: 4 }] }],
    buffers: [{ byteLength: pBytes + iBytes, uri: "data:application/octet-stream;base64," + b64(buf) }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pBytes, target: 34962 },
      { buffer: 0, byteOffset: pBytes, byteLength: iBytes, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: "VEC3", min: bmin, max: bmax },
      { bufferView: 1, componentType: 5125, count: indices.length, type: "SCALAR" },
    ],
  });
}

function write(name, mesh) {
  const gltf = toGltf(name, mesh.positions, mesh.indices);
  writeFileSync(join(OUT, name + ".gltf"), gltf);
  return {
    file: name + ".gltf",
    triangles: mesh.indices.length / 3,
    vertices: mesh.positions.length / 3,
    bytes: Buffer.byteLength(gltf),
    sha256: createHash("sha256").update(gltf).digest("hex").slice(0, 16),
  };
}

mkdirSync(OUT, { recursive: true });
const files = [
  write("sphere", uvSphere(96, 48)),
  write("torus", torus(96, 32)),
];
const meta = {
  generator: "tools/gen-sample.mjs",
  deterministic: true,
  note: "bench builds its 261k-triangle sphere in memory from src/shapes.mjs; no large file is committed",
  files,
};
writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(JSON.stringify(meta, null, 2));
