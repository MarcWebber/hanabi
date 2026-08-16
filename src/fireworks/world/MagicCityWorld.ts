import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import type { EnvironmentPreset, WorldPreset } from "../types";
import { SceneMapFactory, type WorldAnimation } from "./SceneMapFactory";

type DriftingCloud = {
  object: THREE.Group;
  startX: number;
  range: number;
  speed: number;
};

type CityMaterials = ReturnType<typeof createMaterialLibrary>;

const THEMES: Record<EnvironmentPreset, {
  clear: number;
  fog: number;
  fogDensity: number;
  horizon: number;
  zenith: number;
  waterDeep: number;
  waterNear: number;
  waterAccent: number;
  key: number;
  accent: number;
  accentIntensity: number;
}> = {
  "moon-castle": {
    clear: 0x030510,
    fog: 0x0b1028,
    fogDensity: 0.0062,
    horizon: 0x344c7a,
    zenith: 0x071129,
    waterDeep: 0x06152e,
    waterNear: 0x17375a,
    waterAccent: 0x9eb9ef,
    key: 0xbcd4ff,
    accent: 0xffaa6f,
    accentIntensity: 3.4,
  },
  "rose-garden": {
    clear: 0x0a0614,
    fog: 0x1e102a,
    fogDensity: 0.0068,
    horizon: 0x6a355c,
    zenith: 0x130d2d,
    waterDeep: 0x170d2b,
    waterNear: 0x4e244d,
    waterAccent: 0xf49abb,
    key: 0xffc2df,
    accent: 0xff7ea8,
    accentIntensity: 3.8,
  },
  "cloud-observatory": {
    clear: 0x020a14,
    fog: 0x0b2632,
    fogDensity: 0.0065,
    horizon: 0x276379,
    zenith: 0x071a32,
    waterDeep: 0x052133,
    waterNear: 0x15566b,
    waterAccent: 0x8ce9dd,
    key: 0xa7e7ee,
    accent: 0x5fe5d4,
    accentIntensity: 4.1,
  },
};

function createMaterialLibrary() {
  const standard = (color: number, roughness: number, metalness = 0) =>
    new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return {
    plaster: standard(0xdac38d, 0.9),
    plasterRose: standard(0xcda57e, 0.91),
    plasterCool: standard(0xaeb7ad, 0.92),
    stone: standard(0x65758d, 0.88),
    stoneDark: standard(0x34445e, 0.93),
    stoneLight: standard(0x8290a0, 0.9),
    roof: standard(0xa84735, 0.84),
    roofGold: standard(0xa96135, 0.83),
    timber: standard(0x173a43, 0.85),
    timberDark: standard(0x132534, 0.9),
    copper: standard(0x8a533c, 0.55, 0.3),
    foliage: standard(0x244f46, 0.94),
    foliageLight: standard(0x3a6a55, 0.94),
    island: standard(0x26364a, 0.98),
    grass: standard(0x35594d, 0.96),
    window: new THREE.MeshStandardMaterial({
      color: 0xffc77b,
      emissive: 0xff8a38,
      emissiveIntensity: 1.7,
      roughness: 0.5,
      toneMapped: false,
    }),
    windowRose: new THREE.MeshStandardMaterial({
      color: 0xffb0bd,
      emissive: 0xe84d83,
      emissiveIntensity: 1.25,
      roughness: 0.55,
      toneMapped: false,
    }),
  };
}

