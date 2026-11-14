/**
 * The world around the road, drawn from photographs: a real sky that also
 * lights the scene, turf and gravel on the ground, and real trees.
 *
 * The pictures are CC0 assets from Poly Haven (see public/textures/CREDITS.md),
 * resized small so the game stays light on phones. The game shows a
 * loading bar until `preloadLand` has them all, so no level is ever drawn
 * half-dressed.
 */
import * as THREE from "three";

const BASE = "textures/";

/**
 * Where the sunlight comes from: behind the camera and to its left, high up,
 * so shadows fall forward along the road. The sky's photograph is turned so
 * its own sun stands here too.
 */
export const SUN_DIR = new THREE.Vector3(-8, 22, 20).normalize();
/** The haze at the horizon, which the fog fades into (linear light). */
export const HAZE = new THREE.Color().setRGB(0.55, 0.66, 0.8);

const loader = new THREE.TextureLoader();
const cache = new Map<string, THREE.Texture>();
/** A tiling texture, shared by everything that uses the same file. */
export function texture(file: string, color = true, onLoad?: () => void) {
  const hit = cache.get(file);
  if (hit) {
    if (onLoad) {
      if (hit.userData.settled) onLoad();
      else (hit.userData.waiting ??= [] as (() => void)[]).push(onLoad);
    }
    return hit;
  }
  // waiters run once the file is in, or once it has failed (the
  // material then keeps its plain colour), so loading never hangs
  const settle = () => {
    for (const f of (t.userData.waiting ?? []) as (() => void)[]) f();
    t.userData.waiting = [];
    t.userData.settled = true;
  };
  const t = loader.load(BASE + file, settle, undefined, settle);
  t.userData.waiting = onLoad ? [onLoad] : [];
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.userData.shared = true;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  cache.set(file, t);
  return t;
}

/** Repeats a geometry's texture every `size` metres along u and v. */
export function tileUv(
  geo: THREE.BufferGeometry,
  uSpan: number,
  vSpan: number,
  size: number,
) {
  const uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++)
    uv.setXY(i, (uv.getX(i) * uSpan) / size, (uv.getY(i) * vSpan) / size);
  uv.needsUpdate = true;
  return geo;
}

/** An image for painting into a canvas (crates and walls), shared. */
const images = new Map<string, HTMLImageElement>();
export function picture(file: string, onLoad: () => void) {
  let img = images.get(file);
  if (!img) {
    img = new Image();
    img.src = BASE + file;
    images.set(file, img);
  }
  if (img.complete && img.naturalWidth) return img;
  img.addEventListener("load", onLoad, { once: true });
  return null;
}

/** Every photograph a level uses, as file and whether it holds colour. */
const FILES: [string, boolean][] = [
  ["grass.jpg", true],
  ["grass-n.jpg", false],
  ["gravel.jpg", true],
  ["road.jpg", true],
  ["road-n.jpg", false],
  ["cobble.jpg", true],
  ["cobble-n.jpg", false],
  ["rock.jpg", true],
  ["wall.jpg", true],
  ["planks.jpg", true],
  ["planks-paint.jpg", true],
  ["tree.webp", true],
  ["tree-n.webp", false],
  ["fir.webp", true],
  ["fir-n.webp", false],
];
/** Pictures painted into crate and wall canvases. */
const PICTURES = ["planks.jpg", "planks-paint.jpg", "wall.jpg"];

/**
 * Loads every photograph the scenery uses. `step` is called once per file
 * as it arrives (or fails); resolves when all have settled.
 */
export function preloadLand(step: () => void) {
  const jobs: Promise<void>[] = [];
  for (const [file, color] of FILES)
    jobs.push(
      new Promise((done) =>
        texture(file, color, () => {
          step();
          done();
        }),
      ),
    );
  for (const file of PICTURES)
    jobs.push(
      new Promise((done) => {
        const finish = () => {
          step();
          done();
        };
        if (picture(file, finish)) finish();
        else
          images.get(file)?.addEventListener("error", finish, { once: true });
      }),
    );
  return { count: jobs.length, all: Promise.all(jobs) };
}

/**
 * The sky: Poly Haven's Kloofendal photograph, its top half stored with a
 * curve so one small JPG holds its range of brightness. Its foot fades into
 * the same haze as the fog. `onLoad` runs once the picture is here.
 */
