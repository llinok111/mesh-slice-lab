// main.js — rendering + interaction only. All geometry math comes from src/core.mjs.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { parseGltf, makePlane, sliceMesh, buildBVH } from "./src/core.mjs";

const $ = (id) => document.getElementById(id);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
$("app").appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 4, 12);

const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.05, 100);
camera.position.set(2.6, 2.1, 2.9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

scene.add(new THREE.HemisphereLight(0x9fc7ff, 0x101522, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(3, 5, 2);
scene.add(key);
const rim = new THREE.DirectionalLight(0x5f8bff, 1.2);
rim.position.set(-4, -2, -3);
scene.add(rim);

const grid = new THREE.GridHelper(8, 16, 0x1b2436, 0x131a28);
grid.position.y = -1.35;
scene.add(grid);

// translucent slice plane
const planeMesh = new THREE.Mesh(
  new THREE.PlaneGeometry(3.2, 3.2),
  new THREE.MeshBasicMaterial({ color: 0x2f6fd0, transparent: true, opacity: 0.10, side: THREE.DoubleSide, depthWrite: false })
);
planeMesh.rotation.x = -Math.PI / 2;
scene.add(planeMesh);

const contourGroup = new THREE.Group();
scene.add(contourGroup);
const contourMat = new THREE.LineBasicMaterial({ color: 0x7fd1ff });

const state = { mesh: null, name: "", bvh: null, solid: null };

function makeSolid(geometry) {
  const m = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({
    color: 0x33456b, metalness: 0.15, roughness: 0.55,
    transparent: true, opacity: 0.55, side: THREE.DoubleSide, flatShading: true,
  }));
  scene.add(m);
  return m;
}

function disposeSolid() {
  if (!state.solid) return;
  scene.remove(state.solid);
  state.solid.geometry.dispose();
  state.solid.material.dispose();
  state.solid = null;
}

async function load(name) {
  const res = await fetch(`./data/${name}.gltf`);
  const doc = await res.json();
  const mesh = parseGltf(doc);
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geom.computeVertexNormals();
  disposeSolid();
  state.mesh = mesh;
  state.name = name;
  state.bvh = buildBVH(mesh.positions, mesh.indices);
  state.solid = makeSolid(geom);
}

function drawContours(loops) {
  for (const c of contourGroup.children) c.geometry.dispose();
  contourGroup.clear();
  const pts = [];
  for (const loop of loops) {
    const p = loop.points;
    const n = p.length / 3;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      pts.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2], p[j * 3], p[j * 3 + 1], p[j * 3 + 2]);
    }
  }
  if (!pts.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
  contourGroup.add(new THREE.LineSegments(g, contourMat));
}

function update() {
  if (!state.mesh) return;
  const h = parseFloat($("h").value);
  $("hv").textContent = h.toFixed(2);
  planeMesh.position.y = h;
  const plane = makePlane([0, 1, 0], [0, h, 0]);
  const t0 = performance.now();
  const r = sliceMesh(state.mesh.positions, state.mesh.indices, plane, state.bvh);
  const ms = performance.now() - t0;
  drawContours(r.loops);
  $("s-loops").textContent = String(r.loops.length);
  $("s-area").textContent = r.area.toFixed(4);
  $("s-per").textContent = r.perimeter.toFixed(4);
  $("s-open").textContent = String(r.openChains);
  $("s-cand").textContent = `${r.candidates} / ${state.mesh.indices.length / 3}`;
  $("s-ms").textContent = `${ms.toFixed(2)} ms`;
}

$("h").addEventListener("input", update);
$("pick").addEventListener("change", (e) => load(e.target.value).then(update));

addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});

load("sphere").then(update).catch((e) => {
  console.error(e);
  $("err").style.display = "grid";
});
