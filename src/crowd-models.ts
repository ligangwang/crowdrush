/**
 * Loads the scanned roadblocks Crowd Rush stands on its road (Poly Haven,
 * CC0; see public/models/CREDITS.md). The characters need no files: they
 * are built from code (crowd-figures).
 */
import * as THREE from "three";
import {
  GLTFLoader,
  type GLTF,
} from "three/examples/jsm/loaders/GLTFLoader.js";

/**
 * Photographed roadblocks (Poly Haven, CC0; see public/models/CREDITS.md):
 * a striped concrete barrier for walls, a military crate (stacked two high)
 * for reward crates, and an ammo box for weapon crates.
 */
export const PROP_URLS = {
  barrier: "models/props/barrier.glb",
  crate: "models/props/crate.glb",
  ammo: "models/props/ammo.glb",
};
/** The roadblock models, ready to clone, each resting on y = 0. */
export type Props = Partial<Record<keyof typeof PROP_URLS, THREE.Object3D>>;

/**
 * A prop's scene, minus any parts `keep` turns down, re-centred so it sits on
 * the ground at the origin with shadows on.
 */
export function propModel(
  gltf: GLTF,
  keep: (name: string) => boolean = () => true,
): THREE.Object3D {
  const root = gltf.scene;
  const drop: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !keep(o.name)) drop.push(o);
  });
  for (const o of drop) o.removeFromParent();
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.castShadow = o.receiveShadow = true;
  });
  const box = new THREE.Box3().setFromObject(root);
  const centre = box.getCenter(new THREE.Vector3());
  const holder = new THREE.Group();
  root.position.set(-centre.x, -box.min.y, -centre.z);
  holder.add(root);
  return holder;
}

/** Loads a model; `progress` gets the share of it downloaded so far. */
export function loadModel(
  url: string,
  progress?: (share: number) => void,
): Promise<GLTF> {
  return new GLTFLoader().loadAsync(url, (e) => {
    if (progress && e.total) progress(e.loaded / e.total);
  });
}