export function skyDome(onLoad: (mesh: THREE.Mesh | null) => void) {
  const uniforms = {
    map: { value: null as THREE.Texture | null },
    turn: { value: 0 },
    haze: { value: HAZE },
    gain: { value: 0.62 },
  };
  const map = loader.load(
    BASE + "sky.jpg",
    () => {
      uniforms.map.value = map;
      onLoad(mesh);
    },
    undefined,
    () => onLoad(null),
  );
  map.wrapS = THREE.RepeatWrapping;
  map.minFilter = THREE.LinearFilter;
  map.generateMipmaps = false;
  // The photograph's sun is at 214.3 degrees round; ours is at SUN_DIR.
  uniforms.turn.value =
    (214.3 / 360 - 0.5) * Math.PI * 2 - Math.atan2(SUN_DIR.z, SUN_DIR.x);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    vertexShader: `varying vec3 vDir;
      void main(){
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `uniform sampler2D map; uniform float turn; uniform vec3 haze; uniform float gain;
      varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float u = (atan(d.z, d.x) + turn) / 6.2831853 + 0.5;
        float v = asin(clamp(d.y, 0.0, 1.0)) / 1.5707963;
        vec3 c = pow(texture2D(map, vec2(u, v)).rgb, vec3(2.2)) * 6.0 * gain;
        c = mix(haze, c, smoothstep(0.0, 0.12, d.y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(360, 32, 16), material);
  mesh.renderOrder = -2;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return mesh;
}

/**
 * Light from the photographed sky, for the scene's environment: soft blue
 * fill in the shade and real reflections on gold and steel.
 */
export function skyLight(renderer: THREE.WebGLRenderer, sky: THREE.Mesh) {
  const around = new THREE.Scene();
  const copy = sky.clone();
  copy.position.set(0, 0, 0);
  copy.visible = true;
  around.add(copy);
  // The meadow below the horizon bounces a little green light back up.
  const below = new THREE.Mesh(
    new THREE.SphereGeometry(300, 16, 8, 0, Math.PI * 2, Math.PI / 2),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color().setRGB(0.09, 0.12, 0.05),
      side: THREE.BackSide,
    }),
  );
  around.add(below);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(around, 0, 1, 1000).texture;
  pmrem.dispose();
  below.geometry.dispose();
  (below.material as THREE.Material).dispose();
  return env;
}

/**
 * The meadow: turf at two scales so it never shows rows, broad lighter and
 * darker patches, and a gravel shoulder along both sides of the road
 * (which runs along Z, centred on X = 0, `edge` metres to each side).
 */
