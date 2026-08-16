import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { WorldPreset } from "../types";

export type WorldMaterialSet = {
  plaster: THREE.MeshStandardMaterial;
  plasterRose: THREE.MeshStandardMaterial;
  plasterCool: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  stoneLight: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial;
  roofGold: THREE.MeshStandardMaterial;
  timber: THREE.MeshStandardMaterial;
  timberDark: THREE.MeshStandardMaterial;
  copper: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  foliageLight: THREE.MeshStandardMaterial;
  island: THREE.MeshStandardMaterial;
  grass: THREE.MeshStandardMaterial;
  window: THREE.MeshStandardMaterial;
  windowRose: THREE.MeshStandardMaterial;
};

export type WorldAnimation = {
  object: THREE.Object3D;
  mode: "spin-z" | "spin-y" | "float" | "sway";
  speed: number;
  phase: number;
  baseY: number;
};

type UniformRef<T> = { value: T };

function seeded(index: number, salt = 0) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

export class SceneMapFactory {
  private readonly snow = new THREE.MeshStandardMaterial({ color: 0xdde8ef, roughness: 0.96 });
  private readonly ice = new THREE.MeshPhysicalMaterial({
    color: 0x8fc8d7,
    roughness: 0.22,
    metalness: 0.08,
    transparent: true,
    opacity: 0.72,
  });
  private readonly cloud = new THREE.MeshStandardMaterial({
    color: 0xb8c9dc,
    roughness: 1,
    transparent: true,
    opacity: 0.68,
    depthWrite: false,
  });
  private readonly rune = new THREE.MeshStandardMaterial({
    color: 0x7ce2bd,
    emissive: 0x176f59,
    emissiveIntensity: 1.5,
    roughness: 0.38,
    metalness: 0.16,
    toneMapped: false,
  });
  private readonly lighthouseWhite = new THREE.MeshStandardMaterial({ color: 0xd7cda9, roughness: 0.9 });
  private readonly lighthouseRed = new THREE.MeshStandardMaterial({ color: 0x9d493f, roughness: 0.82 });

  constructor(
    private readonly materials: WorldMaterialSet,
    private readonly registerAnimation: (animation: WorldAnimation) => void,
    private readonly timeUniform: UniformRef<number>,
    private readonly pixelRatioUniform: UniformRef<number>,
  ) {}

  build(preset: Exclude<WorldPreset, "magic-city">) {
    switch (preset) {
      case "cloud-citadel":
        return this.createCloudCitadel();
      case "snow-belltower":
        return this.createSnowBelltower();
      case "enchanted-ruins":
        return this.createEnchantedRuins();
      case "moonlit-harbor":
        return this.createMoonlitHarbor();
    }
  }