function seeded(index: number, salt = 0) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function makeGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 1, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,.95)");
  gradient.addColorStop(0.16, "rgba(186,211,255,.62)");
  gradient.addColorStop(0.48, "rgba(99,131,210,.16)");
  gradient.addColorStop(1, "rgba(25,35,88,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class MagicCityWorld {
  private readonly materials: CityMaterials = createMaterialLibrary();
  private readonly root = new THREE.Group();
  private readonly mapGroups = new Map<WorldPreset, THREE.Group>();
  private readonly themeLayers = new Map<EnvironmentPreset, THREE.Group>();
  private readonly animations: WorldAnimation[] = [];
  private readonly clouds: DriftingCloud[] = [];
  private readonly ownedTextures: THREE.Texture[] = [];
  private readonly waterUniforms = {
    uTime: { value: 0 },
    uDeepColor: { value: new THREE.Color(THEMES["moon-castle"].waterDeep) },
    uNearColor: { value: new THREE.Color(THEMES["moon-castle"].waterNear) },
    uAccentColor: { value: new THREE.Color(THEMES["moon-castle"].waterAccent) },
  };
  private readonly skyUniforms = {
    uTime: this.waterUniforms.uTime,
    uHorizonColor: { value: new THREE.Color(THEMES["moon-castle"].horizon) },
    uZenithColor: { value: new THREE.Color(THEMES["moon-castle"].zenith) },
  };
  private readonly starUniforms = {
    uTime: this.waterUniforms.uTime,
    uPixelRatio: { value: 1 },
  };
  private readonly themeLight = new THREE.PointLight(0xffaa6f, 3.4, 62, 1.7);
  private readonly moonLight = new THREE.DirectionalLight(0xbcd4ff, 2.15);
  private mapFactory: SceneMapFactory | null = null;
  private themeBaseIntensity = 3.4;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
  ) {
    this.root.name = "stylized-magic-city-world";
    this.scene.add(this.root);
    this.build();
    this.loadMaterialAtlas();
  }

  setPreset(preset: EnvironmentPreset) {
    const theme = THEMES[preset];
    this.renderer.setClearColor(theme.clear, 1);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(theme.fog);
      this.scene.fog.density = theme.fogDensity;
    }
    this.skyUniforms.uHorizonColor.value.setHex(theme.horizon);
    this.skyUniforms.uZenithColor.value.setHex(theme.zenith);
    this.waterUniforms.uDeepColor.value.setHex(theme.waterDeep);
    this.waterUniforms.uNearColor.value.setHex(theme.waterNear);
    this.waterUniforms.uAccentColor.value.setHex(theme.waterAccent);
    this.moonLight.color.setHex(theme.key);
    this.themeLight.color.setHex(theme.accent);
    this.themeBaseIntensity = theme.accentIntensity;
    this.themeLight.intensity = this.themeBaseIntensity;
    this.themeLayers.forEach((layer, id) => {
      layer.visible = id === preset;
    });
  }

  setWorld(preset: WorldPreset) {
    if (!this.mapGroups.has(preset) && preset !== "magic-city") {
      const map = this.mapFactory?.build(preset);
      if (map) {
        this.mapGroups.set(preset, map);
        this.root.add(map);
      }
    }
    this.mapGroups.forEach((map, id) => {
      map.visible = id === preset;
    });
  }

  setPixelRatio(value: number) {
    this.starUniforms.uPixelRatio.value = value;
  }

  update(elapsed: number, delta: number) {
    this.waterUniforms.uTime.value = elapsed;
    this.animations.forEach((animation) => {
      if (animation.mode === "spin-z") {
        animation.object.rotation.z += delta * animation.speed;
      } else if (animation.mode === "spin-y") {
        animation.object.rotation.y += delta * animation.speed;
      } else if (animation.mode === "float") {
        animation.object.position.y = animation.baseY + Math.sin(elapsed * animation.speed + animation.phase) * 0.32;
        animation.object.rotation.y += delta * animation.speed * 0.12;
      } else {
        animation.object.rotation.z = Math.sin(elapsed * animation.speed + animation.phase) * 0.07;
        animation.object.rotation.y = Math.sin(elapsed * animation.speed * 0.74 + animation.phase) * 0.13;
      }
    });
    this.clouds.forEach((cloud) => {
      cloud.object.position.x += delta * cloud.speed;
      if (cloud.object.position.x > cloud.startX + cloud.range) {
        cloud.object.position.x = cloud.startX - cloud.range;
      }
    });
    this.themeLight.intensity = this.themeBaseIntensity * (1 + Math.sin(elapsed * 0.86) * 0.025);
  }

  dispose() {
    this.disposed = true;
    this.ownedTextures.forEach((texture) => texture.dispose());
  }

  private build() {
    this.scene.fog = new THREE.FogExp2(THEMES["moon-castle"].fog, THEMES["moon-castle"].fogDensity);
    this.createLighting();
    this.createSky();
    this.createStars();
    this.createMoon();
    this.createWater();
    this.createIslandCity();
    this.createAdditionalMaps();
    this.createViewingTerrace();
    this.createThemeLayers();
    this.createFireflies();
    this.setPreset("moon-castle");
    this.setWorld("magic-city");
  }

  private createLighting() {
    const hemisphere = new THREE.HemisphereLight(0x9bb8ed, 0x211427, 1.05);
    this.moonLight.position.set(-28, 34, 18);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(2048, 2048);
    this.moonLight.shadow.camera.left = -48;
    this.moonLight.shadow.camera.right = 48;
    this.moonLight.shadow.camera.top = 42;
    this.moonLight.shadow.camera.bottom = -20;
    this.moonLight.shadow.camera.near = 1;
    this.moonLight.shadow.camera.far = 130;
    this.moonLight.shadow.bias = -0.00025;
    this.moonLight.shadow.normalBias = 0.035;
    this.themeLight.position.set(0, 10, -39);
    const warmRim = new THREE.SpotLight(0xffa66d, 6.5, 82, Math.PI / 4.3, 0.72, 1.35);
    warmRim.position.set(16, 14, -18);
    warmRim.target.position.set(0, 6, -43);
    this.root.add(hemisphere, this.moonLight, this.themeLight, warmRim, warmRim.target);
  }

  private createSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(150, 64, 40),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: this.skyUniforms,
        vertexShader: /* glsl */ `
          varying vec3 vPosition;
          void main() {
            vPosition = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vPosition;
          uniform float uTime;
          uniform vec3 uHorizonColor;
          uniform vec3 uZenithColor;
          void main() {
            float h = normalize(vPosition).y * 0.5 + 0.5;
            vec3 color = mix(uHorizonColor, uZenithColor, smoothstep(0.12, 0.9, h));
            float band = sin(vPosition.x * 0.035 + uTime * 0.025) * sin(vPosition.z * 0.026 - uTime * 0.018);
            band *= smoothstep(0.34, 0.62, h) * (1.0 - smoothstep(0.7, 0.96, h));
            color += uHorizonColor * max(0.0, band) * 0.12;
            color += uHorizonColor * (1.0 - smoothstep(0.08, 0.34, h)) * 0.16;
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    );
    this.root.add(sky);
  }

  private createStars() {
    const count = 1550;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const palette = [new THREE.Color(0xfff7ea), new THREE.Color(0xb9d8ff), new THREE.Color(0xffd6ea)];
    for (let index = 0; index < count; index += 1) {
      const radius = 78 + seeded(index, 1) * 54;
      const theta = seeded(index, 2) * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.lerp(-0.12, 0.98, seeded(index, 3)));
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = Math.abs(radius * Math.cos(phi)) + 8;
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 25;
      sizes[index] = 0.8 + seeded(index, 4) * 2.4;
      phases[index] = seeded(index, 5) * Math.PI * 2;
      const color = palette[index % palette.length];
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      vertexShader: /* glsl */ `
        attribute float aSize;
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = color;
          vAlpha = 0.42 + sin(uTime * (0.65 + fract(aPhase) * 1.2) + aPhase) * 0.34;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * clamp(90.0 / -mvPosition.z, 0.7, 2.4);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float alpha = (1.0 - smoothstep(0.04, 0.5, length(gl_PointCoord - 0.5))) * vAlpha;
          if (alpha < 0.02) discard;
          gl_FragColor = vec4(vColor, alpha * 0.76);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      toneMapped: false,
    });
    this.root.add(new THREE.Points(geometry, material));
  }

  private createMoon() {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(2.05, 48, 36),
      new THREE.MeshBasicMaterial({ color: 0xd9e4ef, toneMapped: false }),
    );
    moon.position.set(-27, 27, -62);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xb9ccff,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }));
    halo.position.copy(moon.position);
    halo.scale.set(10, 10, 1);
    this.root.add(halo, moon);
  }

  private createWater() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(190, 160, 112, 80),
      new THREE.ShaderMaterial({
        uniforms: this.waterUniforms,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            vUv = uv;
            vec3 p = position;
            float wave = sin(p.x * 0.3 + uTime * 0.48) * 0.048 + cos(p.y * 0.2 - uTime * 0.38) * 0.038;
            wave += sin((p.x + p.y) * 0.1 - uTime * 0.22) * 0.026;
            p.z += wave;
            vWave = wave;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uDeepColor;
          uniform vec3 uNearColor;
          uniform vec3 uAccentColor;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            float broad = pow(max(0.0, sin(vUv.y * 150.0 + sin(vUv.x * 18.0 + uTime * 0.56) * 1.8)), 24.0);
            float fine = pow(max(0.0, sin(vUv.y * 270.0 - uTime * 0.41 + sin(vUv.x * 27.0))), 34.0);
            float moonPath = pow(max(0.0, 1.0 - abs(vUv.x - 0.33) * 6.4), 3.0) * (0.06 + broad * 0.26);
            vec3 color = mix(uNearColor, uDeepColor, smoothstep(0.0, 1.0, vUv.y));
            color += uAccentColor * moonPath * 0.5;
            color += uAccentColor * fine * (1.0 - vUv.y) * 0.08;
            color += uAccentColor * (vWave + 0.08) * 0.055;
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.48, -43);
    this.root.add(water);
  }

  private createDistantCliffs(parent: THREE.Group) {
    const back = new THREE.Group();
    const cliffMaterial = new THREE.MeshStandardMaterial({ color: 0x263a53, roughness: 1 });
    const grassMaterial = new THREE.MeshStandardMaterial({ color: 0x294d47, roughness: 1 });
    for (let index = 0; index < 11; index += 1) {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 2), cliffMaterial);
      const x = -61 + index * 12.2;
      const height = 8 + seeded(index, 9) * 10;
      rock.position.set(x, height * 0.38 - 1.2, -78 - seeded(index, 10) * 9);
      rock.scale.set(8.5, height, 7.2);
      back.add(rock);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 14), grassMaterial);
      cap.position.set(x, height * 0.71 + 0.5, rock.position.z + 0.6);
      cap.scale.set(8.3, 1.2, 7);
      back.add(cap);
    }
    parent.add(back);
  }

  private createIslandCity() {
    const city = new THREE.Group();
    city.name = "moonharbor-city";
    this.createDistantCliffs(city);
    const island = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 2), this.materials.island);
    island.position.set(0, -1.9, -42);
    island.scale.set(27, 4.8, 15.5);
    island.receiveShadow = true;
    const grass = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 20), this.materials.grass);
    grass.position.set(0, 0.4, -42);
    grass.scale.set(24.8, 1.8, 13.2);
    grass.receiveShadow = true;
    city.add(island, grass);

    this.createCityWalls(city);
    this.createCathedral(city);
    this.createWindmill(city, -16.4, 1.3, -42.5, 1.06);
    this.createWindmill(city, 16.8, 1.4, -46.5, 0.82);

    const houses: Array<[number, number, number, number, number, number, number]> = [
      [-13.2, -35.8, 3.9, 3.4, 4.1, -0.1, 0], [-8.7, -35.2, 3.4, 3.1, 4.8, 0.08, 1],
      [-4.6, -35.8, 3.7, 3.2, 3.9, -0.05, 2], [4.8, -35.5, 3.8, 3.2, 4.2, 0.08, 1],
      [9.1, -35.4, 3.5, 3.3, 5.2, -0.07, 0], [13.2, -36.2, 3.9, 3.2, 4.4, 0.1, 2],
      [-12.1, -40.1, 3.5, 3.4, 5.2, 0.12, 1], [-7.5, -40.2, 3.2, 3.1, 4.1, -0.12, 0],
      [-3.8, -40.4, 3.1, 3.4, 5.3, 0.08, 2], [4.2, -40.2, 3.3, 3.1, 4.9, -0.1, 0],
      [8.1, -40.7, 3.2, 3.4, 4.2, 0.11, 2], [12.2, -41, 3.4, 3.1, 5.4, -0.06, 1],
      [-10.4, -45.2, 3.4, 3.2, 5.2, -0.08, 2], [-6.3, -45.4, 3.2, 3.5, 4.4, 0.1, 1],
      [6.2, -45.2, 3.3, 3.3, 4.6, -0.1, 0], [10.2, -45.5, 3.5, 3.2, 5.1, 0.1, 2],
      [-13.4, -49.3, 3.5, 3.1, 4.2, 0.12, 0], [-8.9, -49.5, 3.3, 3.2, 4.8, -0.08, 1],
      [8.7, -49.7, 3.4, 3.3, 4.4, 0.06, 2], [13.1, -49.2, 3.7, 3.1, 5, -0.09, 0],
    ];
    houses.forEach((house, index) => this.createHouse(city, ...house, index));
    this.createTrees(city);
    this.createCityLights(city);
    this.mapGroups.set("magic-city", city);
    this.root.add(city);
  }

  private createAdditionalMaps() {
    this.mapFactory = new SceneMapFactory(
      this.materials,
      (animation) => this.animations.push(animation),
      this.waterUniforms.uTime,
      this.starUniforms.uPixelRatio,
    );
  }

  private createCityWalls(parent: THREE.Group) {
    const frontWall = new THREE.Mesh(new RoundedBoxGeometry(43, 5.2, 1.7, 5, 0.22), this.materials.stone);
    frontWall.position.set(0, 2.1, -29.8);
    frontWall.castShadow = true;
    frontWall.receiveShadow = true;
    parent.add(frontWall);
    for (let index = 0; index < 24; index += 1) {
      if (index === 11 || index === 12) continue;
      const merlon = new THREE.Mesh(new RoundedBoxGeometry(1.05, 1.15, 1.95, 4, 0.12), this.materials.stoneLight);
      merlon.position.set(-20.8 + index * 1.82, 5.12, -29.75);
      merlon.castShadow = true;
      parent.add(merlon);
    }
    const gate = new THREE.Mesh(new RoundedBoxGeometry(3.7, 4.4, 0.35, 8, 0.42), this.materials.timberDark);
    gate.position.set(0, 1.45, -28.9);
    parent.add(gate);
    const gateArch = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.3, 12, 48, Math.PI), this.materials.stoneLight);
    gateArch.position.set(0, 3.25, -28.68);
    parent.add(gateArch);
    for (const x of [-21.2, 21.2]) this.createRoundTower(parent, x, -30.3, 3.25, 8.2, true);

    for (const x of [-22.3, 22.3]) {
      const side = new THREE.Mesh(new RoundedBoxGeometry(1.45, 4.5, 22.5, 5, 0.2), this.materials.stone);
      side.position.set(x, 1.8, -41.2);
      side.castShadow = true;
      parent.add(side);
      for (let index = 0; index < 12; index += 1) {
        const merlon = new THREE.Mesh(new RoundedBoxGeometry(1.7, 1.05, 0.95, 4, 0.12), this.materials.stoneLight);
        merlon.position.set(x, 4.55, -30.9 - index * 1.86);
        parent.add(merlon);
      }
    }
    this.createRoundTower(parent, -22.3, -52.2, 2.65, 7.2, false);
    this.createRoundTower(parent, 22.3, -52.2, 2.65, 7.2, false);
  }

  private createRoundTower(parent: THREE.Group, x: number, z: number, radius: number, height: number, grand: boolean) {
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, height, 32), this.materials.stone);
    tower.position.set(x, height * 0.5 - 0.1, z);
    tower.castShadow = true;
    tower.receiveShadow = true;
    parent.add(tower);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, 0.55, 32), this.materials.stoneLight);
    band.position.set(x, height - 0.12, z);
    parent.add(band);
    for (let index = 0; index < 12; index += 1) {
      const angle = (index / 12) * Math.PI * 2;
      const merlon = new THREE.Mesh(new RoundedBoxGeometry(0.74, 1.05, 0.72, 4, 0.1), this.materials.stoneLight);
      merlon.position.set(x + Math.cos(angle) * radius * 1.04, height + 0.4, z + Math.sin(angle) * radius * 1.04);
      merlon.rotation.y = -angle;
      parent.add(merlon);
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(radius * 1.34, grand ? 4.4 : 3.4, 32), this.materials.roof);
    roof.position.set(x, height + (grand ? 3.0 : 2.5), z);
    roof.castShadow = true;
    parent.add(roof);
    const window = this.createArchedWindow(0.72, 1.42);
    window.position.set(x, height * 0.58, z + radius + 0.025);
    parent.add(window);
    this.createFlag(parent, x, height + (grand ? 6.1 : 5.2), z);
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
    index: number,
  ) {
    const group = new THREE.Group();
    group.position.set(x, 1.25, z);
    group.rotation.y = rotation;
    const bodyMaterial = [this.materials.plaster, this.materials.plasterRose, this.materials.plasterCool][materialIndex % 3];
    const body = new THREE.Mesh(new RoundedBoxGeometry(width, height, depth, 5, 0.16), bodyMaterial);
    body.position.y = height * 0.5;
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    const roofHeight = 2 + (index % 3) * 0.28;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1, roofHeight, 4), index % 5 === 0 ? this.materials.roofGold : this.materials.roof);
    roof.position.y = height + roofHeight * 0.48;
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(width * 0.78, 1, depth * 0.78);
    roof.castShadow = true;
    group.add(roof);

    const beam = new THREE.Mesh(new RoundedBoxGeometry(width * 0.92, 0.16, 0.17, 3, 0.04), this.materials.timber);
    beam.position.set(0, height * 0.58, depth * 0.51);
    group.add(beam);
    for (const side of [-1, 1]) {
      const upright = new THREE.Mesh(new RoundedBoxGeometry(0.15, height * 0.78, 0.16, 3, 0.04), this.materials.timber);
      upright.position.set(side * width * 0.4, height * 0.48, depth * 0.51);
      group.add(upright);
    }

    const floors = height > 4.7 ? 2 : 1;
    for (let floor = 0; floor < floors; floor += 1) {
      for (const side of [-1, 1]) {
        const window = this.createArchedWindow(0.58, 1.02, (index + floor) % 7 === 0);
        window.position.set(side * width * 0.25, 1.35 + floor * 1.75, depth * 0.515);
        group.add(window);
      }
    }
    const door = new THREE.Mesh(new RoundedBoxGeometry(0.82, 1.55, 0.2, 6, 0.18), this.materials.timberDark);
    door.position.set(0, 0.78, depth * 0.52);
    group.add(door);

    if (index % 3 === 0) {
      const chimney = new THREE.Mesh(new RoundedBoxGeometry(0.48, 1.55, 0.48, 4, 0.08), this.materials.stoneDark);
      chimney.position.set(width * 0.27, height + 0.62, -depth * 0.16);
      group.add(chimney);
    }
    parent.add(group);
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

  private createCathedral(parent: THREE.Group) {
    const cathedral = new THREE.Group();
    cathedral.position.set(0, 1.35, -47);
    const nave = new THREE.Mesh(new RoundedBoxGeometry(9.2, 10.8, 8.5, 7, 0.22), this.materials.plasterCool);
    nave.position.y = 5.4;
    nave.castShadow = true;
    nave.receiveShadow = true;
    cathedral.add(nave);
    const naveRoof = new THREE.Mesh(new THREE.ConeGeometry(1, 4.1, 4), this.materials.roofGold);
    naveRoof.position.y = 11.7;
    naveRoof.rotation.y = Math.PI / 4;
    naveRoof.scale.set(7.25, 1, 5.25);
    cathedral.add(naveRoof);

    for (const x of [-3.35, 3.35]) {
      const tower = new THREE.Mesh(new RoundedBoxGeometry(2.65, 13.6, 3.05, 6, 0.16), this.materials.stoneLight);
      tower.position.set(x, 8, 1.85);
      tower.castShadow = true;
      cathedral.add(tower);
      const spire = new THREE.Mesh(new THREE.ConeGeometry(2.05, 6.4, 20), this.materials.roof);
      spire.position.set(x, 17.7, 1.85);
      cathedral.add(spire);
      const window = this.createArchedWindow(0.72, 1.7);
      window.position.set(x, 9.1, 3.4);
      cathedral.add(window);
      this.createFlag(cathedral, x, 21.6, 1.85, 0.85);
    }

    const gate = this.createArchedWindow(1.65, 3.4);
    gate.position.set(0, 2.15, 4.3);
    cathedral.add(gate);
    const roseWindow = new THREE.Mesh(new THREE.TorusGeometry(1.08, 0.16, 12, 56), this.materials.copper);
    roseWindow.position.set(0, 7.05, 4.34);
    cathedral.add(roseWindow);
    const roseGlass = new THREE.Mesh(new THREE.CircleGeometry(0.92, 40), this.materials.windowRose);
    roseGlass.position.set(0, 7.05, 4.33);
    cathedral.add(roseGlass);
    for (let index = 0; index < 8; index += 1) {
      const spoke = new THREE.Mesh(new RoundedBoxGeometry(0.07, 1.72, 0.06, 3, 0.02), this.materials.copper);
      spoke.position.set(0, 7.05, 4.38);
      spoke.rotation.z = (index / 8) * Math.PI;
      cathedral.add(spoke);
    }
    for (const x of [-5.1, 5.1]) {
      for (const z of [-2.7, 0, 2.7]) {
        const buttress = new THREE.Mesh(new RoundedBoxGeometry(1, 6.8, 1.2, 5, 0.12), this.materials.stone);
        buttress.position.set(x, 3.3, z);
        buttress.rotation.z = x < 0 ? -0.1 : 0.1;
        cathedral.add(buttress);
      }
    }
    parent.add(cathedral);
  }

  private createWindmill(parent: THREE.Group, x: number, y: number, z: number, scale: number) {
    const windmill = new THREE.Group();
    windmill.position.set(x, y, z);
    windmill.scale.setScalar(scale);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.75, 6.9, 32), this.materials.plaster);
    base.position.y = 3.45;
    base.castShadow = true;
    windmill.add(base);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(2.65, 3.1, 28), this.materials.roof);
    roof.position.y = 8.15;
    windmill.add(roof);
    const door = new THREE.Mesh(new RoundedBoxGeometry(0.95, 1.8, 0.18, 6, 0.2), this.materials.timberDark);
    door.position.set(0, 1, 2.42);
    windmill.add(door);
    const window = this.createArchedWindow(0.62, 1.05);
    window.position.set(0, 4.25, 2.23);
    windmill.add(window);

    const rotor = new THREE.Group();
    rotor.position.set(0, 6.15, 2.72);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.42, 18, 14), this.materials.copper);
    rotor.add(hub);
    for (let bladeIndex = 0; bladeIndex < 4; bladeIndex += 1) {
      const blade = new THREE.Group();
      blade.rotation.z = bladeIndex * Math.PI / 2;
      const beam = new THREE.Mesh(new RoundedBoxGeometry(0.18, 4.7, 0.16, 3, 0.04), this.materials.timberDark);
      beam.position.y = 2.25;
      const sailShape = new THREE.Shape();
      sailShape.moveTo(0.2, 0.85);
      sailShape.lineTo(1.12, 3.95);
      sailShape.lineTo(0.22, 4.48);
      sailShape.lineTo(-0.12, 1.05);
      sailShape.closePath();
      const sail = new THREE.Mesh(new THREE.ShapeGeometry(sailShape), this.materials.plasterCool);
      sail.position.z = 0.08;
      blade.add(beam, sail);
      rotor.add(blade);
    }
    windmill.add(rotor);
    this.animations.push({ object: rotor, mode: "spin-z", speed: -0.23 / scale, phase: 0, baseY: rotor.position.y });
    parent.add(windmill);
  }

  private createFlag(parent: THREE.Group, x: number, y: number, z: number, scale = 1) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 2.4 * scale, 8), this.materials.copper);
    pole.position.set(x, y - 0.85 * scale, z);
    const flagShape = new THREE.Shape();
    flagShape.moveTo(0, 0);
    flagShape.lineTo(1.6 * scale, 0.16 * scale);
    flagShape.lineTo(1.28 * scale, -0.66 * scale);
    flagShape.lineTo(0, -0.52 * scale);
    flagShape.closePath();
    const flag = new THREE.Mesh(new THREE.ShapeGeometry(flagShape), this.materials.roof);
    flag.position.set(x, y, z + 0.05);
    parent.add(pole, flag);
    this.animations.push({ object: flag, mode: "sway", speed: 1.15, phase: x * 0.2, baseY: y });
  }

  private createTrees(parent: THREE.Group) {
    const positions = [
      [-18, -35], [-15, -48], [-11, -53], [-5, -53], [5, -53], [11, -53], [15, -37], [18, -40],
    ];
    positions.forEach(([x, z], index) => {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.25, 2.3, 10), this.materials.timberDark);
      trunk.position.set(x, 2.15, z);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35 + (index % 3) * 0.15, 2), index % 2 ? this.materials.foliageLight : this.materials.foliage);
      crown.position.set(x, 3.75, z);
      crown.scale.set(1.15, 1.3, 1);
      parent.add(trunk, crown);
    });
  }

  private createCityLights(parent: THREE.Group) {
    const lights = [
      [-15, 6, -35], [-8, 5.5, -41], [0, 8, -42], [8, 5.5, -40], [15, 6, -36],
    ];
    lights.forEach(([x, y, z], index) => {
      const light = new THREE.PointLight(index === 2 ? 0xff8fa8 : 0xffa35f, index === 2 ? 2.5 : 1.45, 16, 2);
      light.position.set(x, y, z);
      parent.add(light);
    });
  }

  private createViewingTerrace() {
    const terrace = new THREE.Group();
    const floor = new THREE.Mesh(new RoundedBoxGeometry(21, 0.8, 15, 6, 0.18), this.materials.stone);
    floor.position.set(0, -0.22, 4.9);
    floor.receiveShadow = true;
    terrace.add(floor);
    const runner = new THREE.Mesh(new THREE.PlaneGeometry(4.7, 4.4), new THREE.MeshStandardMaterial({ color: 0x573244, roughness: 0.97 }));
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(0, 0.195, 3.65);
    terrace.add(runner);

    const frontWall = new THREE.Mesh(new RoundedBoxGeometry(20, 0.8, 0.58, 5, 0.12), this.materials.stoneLight);
    frontWall.position.set(0, 0.52, -1.12);
    terrace.add(frontWall);
    for (let index = -9; index <= 9; index += 1.5) {
      const merlon = new THREE.Mesh(new RoundedBoxGeometry(0.72, 0.82, 0.78, 4, 0.1), this.materials.stoneLight);
      merlon.position.set(index, 1.3, -1.12);
      terrace.add(merlon);
    }
    for (const x of [-10, 10]) {
      const sideWall = new THREE.Mesh(new RoundedBoxGeometry(0.58, 0.78, 13.4, 5, 0.12), this.materials.stoneLight);
      sideWall.position.set(x, 0.5, 5.1);
      terrace.add(sideWall);
      for (let z = -0.2; z <= 10.6; z += 1.7) {
        const merlon = new THREE.Mesh(new RoundedBoxGeometry(0.78, 0.8, 0.78, 4, 0.1), this.materials.stoneLight);
        merlon.position.set(x, 1.28, z);
        terrace.add(merlon);
      }
    }
    const seat = new THREE.Mesh(new RoundedBoxGeometry(6.2, 0.34, 1.25, 6, 0.13), this.materials.timberDark);
    seat.position.set(0, 1.03, 4.35);
    const back = new THREE.Mesh(new RoundedBoxGeometry(6.2, 1.45, 0.28, 6, 0.1), this.materials.timber);
    back.position.set(0, 1.68, 4.98);
    terrace.add(seat, back);
    this.createCouple(terrace);
    for (const x of [-7.8, -4.8, 4.8, 7.8]) this.createLantern(terrace, x, 0.1, 0.05);
    this.createGarland(terrace);
    this.root.add(terrace);
  }

  private createLantern(parent: THREE.Group, x: number, y: number, z: number) {
    const frame = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.19, 0.5, 8), this.materials.copper);
    frame.position.set(x, y + 0.34, z);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 12), this.materials.window);
    glow.position.copy(frame.position);
    const light = new THREE.PointLight(0xff8c53, 0.58, 3.6, 2);
    light.position.copy(frame.position);
    parent.add(frame, glow, light);
  }

  private createGarland(parent: THREE.Group) {
    const cablePoints: THREE.Vector3[] = [];
    for (let index = 0; index <= 32; index += 1) {
      const x = -8.8 + index * 0.55;
      cablePoints.push(new THREE.Vector3(x, 4.8 - Math.cos((x / 8.8) * Math.PI) * 0.32, 2.6));
    }
    parent.add(new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(cablePoints),
      new THREE.LineBasicMaterial({ color: 0x493345, transparent: true, opacity: 0.8 }),
    ));
    for (let index = 0; index < 12; index += 1) {
      const x = -8.25 + index * 1.5;
      const y = 4.8 - Math.cos((x / 8.8) * Math.PI) * 0.32;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), index % 3 === 0 ? this.materials.windowRose : this.materials.window);
      bulb.position.set(x, y - 0.1, 2.6);
      parent.add(bulb);
    }
  }

  private createCouple(parent: THREE.Group) {
    parent.add(
      this.createPerson(-0.78, 0x52334c, 0x1b1722, 0xe8aa8c, false),
      this.createPerson(0.82, 0x24445f, 0x2a1824, 0xe2a181, true),
    );
    const handLight = new THREE.PointLight(0xff7faa, 0.72, 3, 2);
    handLight.position.set(0, 1.45, 3.65);
    parent.add(handLight);
  }

  private createPerson(x: number, coatColor: number, hairColor: number, skinColor: number, longHair: boolean) {
    const group = new THREE.Group();
    const coat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.84 });
    const hair = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.92 });
    const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.94 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x111522, roughness: 0.9 });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.72, 6, 12), coat);
    torso.position.set(x, 1.76, 4.2);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 20, 16), skin);
    head.position.set(x, 2.58, 4.1);
    const hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.33, 20, 14, 0, Math.PI * 2, 0, Math.PI * (longHair ? 0.84 : 0.66)), hair);
    hairCap.position.set(x, 2.69, 4.13);
    hairCap.rotation.x = Math.PI;
    group.add(torso, head, hairCap);
    if (longHair) {
      const backHair = new THREE.Mesh(new THREE.CapsuleGeometry(0.29, 0.58, 5, 12), hair);
      backHair.position.set(x, 2.2, 4.4);
      group.add(backHair);
    }
    const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.72, 5, 10), coat);
    arm.position.set(x - Math.sign(x) * 0.34, 1.66, 3.9);
    arm.rotation.z = Math.sign(x) * 0.9;
    arm.rotation.x = 0.35;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.115, 12, 10), skin);
    hand.position.set(x - Math.sign(x) * 0.69, 1.43, 3.66);
    group.add(arm, hand);
    for (const side of [-0.2, 0.2]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.7, 5, 10), trousers);
      leg.position.set(x + side, 0.73, 3.62);
      leg.rotation.x = 0.72;
      group.add(leg);
    }
    return group;
  }

  private createThemeLayers() {
    const moon = new THREE.Group();
    const rose = new THREE.Group();
    const arcane = new THREE.Group();
    this.createFloatingLanterns(moon, 0xffb06d);
    this.createPetals(rose);
    this.createArcaneHalo(arcane);
    this.themeLayers.set("moon-castle", moon);
    this.themeLayers.set("rose-garden", rose);
    this.themeLayers.set("cloud-observatory", arcane);
    this.root.add(moon, rose, arcane);
  }

  private createFloatingLanterns(parent: THREE.Group, color: number) {
    for (let index = 0; index < 18; index += 1) {
      const lantern = new THREE.Mesh(
        new RoundedBoxGeometry(0.22, 0.34, 0.22, 4, 0.05),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.66, toneMapped: false }),
      );
      lantern.position.set(-18 + seeded(index, 21) * 36, 5 + seeded(index, 22) * 9, -32 - seeded(index, 23) * 24);
      parent.add(lantern);
      this.animations.push({ object: lantern, mode: "float", speed: 0.35 + seeded(index, 24) * 0.28, phase: index, baseY: lantern.position.y });
    }
  }

  private createPetals(parent: THREE.Group) {
    const count = 280;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      positions[index * 3] = (seeded(index, 31) - 0.5) * 48;
      positions[index * 3 + 1] = seeded(index, 32) * 15;
      positions[index * 3 + 2] = -11 - seeded(index, 33) * 48;
      phases[index] = seeded(index, 34) * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    parent.add(new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.y = mod(position.y - uTime * (0.25 + fract(aPhase) * 0.14), 15.0);
          p.x += sin(uTime * 0.32 + aPhase) * 0.75;
          vAlpha = 0.28 + sin(aPhase + uTime) * 0.14;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = (2.2 + fract(aPhase) * 2.5) * uPixelRatio * clamp(19.0 / -mvPosition.z, 0.65, 2.3);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          vec2 p = gl_PointCoord - vec2(0.5);
          float alpha = (1.0 - smoothstep(0.18, 0.52, length(vec2(p.x * 1.8, p.y)))) * vAlpha;
          gl_FragColor = vec4(1.0, 0.42, 0.62, alpha);
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })));
  }

  private createArcaneHalo(parent: THREE.Group) {
    const center = new THREE.Vector3(0, 22.4, -46.5);
    const material = new THREE.MeshStandardMaterial({ color: 0x54b6af, emissive: 0x174c53, emissiveIntensity: 1.2, roughness: 0.28, metalness: 0.48 });
    [3.2, 4.3, 5.4].forEach((radius, index) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.085 + index * 0.02, 10, 96), material);
      ring.position.copy(center);
      ring.rotation.x = Math.PI / 2.6 + index * 0.31;
      ring.rotation.y = index * 0.7;
      parent.add(ring);
      this.animations.push({ object: ring, mode: "spin-z", speed: (index % 2 ? -1 : 1) * (0.06 + index * 0.02), phase: index, baseY: center.y });
    });
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.82, 28, 22), new THREE.MeshBasicMaterial({ color: 0x7ce7df, transparent: true, opacity: 0.76, toneMapped: false }));
    orb.position.copy(center);
    parent.add(orb);
    this.animations.push({ object: orb, mode: "float", speed: 0.62, phase: 0.4, baseY: center.y });
  }

  private createCloud(parent: THREE.Group, x: number, y: number, z: number, speed: number, range: number) {
    const cloud = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ color: 0xb6c7dc, transparent: true, opacity: 0.07, depthWrite: false });
    for (let index = 0; index < 8; index += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1.8 + seeded(index, 40) * 2.1, 20, 14), material);
      puff.position.set(index * 2.05, seeded(index, 41) * 1.3, (seeded(index, 42) - 0.5) * 2.4);
      puff.scale.y = 0.42 + seeded(index, 43) * 0.25;
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    parent.add(cloud);
    this.clouds.push({ object: cloud, startX: x, range, speed });
  }

  private createFireflies() {
    const count = 90;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const side = index % 2 ? -1 : 1;
      positions[index * 3] = side * (4.8 + seeded(index, 51) * 6);
      positions[index * 3 + 1] = 0.4 + seeded(index, 52) * 4.1;
      positions[index * 3 + 2] = -2 + seeded(index, 53) * 12;
      phases[index] = seeded(index, 54) * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    this.root.add(new THREE.Points(geometry, new THREE.ShaderMaterial({
      uniforms: this.starUniforms,
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.36 + aPhase) * 0.2;
          p.y += cos(uTime * 0.28 + aPhase * 1.7) * 0.13;
          vAlpha = 0.16 + pow(max(0.0, sin(uTime * 1.7 + aPhase)), 4.0) * 0.7;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 2.1 * uPixelRatio * clamp(18.0 / -mvPosition.z, 0.7, 2.1);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float alpha = (1.0 - smoothstep(0.08, 0.5, length(gl_PointCoord - 0.5))) * vAlpha;
          gl_FragColor = vec4(1.0, 0.66, 0.25, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })));
    this.createCloud(this.root, -25, 15, -58, 0.55, 34);
    this.createCloud(this.root, 16, 21, -76, 0.38, 38);
  }

  private loadMaterialAtlas() {
    const atlas = new THREE.TextureLoader().load("/textures/magic-city-atlas.png", (loaded) => {
      if (this.disposed) {
        loaded.dispose();
        return;
      }
      const image = loaded.image as HTMLImageElement;
      const tiles = {
        plaster: this.cropAtlasTile(image, 0, 0, 1.25, 1.25),
        stone: this.cropAtlasTile(image, 1, 0, 2.2, 1.6),
        roof: this.cropAtlasTile(image, 0, 1, 1.45, 1.45),
        trim: this.cropAtlasTile(image, 1, 1, 1.25, 1.25),
      };
      [this.materials.plaster, this.materials.plasterRose, this.materials.plasterCool].forEach((material) => {
        material.map = tiles.plaster;
        material.needsUpdate = true;
      });
      [this.materials.stone, this.materials.stoneDark, this.materials.stoneLight].forEach((material) => {
        material.map = tiles.stone;
        material.needsUpdate = true;
      });
      [this.materials.roof, this.materials.roofGold].forEach((material) => {
        material.map = tiles.roof;
        material.needsUpdate = true;
      });
      [this.materials.timber, this.materials.timberDark, this.materials.copper].forEach((material) => {
        material.map = tiles.trim;
        material.needsUpdate = true;
      });
      this.ownedTextures.push(...Object.values(tiles));
      loaded.dispose();
    });
    atlas.colorSpace = THREE.SRGBColorSpace;
  }

  private cropAtlasTile(image: HTMLImageElement, column: number, row: number, repeatX: number, repeatY: number) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(image.naturalWidth / 2);
    canvas.height = Math.floor(image.naturalHeight / 2);
    const context = canvas.getContext("2d")!;
    context.drawImage(
      image,
      column * canvas.width,
      row * canvas.height,
      canvas.width,
      canvas.height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeatX, repeatY);
    texture.anisotropy = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    return texture;
  }
}