export function groundMaterial(edge: number) {
  const grass = texture("grass.jpg");
  const grassN = texture("grass-n.jpg", false);
  const gravel = texture("gravel.jpg");
  const material = new THREE.MeshStandardMaterial({
    color: 0x8fcf6a,
    roughness: 0.97,
    metalness: 0,
  });
  let ready = 0;
  const done = () => {
    // Plain green until the turf arrives, then the photograph.
    if (++ready < 3) return;
    // a picture that failed to download keeps the meadow plain green
    if (!grass.image || !grassN.image || !gravel.image) return;
    material.color.set(0xffffff);
    material.userData.ready = 1;
    if (material.userData.shader)
      material.userData.shader.uniforms.landReady.value = 1;
  };
  texture("grass.jpg", true, done);
  texture("grass-n.jpg", false, done);
  texture("gravel.jpg", true, done);
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      landGrass: { value: grass },
      landGrassN: { value: grassN },
      landGravel: { value: gravel },
      landReady: { value: material.userData.ready ?? 0 },
    });
    material.userData.shader = shader;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLand;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        vLand = (modelMatrix * vec4(position, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec3 vLand;
        uniform sampler2D landGrass;
        uniform sampler2D landGrassN;
        uniform sampler2D landGravel;
        uniform float landReady;
        float landNear = 0.0;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        if (landReady > 0.5) {
          vec2 p = vLand.xz;
          vec3 turf = mix(texture2D(landGrass, p * 0.42).rgb,
                          texture2D(landGrass, p * 0.11 + 0.37).rgb, 0.4);
          // Greener than the photograph's dry field.
          turf *= vec3(0.7, 1.08, 0.5) * 1.25;
          // Broad patches, from the same picture seen from much further off.
          float patches = dot(texture2D(landGrass, p * 0.013 + 0.5).rgb, vec3(0.33));
          turf *= mix(0.78, 1.22, smoothstep(0.15, 0.45, patches));
          // Gravel along the road, with a ragged edge into the grass.
          float ax = abs(vLand.x);
          float ragged = (texture2D(landGrass, p * 0.09).g - 0.3) * 1.6;
          float shoulder = 1.0 - smoothstep(${(edge + 0.35).toFixed(2)}, ${(edge + 0.9).toFixed(2)}, ax + ragged * 0.5);
          vec3 stones = vec3(dot(texture2D(landGravel, p * 0.6).rgb, vec3(0.33))) * vec3(1.0, 0.97, 0.92) * 0.95;
          diffuseColor.rgb = mix(turf, stones, shoulder);
          landNear = 1.0 - shoulder;
        }`,
      )
      .replace(
        "#include <normal_fragment_maps>",
        `#include <normal_fragment_maps>
        if (landReady > 0.5) {
          vec3 g = texture2D(landGrassN, vLand.xz * 0.42).xyz * 2.0 - 1.0;
          vec3 wn = normalize(vec3(0.0, 1.0, 0.0) + vec3(g.x, 0.0, -g.y) * 0.6 * landNear);
          normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
        }`,
      );
  };
  return material;
}

// ---- trees ----------------------------------------------------------------

// Real trees (Poly Haven, CC0) are far too many triangles to line a road
// with. Each was photographed in the round ahead of time, eight views of its
// colour and eight of which way its surfaces face, and a tree in the scene
// is one flat card that turns to the camera and shows the nearest view, lit
// by the scene's own sun.
const VIEWS = 8;
const SPECIES = [
  // Sizes in metres, as measured when the views were made.
  { file: "tree", halfW: 2.232, halfH: 2.79, tall: 4.557, grow: 2.9 },
  { file: "fir", halfW: 2.743, halfH: 5.487, tall: 8.89, grow: 2.0 },
];
export const TREE_KINDS = SPECIES.length;
export type TreeSpot = { x: number; z: number; s: number; kind: number };

const treeMaterials: THREE.ShaderMaterial[] = [];
function treeMaterial(kind: number) {
  if (treeMaterials[kind]) return treeMaterials[kind];
  const sp = SPECIES[kind];
  const colour = texture(`${sp.file}.webp`);
  const facing = texture(`${sp.file}-n.webp`, false);
  for (const t of [colour, facing])
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      colour: { value: colour },
      facing: { value: facing },
      sun: { value: SUN_DIR },
      size: { value: new THREE.Vector3(sp.halfW, sp.halfH, sp.tall) },
    },
    fog: true,
    vertexShader: `
        attribute vec4 at; attribute vec2 turn;
        uniform vec3 size;
        varying vec2 vUv; varying vec2 vFrame; varying float vYaw; varying float vShade;
        #include <fog_pars_vertex>
        void main(){
          vec3 base = (modelMatrix * vec4(at.xyz, 1.0)).xyz;
          vec3 toCam = cameraPosition - base;
          float around = atan(toCam.z, toCam.x);
          vec3 right = vec3(sin(around), 0.0, -cos(around));
          // Seen from above, the card leans back so it never shows edge-on.
          vec3 flatDir = normalize(vec3(toCam.x, 0.0, toCam.z));
          float pitch = clamp(toCam.y / length(toCam), 0.0, 1.0);
          vec3 up = normalize(vec3(0.0, 1.0, 0.0) - flatDir * smoothstep(0.35, 0.95, pitch) * 1.1);
          float h = size.z * 0.5 + position.y * size.y;
          vec3 world = base + (right * position.x * size.x + up * h) * at.w;
          vUv = position.xy * 0.5 + 0.5;
          float f = (around + turn.x) / 6.2831853 * ${VIEWS}.0;
          vFrame = vec2(floor(f + 0.5), fract(f + 0.5));
          vYaw = turn.x;
          vShade = turn.y;
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          // A tree right by the lens is not drawn: up close its picture
          // would be too coarse, and it would hide the road.
          if (length(toCam) - size.x * at.w < 9.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          #include <fog_vertex>
        }`,
    fragmentShader: `
        uniform sampler2D colour; uniform sampler2D facing; uniform vec3 sun;
        varying vec2 vUv; varying vec2 vFrame; varying float vYaw; varying float vShade;
        #include <fog_pars_fragment>
        void main(){
          vec2 uv = vec2((mod(vFrame.x, ${VIEWS}.0) + vUv.x) / ${VIEWS}.0, vUv.y);
          vec4 c = texture2D(colour, uv);
          if (c.a < 0.45) discard;
          vec3 n = texture2D(facing, uv).xyz * 2.0 - 1.0;
          float cy = cos(vYaw); float sy = sin(vYaw);
          n = normalize(vec3(cy * n.x + sy * n.z, n.y, -sy * n.x + cy * n.z));
          // Leaves let some light through, so the sunlit side wraps round.
          float lit = max((dot(n, sun) + 0.4) / 1.4, 0.0);
          vec3 leaf = c.rgb * mix(vec3(0.95, 1.12, 0.8), vec3(1.2, 1.25, 0.85), vShade) * 1.9;
          vec3 light = vec3(1.0, 0.95, 0.86) * 1.3 * lit
                     + vec3(0.24, 0.3, 0.4) * (0.5 + 0.5 * n.y);
          // Darker toward the foot, where the crown shades the trunk.
          light *= mix(0.6, 1.0, smoothstep(0.05, 0.5, vUv.y));
          gl_FragColor = vec4(leaf * light, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
  });
  treeMaterials[kind] = m;
  return m;
}

/** Height in metres of a tree of this kind at scale 1. */
export const treeHeight = (kind: number) =>
  (SPECIES[kind].tall * SPECIES[kind].grow) / 3;

/** One mesh per kind of tree, drawing every tree at `spots` as a card. */
export function forest(spots: TreeSpot[], hash: (v: number) => number) {
  const meshes: THREE.Mesh[] = [];
  SPECIES.forEach((sp, kind) => {
    const mine = spots.filter((s) => s.kind === kind);
    if (!mine.length) return;
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0],
        3,
      ),
    );
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    const at = new Float32Array(mine.length * 4);
    const turn = new Float32Array(mine.length * 2);
    mine.forEach((s, i) => {
      at.set([s.x, -0.05, s.z, (sp.grow * s.s) / 3], i * 4);
      // A turn of its own, and its own shade of green.
      turn.set([hash(s.x * 3.1 + s.z) * 6.283, hash(s.z * 1.7 - s.x)], i * 2);
    });
    geo.setAttribute("at", new THREE.InstancedBufferAttribute(at, 4));
    geo.setAttribute("turn", new THREE.InstancedBufferAttribute(turn, 2));
    geo.instanceCount = mine.length;
    const mesh = new THREE.Mesh(geo, treeMaterial(kind));
    mesh.frustumCulled = false;
    meshes.push(mesh);
  });
  return meshes;
}