  private createCloudCitadel() {
    const map = new THREE.Group();
    map.name = "cloud-citadel-map";
    const islands: Array<[number, number, number, number, number, number]> = [
      [0, 4.8, -46, 13.5, 5.7, 9],
      [-16, 3.2, -40, 8.3, 4.2, 6.4],
      [16, 3.6, -42, 8.8, 4.4, 6.8],
      [-9.5, 0.8, -55, 6.5, 3.6, 5.1],
      [10.5, 1.2, -56, 6.9, 3.8, 5.4],
    ];
    islands.forEach(([x, y, z, sx, sy, sz], index) => {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 2), this.materials.island);
      rock.position.set(x, y, z);
      rock.scale.set(sx, sy, sz);
      rock.rotation.y = index * 0.42;
      rock.castShadow = true;
      rock.receiveShadow = true;
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 18), this.materials.grass);
      cap.position.set(x, y + sy * 0.56, z);
      cap.scale.set(sx * 0.9, 0.95, sz * 0.88);
      cap.receiveShadow = true;
      map.add(rock, cap);
      this.createCloudBank(map, x - sx * 0.72, y - sy * 0.7, z + 1, sx * 0.24, 5 + index);
    });

    this.createSkyPalace(map);
    this.createCloudVillage(map, -16, 6, -40, 0.88, 1);
    this.createCloudVillage(map, 16, 6.4, -42, 0.94, 2);
    this.createBridge(map, new THREE.Vector3(-9, 7.6, -43), new THREE.Vector3(-5.6, 9.2, -46));
    this.createBridge(map, new THREE.Vector3(6.2, 9.2, -46), new THREE.Vector3(10.2, 7.8, -43));
    this.createAirship(map, -13, 16, -32, 1.05, 0.3);
    this.createAirship(map, 18, 20, -56, 0.78, 2.1);

    const skyLight = new THREE.PointLight(0x8bd8de, 2.6, 48, 1.8);
    skyLight.position.set(0, 12, -45);
    map.add(skyLight);
    return map;
  }

  private createSkyPalace(parent: THREE.Group) {
    const palace = new THREE.Group();
    palace.position.set(0, 8.2, -46);
    const base = new THREE.Mesh(new RoundedBoxGeometry(11.5, 5.5, 7.4, 8, 0.28), this.materials.plasterCool);
    base.position.y = 2.7;
    base.castShadow = true;
    base.receiveShadow = true;
    palace.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, 3.3, 4), this.materials.roofGold);
    roof.position.y = 6.7;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(8.9, 1, 5.7);
    palace.add(roof);
    for (const x of [-4.7, 0, 4.7]) {
      const towerHeight = x === 0 ? 10.5 : 8.3;
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.85, towerHeight, 28), this.materials.plaster);
      tower.position.set(x, towerHeight * 0.5 + 2.2, -0.2);
      tower.castShadow = true;
      const spire = new THREE.Mesh(new THREE.ConeGeometry(2.05, x === 0 ? 5.1 : 4.2, 28), this.materials.roof);
      spire.position.set(x, towerHeight + 4.5, -0.2);
      const window = this.createArchedWindow(0.68, 1.45, x === 0);
      window.position.set(x, towerHeight * 0.62 + 2.2, 1.68);
      palace.add(tower, spire, window);
    }
    const gate = this.createArchedWindow(1.6, 3.1, true);
    gate.position.set(0, 2, 3.74);
    palace.add(gate);
    parent.add(palace);
  }

  private createCloudVillage(parent: THREE.Group, x: number, y: number, z: number, scale: number, salt: number) {
    const village = new THREE.Group();
    village.position.set(x, y, z);
    village.scale.setScalar(scale);
    for (let index = 0; index < 4; index += 1) {
      const angle = (index / 4) * Math.PI * 2 + salt * 0.32;
      this.createHouse(village, Math.cos(angle) * 3.1, Math.sin(angle) * 2.1, 2.6, 2.4, 3.4 + (index % 2), angle * 0.08, index);
    }
    const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.52, 1), this.rune);
    beacon.position.set(0, 6.2, 0);
    village.add(beacon);
    this.registerAnimation({ object: beacon, mode: "float", speed: 0.8, phase: salt, baseY: beacon.position.y });
    parent.add(village);
  }

  private createBridge(parent: THREE.Group, from: THREE.Vector3, to: THREE.Vector3) {
    const midpoint = from.clone().lerp(to, 0.5);
    midpoint.y -= 0.65;
    const curve = new THREE.CatmullRomCurve3([from, midpoint, to]);
    const bridge = new THREE.Mesh(new THREE.TubeGeometry(curve, 36, 0.42, 8, false), this.materials.stoneLight);
    bridge.castShadow = true;
    parent.add(bridge);
    for (const offset of [-0.55, 0.55]) {
      const railPoints = [from, midpoint, to].map((point) => point.clone().add(new THREE.Vector3(offset, 0.5, 0)));
      parent.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(railPoints), 36, 0.07, 6, false), this.materials.copper));
    }
  }

  private createAirship(parent: THREE.Group, x: number, y: number, z: number, scale: number, phase: number) {
    const airship = new THREE.Group();
    airship.position.set(x, y, z);
    airship.scale.setScalar(scale);
    const balloon = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 22), this.materials.plasterRose);
    balloon.scale.set(3.7, 1.65, 1.65);
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.12, 0.08, 8, 42), this.materials.copper);
    band.rotation.y = Math.PI / 2;
    band.scale.set(1, 1.65, 1.65);
    const gondola = new THREE.Mesh(new RoundedBoxGeometry(2.15, 0.66, 0.8, 5, 0.16), this.materials.timberDark);
    gondola.position.y = -1.65;
    const propeller = new THREE.Group();
    propeller.position.set(-3.85, -0.15, 0);
    for (let index = 0; index < 3; index += 1) {
      const arm = new THREE.Group();
      arm.rotation.z = (index / 3) * Math.PI * 2;
      const blade = new THREE.Mesh(new RoundedBoxGeometry(0.15, 1.45, 0.12, 3, 0.04), this.materials.timber);
      blade.position.y = 0.65;
      arm.add(blade);
      propeller.add(arm);
    }
    airship.add(balloon, band, gondola, propeller);
    parent.add(airship);
    this.registerAnimation({ object: airship, mode: "float", speed: 0.28, phase, baseY: y });
    this.registerAnimation({ object: propeller, mode: "spin-z", speed: 1.9, phase, baseY: propeller.position.y });
  }

  private createCloudBank(parent: THREE.Group, x: number, y: number, z: number, scale: number, salt: number) {
    const bank = new THREE.Group();
    bank.position.set(x, y, z);
    for (let index = 0; index < 8; index += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1.4 + seeded(index, salt) * 1.6, 24, 16), this.cloud);
      puff.position.set(index * scale * 0.55, seeded(index, salt + 1) * 0.8, (seeded(index, salt + 2) - 0.5) * 3.2);
      puff.scale.y = 0.56;
      bank.add(puff);
    }
    parent.add(bank);
  }

  private createSnowBelltower() {
    const map = new THREE.Group();
    map.name = "snow-belltower-map";
    const ground = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 2), this.materials.island);
    ground.position.set(0, -1.8, -43);
    ground.scale.set(27, 4.8, 15.8);
    const snowCap = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 22), this.snow);
    snowCap.position.set(0, 0.45, -43);
    snowCap.scale.set(25, 1.4, 13.8);
    snowCap.receiveShadow = true;
    map.add(ground, snowCap);

    const ice = new THREE.Mesh(new THREE.PlaneGeometry(15, 28, 12, 20), this.ice);
    ice.rotation.x = -Math.PI / 2;
    ice.position.set(0, 1.02, -42.5);
    map.add(ice);
    this.createBellTower(map);
    const houses: Array<[number, number, number]> = [
      [-14, -36, 0], [-9.5, -35, 1], [-5.2, -36.5, 2], [5.4, -36, 1], [10, -35.2, 0], [14.2, -37, 2],
      [-13, -43, 1], [-8.2, -43.5, 2], [8.2, -43, 0], [13, -43.8, 1],
      [-11, -50, 0], [-6.5, -50.8, 2], [6.7, -51, 1], [11.4, -50.2, 0],
    ];
    houses.forEach(([x, z, style], index) => this.createSnowHouse(map, x, 1.35, z, style, index));
    for (let index = 0; index < 18; index += 1) {
      const side = index % 2 ? -1 : 1;
      this.createPine(map, side * (16 + (index % 4) * 1.7), 1.1, -33 - Math.floor(index / 4) * 4.5, 0.8 + (index % 3) * 0.14);
    }
    this.createSnowfall(map);
    const warmLight = new THREE.PointLight(0xffa35f, 3.1, 55, 1.8);
    warmLight.position.set(0, 9, -43);
    map.add(warmLight);
    return map;
  }

  private createBellTower(parent: THREE.Group) {
    const tower = new THREE.Group();
    tower.position.set(0, 1.3, -46);
    const base = new THREE.Mesh(new RoundedBoxGeometry(7.4, 14.5, 7.2, 8, 0.25), this.materials.stoneLight);
    base.position.y = 7.25;
    base.castShadow = true;
    const upper = new THREE.Mesh(new RoundedBoxGeometry(5.6, 6.4, 5.6, 7, 0.2), this.materials.plasterCool);
    upper.position.y = 15.3;
    upper.castShadow = true;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(4.55, 6.4, 24), this.materials.roof);
    roof.position.y = 21.7;
    const snowRoof = new THREE.Mesh(new THREE.ConeGeometry(4.68, 1.45, 24, 1, true), this.snow);
    snowRoof.position.y = 24.2;
    tower.add(base, upper, roof, snowRoof);
    const gate = this.createArchedWindow(1.55, 3.3, false);
    gate.position.set(0, 2.2, 3.62);
    tower.add(gate);
    for (const y of [9.5, 16.2]) {
      const window = this.createArchedWindow(0.78, 1.55, y > 12);
      window.position.set(0, y, 3.63);
      tower.add(window);
    }
    const clockFace = new THREE.Mesh(new THREE.CircleGeometry(1.32, 48), new THREE.MeshStandardMaterial({
      color: 0xeee4c9,
      emissive: 0xb86a39,
      emissiveIntensity: 0.28,
      roughness: 0.8,
    }));
    clockFace.position.set(0, 16.7, 3.68);
    tower.add(clockFace);
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      const mark = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.28, 0.06, 2, 0.02), this.materials.timberDark);
      mark.position.set(Math.sin(angle) * 1.02, 16.7 + Math.cos(angle) * 1.02, 3.72);
      mark.rotation.z = -angle;
      tower.add(mark);
    }
    const minute = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.9, 0.07, 2, 0.02), this.materials.timberDark);
    minute.position.set(0, 17.1, 3.76);
    minute.rotation.z = -0.65;
    tower.add(minute);
    parent.add(tower);
  }

  private createSnowHouse(parent: THREE.Group, x: number, y: number, z: number, style: number, index: number) {
    const house = this.createHouse(parent, x, z, 3.5, 3.15, 4 + (index % 3) * 0.65, (index % 2 ? -1 : 1) * 0.08, style, y);
    const roofHeight = 2.25;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1, roofHeight * 0.32, 4, 1, true), this.snow);
    cap.position.set(x, y + 4 + (index % 3) * 0.65 + roofHeight * 0.86, z);
    cap.rotation.y = Math.PI / 4 + ((index % 2 ? -1 : 1) * 0.08);
    cap.scale.set(2.82, 1, 2.58);
    parent.add(cap);
    return house;
  }

  private createPine(parent: THREE.Group, x: number, y: number, z: number, scale: number) {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.25, 2.7, 10), this.materials.timberDark);
    trunk.position.set(x, y + 1.2, z);
    parent.add(trunk);
    for (let level = 0; level < 3; level += 1) {
      const foliage = new THREE.Mesh(new THREE.ConeGeometry((1.45 - level * 0.22) * scale, 2.5 * scale, 18), this.materials.foliage);
      foliage.position.set(x, y + 2.2 + level * 1.3 * scale, z);
      parent.add(foliage);
      const snow = new THREE.Mesh(new THREE.ConeGeometry((1.5 - level * 0.22) * scale, 0.42 * scale, 18, 1, true), this.snow);
      snow.position.set(x, y + 3.25 + level * 1.3 * scale, z);
      parent.add(snow);
    }
  }

  private createSnowfall(parent: THREE.Group) {
    const count = 680;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (seeded(index, 101) - 0.5) * 58;
      positions[index * 3 + 1] = seeded(index, 102) * 30;
      positions[index * 3 + 2] = -10 - seeded(index, 103) * 65;
      phases[index] = seeded(index, 104) * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    parent.add(new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: { uTime: this.timeUniform, uPixelRatio: this.pixelRatioUniform },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.y = mod(position.y - uTime * (1.1 + fract(aPhase) * 0.8), 30.0);
          p.x += sin(uTime * 0.42 + aPhase) * 0.75;
          vAlpha = 0.28 + fract(aPhase) * 0.42;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (1.3 + fract(aPhase) * 2.2) * uPixelRatio * clamp(18.0 / -mvPosition.z, 0.7, 2.2);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float alpha = (1.0 - smoothstep(0.08, 0.5, length(gl_PointCoord - 0.5))) * vAlpha;
          gl_FragColor = vec4(0.9, 0.96, 1.0, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })));
  }

  private createEnchantedRuins() {
    const map = new THREE.Group();
    map.name = "enchanted-ruins-map";
    const ground = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 2), this.materials.island);
    ground.position.set(0, -2, -43);
    ground.scale.set(28, 5, 16.5);
    const moss = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 22), this.materials.grass);
    moss.position.set(0, 0.38, -43);
    moss.scale.set(25.5, 1.65, 14.2);
    map.add(ground, moss);
    this.createMoonGate(map);
    for (const [x, z, scale, phase] of [
      [-18, -36, 1.25, 0], [-15, -49, 1.05, 1], [-9, -55, 0.95, 2],
      [18, -37, 1.22, 3], [15, -49, 1.08, 4], [8.5, -56, 0.92, 5],
    ] as Array<[number, number, number, number]>) {
      this.createAncientTree(map, x, 1.1, z, scale, phase);
    }
    this.createRuinedArcade(map, -11, 1.1, -42, -0.12);
    this.createRuinedArcade(map, 11, 1.1, -43, 0.12);
    this.createRunePath(map);
    this.createMushrooms(map);
    this.createForestWisps(map);
    const greenLight = new THREE.PointLight(0x58d6a9, 3.4, 54, 1.7);
    greenLight.position.set(0, 8.5, -43);
    map.add(greenLight);
    return map;
  }

  private createMoonGate(parent: THREE.Group) {
    const gate = new THREE.Group();
    gate.position.set(0, 1.1, -46);
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(7, 8.2, 1.25, 32), this.materials.stoneDark);
    platform.position.y = 0.35;
    gate.add(platform);
    for (const x of [-5.2, 5.2]) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.95, 10.5, 20), this.materials.stone);
      column.position.set(x, 5.8, 0);
      column.castShadow = true;
      gate.add(column);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(5.2, 0.72, 18, 80, Math.PI), this.materials.stoneLight);
    arch.position.set(0, 8.8, 0);
    gate.add(arch);
    const runeRing = new THREE.Mesh(new THREE.TorusGeometry(3.9, 0.1, 10, 96), this.rune);
    runeRing.position.set(0, 7.2, 0.18);
    gate.add(runeRing);
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      const rune = new THREE.Mesh(new THREE.OctahedronGeometry(0.16, 0), this.rune);
      rune.position.set(Math.cos(angle) * 3.9, 7.2 + Math.sin(angle) * 3.9, 0.22);
      gate.add(rune);
    }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.72, 28, 22), new THREE.MeshBasicMaterial({
      color: 0x8df6d3,
      transparent: true,
      opacity: 0.74,
      toneMapped: false,
    }));
    orb.position.set(0, 7.2, 0.25);
    gate.add(orb);
    this.registerAnimation({ object: runeRing, mode: "spin-z", speed: 0.08, phase: 0, baseY: runeRing.position.y });
    this.registerAnimation({ object: orb, mode: "float", speed: 0.72, phase: 0.5, baseY: orb.position.y });
    parent.add(gate);
  }

  private createAncientTree(parent: THREE.Group, x: number, y: number, z: number, scale: number, phase: number) {
    const tree = new THREE.Group();
    tree.position.set(x, y, z);
    tree.scale.setScalar(scale);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 1.35, 9.5, 14), this.materials.timberDark);
    trunk.position.y = 4.5;
    trunk.rotation.z = (phase % 2 ? -1 : 1) * 0.05;
    tree.add(trunk);
    for (let branch = 0; branch < 5; branch += 1) {
      const limb = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.42, 5.2, 10), this.materials.timberDark);
      const angle = (branch / 5) * Math.PI * 2 + phase;
      limb.position.set(Math.cos(angle) * 1.2, 7 + (branch % 2) * 0.8, Math.sin(angle) * 1.2);
      limb.rotation.z = Math.cos(angle) * 0.78;
      limb.rotation.x = Math.sin(angle) * 0.62;
      tree.add(limb);
    }
    for (let cluster = 0; cluster < 8; cluster += 1) {
      const angle = (cluster / 8) * Math.PI * 2 + phase * 0.3;
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(2.15 + (cluster % 3) * 0.28, 2), cluster % 2 ? this.materials.foliage : this.materials.foliageLight);
      crown.position.set(Math.cos(angle) * 2.5, 9.1 + (cluster % 3) * 0.8, Math.sin(angle) * 2.1);
      crown.scale.set(1.2, 0.9, 1);
      tree.add(crown);
    }
    parent.add(tree);
  }

  private createRuinedArcade(parent: THREE.Group, x: number, y: number, z: number, rotation: number) {
    const arcade = new THREE.Group();
    arcade.position.set(x, y, z);
    arcade.rotation.y = rotation;
    for (const side of [-1.8, 1.8]) {
      const column = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.55, 6.2, 16), this.materials.stone);
      column.position.set(side, 3.1, 0);
      arcade.add(column);
    }
    const arch = new THREE.Mesh(new THREE.TorusGeometry(1.8, 0.44, 12, 48, Math.PI), this.materials.stoneLight);
    arch.position.y = 5.4;
    arcade.add(arch);
    const ivy = new THREE.Mesh(new THREE.TorusGeometry(1.95, 0.08, 8, 36, Math.PI * 0.78), this.materials.foliageLight);
    ivy.position.set(0.1, 5.45, 0.18);
    arcade.add(ivy);
    parent.add(arcade);
  }

  private createRunePath(parent: THREE.Group) {
    for (let index = 0; index < 11; index += 1) {
      const stone = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.82, 0.18, 8), index % 3 === 0 ? this.rune : this.materials.stoneDark);
      stone.position.set(Math.sin(index * 0.62) * 1.4, 1.22, -30 - index * 1.55);
      stone.rotation.y = index * 0.7;
      parent.add(stone);
    }
  }

  private createMushrooms(parent: THREE.Group) {
    for (let index = 0; index < 34; index += 1) {
      const side = index % 2 ? -1 : 1;
      const x = side * (5 + seeded(index, 131) * 15);
      const z = -31 - seeded(index, 132) * 24;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.42, 8), this.materials.plasterCool);
      stem.position.set(x, 1.42, z);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.22 + seeded(index, 133) * 0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), index % 3 ? this.rune : this.materials.windowRose);
      cap.position.set(x, 1.65, z);
      parent.add(stem, cap);
    }
  }

  private createForestWisps(parent: THREE.Group) {
    const count = 180;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (seeded(index, 141) - 0.5) * 48;
      positions[index * 3 + 1] = 1.2 + seeded(index, 142) * 12;
      positions[index * 3 + 2] = -28 - seeded(index, 143) * 30;
      phases[index] = seeded(index, 144) * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    parent.add(new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: { uTime: this.timeUniform, uPixelRatio: this.pixelRatioUniform },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.44 + aPhase) * 0.45;
          p.y += cos(uTime * 0.36 + aPhase * 1.7) * 0.35;
          vAlpha = 0.15 + pow(max(0.0, sin(uTime * 1.1 + aPhase)), 3.0) * 0.7;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (2.0 + fract(aPhase) * 2.4) * uPixelRatio * clamp(20.0 / -mvPosition.z, 0.7, 2.3);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float alpha = (1.0 - smoothstep(0.06, 0.5, length(gl_PointCoord - 0.5))) * vAlpha;
          gl_FragColor = vec4(0.38, 1.0, 0.72, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })));
  }

  private createMoonlitHarbor() {
    const map = new THREE.Group();
    map.name = "moonlit-harbor-map";
    const cliff = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 2), this.materials.island);
    cliff.position.set(4, -2.2, -44);
    cliff.scale.set(28, 5.2, 16.5);
    const grass = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 22), this.materials.grass);
    grass.position.set(5, 0.32, -45);
    grass.scale.set(24, 1.55, 13.8);
    map.add(cliff, grass);
    this.createLighthouse(map, -13.5, 1.1, -43);
    this.createHarborTown(map);
    this.createPiers(map);
    this.createSailboat(map, -4.5, -0.08, -29, 1, -0.05);
    this.createSailboat(map, 12, -0.1, -28, 0.72, 0.08);
    this.createSailboat(map, 2, -0.15, -24, 0.55, -0.1);
    for (let index = 0; index < 9; index += 1) {
      const buoy = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), index % 2 ? this.materials.window : this.lighthouseRed);
      buoy.position.set(-10 + index * 2.8, 0.02, -22 - (index % 3) * 2.2);
      map.add(buoy);
      this.registerAnimation({ object: buoy, mode: "float", speed: 0.72 + index * 0.03, phase: index, baseY: buoy.position.y });
    }
    const harborLight = new THREE.PointLight(0xffa45f, 3.5, 58, 1.8);
    harborLight.position.set(6, 7, -41);
    map.add(harborLight);
    return map;
  }

  private createLighthouse(parent: THREE.Group, x: number, y: number, z: number) {
    const lighthouse = new THREE.Group();
    lighthouse.position.set(x, y, z);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 3.15, 14.5, 36), this.lighthouseWhite);
    base.position.y = 7.25;
    base.castShadow = true;
    lighthouse.add(base);
    for (const level of [3.8, 8.4]) {
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(2.58 - level * 0.045, 2.7 - level * 0.045, 1.65, 36), this.lighthouseRed);
      stripe.position.y = level;
      lighthouse.add(stripe);
    }
    const gallery = new THREE.Mesh(new THREE.CylinderGeometry(2.55, 2.55, 0.45, 36), this.materials.copper);
    gallery.position.y = 14.4;
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, 2.1, 28), new THREE.MeshStandardMaterial({
      color: 0xffd79c,
      emissive: 0xffa54d,
      emissiveIntensity: 1.8,
      transparent: true,
      opacity: 0.68,
      roughness: 0.18,
      toneMapped: false,
    }));
    glass.position.y = 15.65;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.15, 2.2, 28), this.lighthouseRed);
    roof.position.y = 17.75;
    lighthouse.add(gallery, glass, roof);
    const window = this.createArchedWindow(0.7, 1.35);
    window.position.set(0, 7.2, 2.55);
    lighthouse.add(window);

    const beacon = new THREE.Group();
    beacon.position.y = 15.65;
    const beam = new THREE.Mesh(new THREE.ConeGeometry(3.2, 22, 32, 1, true), new THREE.MeshBasicMaterial({
      color: 0xffd596,
      transparent: true,
      opacity: 0.055,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }));
    beam.rotation.z = Math.PI / 2;
    beam.position.x = 10.5;
    const lamp = new THREE.PointLight(0xffd49a, 2.6, 36, 1.6);
    beacon.add(beam, lamp);
    lighthouse.add(beacon);
    parent.add(lighthouse);
    this.registerAnimation({ object: beacon, mode: "spin-y", speed: 0.22, phase: 0, baseY: beacon.position.y });
  }

  private createHarborTown(parent: THREE.Group) {
    const houses: Array<[number, number, number]> = [
      [-5.5, -38, 0], [-1.5, -36.5, 1], [3, -36, 2], [7.5, -36.8, 0], [12, -37.5, 1], [16, -39, 2],
      [-5, -43, 2], [-0.5, -42, 0], [4, -42.5, 1], [8.5, -42, 2], [13, -43, 0], [17, -45, 1],
      [-3, -48.5, 1], [2, -48, 2], [7, -48.5, 0], [12, -49, 1],
    ];
    houses.forEach(([x, z, style], index) => this.createHouse(parent, x, z, 3.4 + (index % 2) * 0.4, 3.1, 4 + (index % 3) * 0.65, (index % 2 ? -1 : 1) * 0.08, style, 1.25));
  }

  private createPiers(parent: THREE.Group) {
    for (const x of [-6, 3, 12]) {
      const pier = new THREE.Mesh(new RoundedBoxGeometry(2.2, 0.35, 12, 5, 0.1), this.materials.timber);
      pier.position.set(x, 0.15, -27);
      parent.add(pier);
      for (const side of [-0.85, 0.85]) {
        for (let z = -32; z <= -22; z += 2.2) {
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 1.5, 8), this.materials.timberDark);
          post.position.set(x + side, -0.25, z);
          parent.add(post);
        }
      }
    }
  }

  private createSailboat(parent: THREE.Group, x: number, y: number, z: number, scale: number, rotation: number) {
    const boat = new THREE.Group();
    boat.position.set(x, y, z);
    boat.rotation.y = rotation;
    boat.scale.setScalar(scale);
    const hull = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, Math.PI * 0.46, Math.PI * 0.52), this.materials.timberDark);
    hull.scale.set(2.8, 1, 0.95);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 5.8, 8), this.materials.copper);
    mast.position.y = 2.4;
    const sailShape = new THREE.Shape();
    sailShape.moveTo(0.12, 0.2);
    sailShape.lineTo(0.12, 4.8);
    sailShape.lineTo(2.15, 0.75);
    sailShape.closePath();
    const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), this.materials.plasterCool);
    sail.position.set(0.1, 0.2, 0);
    boat.add(hull, mast, sail);
    parent.add(boat);
    this.registerAnimation({ object: boat, mode: "float", speed: 0.5, phase: x, baseY: y });
  }

  private createHouse(
    parent: THREE.Group,
    x: number,
    z: number,
    width: number,
    depth: number,
    height: number,
    rotation: number,
    materialIndex: number,
    baseY = 1.25,
  ) {
    const group = new THREE.Group();
    group.position.set(x, baseY, z);
    group.rotation.y = rotation;
    const bodyMaterial = [this.materials.plaster, this.materials.plasterRose, this.materials.plasterCool][materialIndex % 3];
    const body = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 5, 0.16), bodyMaterial);
    body.position.y = height * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    const roofHeight = 2.1;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, roofHeight, 4), materialIndex % 2 ? this.materials.roof : this.materials.roofGold);
    roof.position.y = height + roofHeight * 0.48;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(width * 0.78, 1, depth * 0.78);
    roof.castShadow = true;
    group.add(body, roof);
    const beam = new THREE.Mesh(new RoundedBoxGeometry(width * 0.9, 0.15, 0.16, 3, 0.04), this.materials.timber);
    beam.position.set(0, height * 0.56, depth * 0.51);
    group.add(beam);
    for (const side of [-1, 1]) {
      const window = this.createArchedWindow(0.54, 0.98, materialIndex === 2);
      window.position.set(side * width * 0.24, Math.min(height - 1.1, 1.65), depth * 0.515);
      group.add(window);
    }
    parent.add(group);
    return group;
  }

  private createArchedWindow(width: number, height: number, rose = false) {
    const group = new THREE.Group();
    const makeShape = (w: number, h: number) => {
      const shape = new THREE.Shape();
      shape.moveTo(-w / 2, -h / 2);
      shape.lineTo(w / 2, -h / 2);
      shape.lineTo(w / 2, h / 2 - w / 2);
      shape.absarc(0, h / 2 - w / 2, w / 2, 0, Math.PI, false);
      shape.closePath();
      return shape;
    };
    const frame = new THREE.Mesh(new THREE.ShapeGeometry(makeShape(width * 1.22, height * 1.14)), this.materials.timber);
    const glass = new THREE.Mesh(new THREE.ShapeGeometry(makeShape(width, height)), rose ? this.materials.windowRose : this.materials.window);
    glass.position.z = 0.012;
    group.add(frame, glass);
    return group;
  }
}