let shadeTex: THREE.CanvasTexture | null = null;
/** A soft round shadow texture, for the shade under trees. */
export function shadeTexture() {
  if (shadeTex) return shadeTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, "rgba(0,0,0,1)");
    r.addColorStop(0.55, "rgba(0,0,0,0.75)");
    r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  }
  shadeTex = new THREE.CanvasTexture(c);
  shadeTex.userData.shared = true;
  return shadeTex;
}

/**
 * Far hills all round, blue with distance, standing in the haze past where
 * the fog hides the meadow. Follows the camera, so they never come nearer.
 */
export function farHills() {
  const seg = 160;
  const pos: number[] = [];
  const shade: number[] = [];
  const idx: number[] = [];
  const R = 300;
  const wave = (a: number, f: number, p: number) => Math.sin(a * f + p);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    // two ranges: low wooded hills in front of taller blue ones
    const h =
      16 +
      9 * wave(a, 3, 0.4) +
      6 * wave(a, 7, 1.9) +
      3 * wave(a, 17, 0.7) +
      1.5 * wave(a, 41, 2.2);
    const x = Math.cos(a) * R;
    const z = Math.sin(a) * R;
    pos.push(x, -4, z, x, Math.max(4, h), z);
    shade.push(0, 1);
    if (i < seg) {
      const k = i * 2;
      idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("shade", new THREE.Float32BufferAttribute(shade, 1));
  geo.setIndex(idx);
  const material = new THREE.ShaderMaterial({
    uniforms: { haze: { value: HAZE } },
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `attribute float shade; varying float vShade;
      void main(){ vShade = shade; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `uniform vec3 haze; varying float vShade;
      void main(){
        vec3 hill = vec3(0.2, 0.3, 0.36);
        // lighter toward the foot, where the haze is thickest
        vec3 c = mix(haze, hill, 0.38 + 0.2 * vShade);
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, material);
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
  return mesh;
}
