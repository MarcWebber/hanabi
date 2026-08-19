import * as THREE from "three";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { EnvironmentPreset } from "../types";

type Theme = {
  clear: number;
  fog: number;
  fogDensity: number;
  horizon: number;
  zenith: number;
  waterDeep: number;
  waterNear: number;
  waterAccent: number;
  moon: number;
  ground: number;
  city: number;
};

type ReactiveBurst = {
  light: THREE.PointLight;
  position: THREE.Vector3;
  color: THREE.Color;
  age: number;
  lifetime: number;
  power: number;
};

type FloatingLantern = {
  object: THREE.Object3D;
  baseY: number;
  phase: number;
  speed: number;
};

const THEMES: Record<EnvironmentPreset, Theme> = {
  "moon-castle": {
    clear: 0x02040d,
    fog: 0x0b122a,
    fogDensity: 0.0046,
    horizon: 0x263e68,
    zenith: 0x030717,
    waterDeep: 0x020918,
    waterNear: 0x0c2847,
    waterAccent: 0x8fb6ff,
    moon: 0xc8dcff,
    ground: 0x180b18,
    city: 0xff8c4b,
  },
  "rose-garden": {
    clear: 0x08030d,
    fog: 0x251126,
    fogDensity: 0.0052,
    horizon: 0x633553,
    zenith: 0x0d071c,
    waterDeep: 0x100719,
    waterNear: 0x3d1738,
    waterAccent: 0xff91b8,
    moon: 0xffc6df,
    ground: 0x24101a,
    city: 0xff6f83,
  },
  "cloud-observatory": {
    clear: 0x01070d,
    fog: 0x08232b,
    fogDensity: 0.0049,
    horizon: 0x1d6170,
    zenith: 0x03111f,
    waterDeep: 0x02141d,
    waterNear: 0x0b4352,
    waterAccent: 0x78f0dc,
    moon: 0xb7fff3,
    ground: 0x0a1c1b,
    city: 0x5de7ce,
  },
};

const BURST_SLOTS = 4;

function seeded(index: number, salt = 0) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function makeGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 192;
  canvas.height = 192;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(96, 96, 1, 96, 96, 94);
  gradient.addColorStop(0, "rgba(255,255,255,.98)");
  gradient.addColorStop(0.13, "rgba(213,228,255,.72)");
  gradient.addColorStop(0.42, "rgba(117,153,229,.2)");
  gradient.addColorStop(1, "rgba(28,40,90,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 192, 192);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function materialsOf(object: THREE.Mesh) {
  return Array.isArray(object.material) ? object.material : [object.material];
}

export class MagicCityWorld {
  readonly ready: Promise<void>;

  private readonly root = new THREE.Group();
  private readonly atmosphere = new THREE.Group();
  private readonly heroContainer = new THREE.Group();
  private readonly loader = new GLTFLoader();
  private readonly dracoLoader = new DRACOLoader();
  private readonly ownedTextures: THREE.Texture[] = [];
  private readonly floatingLanterns: FloatingLantern[] = [];
  private readonly reactiveBursts: ReactiveBurst[] = [];
  private readonly burstPositions = Array.from({ length: BURST_SLOTS }, () => new THREE.Vector3());
  private readonly burstColors = Array.from({ length: BURST_SLOTS }, () => new THREE.Color());
  private readonly burstIntensities = Array.from({ length: BURST_SLOTS }, () => 0);
  private readonly waterUniforms = {
    uTime: { value: 0 },
    uDeepColor: { value: new THREE.Color(THEMES["moon-castle"].waterDeep) },
    uNearColor: { value: new THREE.Color(THEMES["moon-castle"].waterNear) },
    uAccentColor: { value: new THREE.Color(THEMES["moon-castle"].waterAccent) },
    uBurstPositions: { value: this.burstPositions },
    uBurstColors: { value: this.burstColors },
    uBurstIntensities: { value: this.burstIntensities },
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
  private readonly hemisphere = new THREE.HemisphereLight(0x99baff, 0x180b18, 1.62);
  private readonly moonLight = new THREE.DirectionalLight(0xc8dcff, 3.25);
  private readonly cityGlow = new THREE.PointLight(0xff8c4b, 6.2, 78, 1.55);
  private readonly companionTurn = new THREE.Quaternion();
  private readonly companionBreath = new THREE.Quaternion();
  private readonly companionTurnAxis = new THREE.Vector3(0, 1, 0);
  private readonly companionBreathAxis = new THREE.Vector3(1, 0, 0);
  private companionMixer: THREE.AnimationMixer | null = null;
  private companionAnimationRoot: THREE.Object3D | null = null;
  private companionHead: THREE.Bone | null = null;
  private companionSpine: THREE.Bone | null = null;
  private companionReaction = 0;
  private companionReactionSide = 0;
  private disposed = false;
  private nextBurstSlot = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer,
    private readonly onLoadProgress?: (progress: number) => void,
  ) {
    this.dracoLoader.setDecoderPath("/draco/");
    this.loader.setDRACOLoader(this.dracoLoader);
    this.root.name = "moonharbor-hero-world";
    this.atmosphere.name = "realtime-atmosphere";
    this.heroContainer.name = "authored-pbr-hero-asset";
    this.root.add(this.atmosphere, this.heroContainer);
    this.scene.add(this.root);
    this.buildAtmosphere();
    this.setPreset("moon-castle");
    this.ready = this.loadHeroAsset();
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
    this.moonLight.color.setHex(theme.moon);
    this.hemisphere.color.setHex(theme.moon);
    this.hemisphere.groundColor.setHex(theme.ground);
    this.cityGlow.color.setHex(theme.city);
  }

  setPixelRatio(value: number) {
    this.starUniforms.uPixelRatio.value = value;
  }

  pulseFirework(position: THREE.Vector3, color: THREE.Color, power: number) {
    const slot = this.nextBurstSlot;
    this.nextBurstSlot = (slot + 1) % BURST_SLOTS;
    const burst = this.reactiveBursts[slot];
    burst.position.copy(position);
    burst.color.copy(color);
    burst.age = 0;
    burst.lifetime = 1.45 + power * 0.5;
    burst.power = THREE.MathUtils.clamp(power, 0.55, 1.8);
    burst.light.position.copy(position);
    burst.light.color.copy(color).lerp(new THREE.Color(0xffd9bd), 0.12);
    burst.light.intensity = 18 * burst.power;
    this.burstPositions[slot].copy(position);
    this.burstColors[slot].copy(color);
    this.burstIntensities[slot] = burst.power;
    this.companionReaction = Math.max(
      this.companionReaction,
      THREE.MathUtils.clamp(power, 0.55, 1.8),
    );
    this.companionReactionSide = THREE.MathUtils.clamp(position.x / 16, -1, 1);
  }

  update(elapsed: number, delta: number) {
    this.waterUniforms.uTime.value = elapsed;
    this.companionMixer?.update(delta);
    this.updateCompanion(elapsed, delta);
    this.floatingLanterns.forEach((lantern) => {
      lantern.object.position.y = lantern.baseY + Math.sin(elapsed * lantern.speed + lantern.phase) * 0.24;
      lantern.object.rotation.y += delta * 0.08;
    });
    this.reactiveBursts.forEach((burst, index) => {
      if (burst.age >= burst.lifetime) {
        burst.light.intensity = 0;
        this.burstIntensities[index] = 0;
        return;
      }
      burst.age += delta;
      const progress = THREE.MathUtils.clamp(burst.age / burst.lifetime, 0, 1);
      const attack = Math.min(1, progress / 0.055);
      const fade = Math.pow(1 - progress, 2.15);
      const flicker = 0.92 + Math.sin(elapsed * 26 + index * 1.7) * 0.08;
      const intensity = attack * fade * flicker;
      burst.light.intensity = intensity * 18 * burst.power;
      this.burstIntensities[index] = intensity * burst.power;
    });
  }

  dispose() {
    this.disposed = true;
    this.companionMixer?.stopAllAction();
    if (this.companionAnimationRoot) {
      this.companionMixer?.uncacheRoot(this.companionAnimationRoot);
    }
    this.dracoLoader.dispose();
    this.scene.remove(this.root);
    this.ownedTextures.forEach((texture) => texture.dispose());
  }

  private async loadHeroAsset() {
    const gltf = await new Promise<GLTF>((resolve, reject) => {
      this.loader.load(
        "/models/hero-world.glb",
        resolve,
        (event) => {
          const progress = event.total > 0
            ? event.loaded / event.total
            : Math.min(0.92, event.loaded / 10_000_000);
          this.onLoadProgress?.(THREE.MathUtils.clamp(progress, 0, 0.98));
        },
        reject,
      );
    });
    if (this.disposed) {
      this.disposeObject(gltf.scene);
      return;
    }
    gltf.scene.name = "moonharbor-authored-pbr-city-and-companion";
    const maxAnisotropy = Math.min(12, this.renderer.capabilities.getMaxAnisotropy());
    gltf.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      const closeForeground = /companion|bench|velvet|terrace|paver|balustrade|carpet|lantern/i.test(object.name);
      const architecturalHero = /keep|tower|wing|roof|gate/i.test(object.name);
      object.castShadow = closeForeground || architecturalHero;
      object.receiveShadow = true;
      object.frustumCulled = true;
      materialsOf(object).forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshPhysicalMaterial) {
          material.envMapIntensity = closeForeground ? 0.92 : 0.68;
          if (material.map) material.map.anisotropy = maxAnisotropy;
          if (material.normalMap) material.normalMap.anisotropy = maxAnisotropy;
          if (material.roughnessMap) material.roughnessMap.anisotropy = maxAnisotropy;
          if (material.metalnessMap) material.metalnessMap.anisotropy = maxAnisotropy;
          material.needsUpdate = true;
        }
      });
    });
    gltf.scene.traverse((object) => {
      if (object instanceof THREE.Bone) {
        if (/Head$/i.test(object.name)) this.companionHead = object;
        if (/Spine2$/i.test(object.name)) this.companionSpine = object;
      }
    });
    if (gltf.animations.length) {
      this.companionAnimationRoot = gltf.scene;
      this.companionMixer = new THREE.AnimationMixer(gltf.scene);
      const action = this.companionMixer.clipAction(gltf.animations[0]);
      action.setLoop(THREE.LoopRepeat, Infinity);
      action.timeScale = 0.82;
      action.play();
    }
    this.heroContainer.add(gltf.scene);
    this.onLoadProgress?.(1);
  }

  private updateCompanion(elapsed: number, delta: number) {
    const breathe = Math.sin(elapsed * 1.45) * 0.008;
    const glance = Math.sin(elapsed * 0.19 + 0.8) * 0.025;
    const reaction = this.companionReaction;
    if (this.companionSpine) {
      this.companionBreath.setFromAxisAngle(
        this.companionBreathAxis,
        breathe - reaction * 0.012,
      );
      this.companionSpine.quaternion.multiply(this.companionBreath);
    }
    if (this.companionHead) {
      this.companionTurn.setFromAxisAngle(
        this.companionTurnAxis,
        glance + this.companionReactionSide * reaction * 0.055,
      );
      this.companionHead.quaternion.multiply(this.companionTurn);
    }
    this.companionReaction = Math.max(0, reaction - delta * 0.62);
  }

  private buildAtmosphere() {
    this.scene.fog = new THREE.FogExp2(THEMES["moon-castle"].fog, THEMES["moon-castle"].fogDensity);
    this.createLighting();
    this.createSky();
    this.createStars();
    this.createMoon();
    this.createWater();
    this.createLanterns();
    this.createReactiveLights();
  }

  private createLighting() {
    this.moonLight.position.set(-30, 38, 14);
    this.moonLight.castShadow = true;
    this.moonLight.shadow.mapSize.set(2048, 2048);
    this.moonLight.shadow.camera.left = -42;
    this.moonLight.shadow.camera.right = 42;
    this.moonLight.shadow.camera.top = 36;
    this.moonLight.shadow.camera.bottom = -18;
    this.moonLight.shadow.camera.near = 1;
    this.moonLight.shadow.camera.far = 150;
    this.moonLight.shadow.bias = -0.00018;
    this.moonLight.shadow.normalBias = 0.035;

    this.cityGlow.position.set(0, 9, -40);
    const companionKey = new THREE.SpotLight(0xc7dcff, 10.5, 20, Math.PI / 3.2, 0.72, 1.4);
    companionKey.position.set(-5.5, 7.5, 0.5);
    companionKey.target.position.set(0.8, 1.65, 4.15);
    companionKey.castShadow = true;
    companionKey.shadow.mapSize.set(1024, 1024);
    companionKey.shadow.bias = -0.0001;
    const terraceWarmth = new THREE.PointLight(0xff8b55, 3.8, 14, 1.8);
    terraceWarmth.position.set(0, 3.2, 1.1);
    const castleRim = new THREE.SpotLight(0xff8c55, 8.5, 95, Math.PI / 4, 0.76, 1.45);
    castleRim.position.set(22, 19, -18);
    castleRim.target.position.set(0, 7, -43);
    this.atmosphere.add(
      this.hemisphere,
      this.moonLight,
      this.cityGlow,
      companionKey,
      companionKey.target,
      terraceWarmth,
      castleRim,
      castleRim.target,
    );
  }

  private createSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(165, 72, 48),
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

          float noise(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
          }

          void main() {
            vec3 direction = normalize(vPosition);
            float height = direction.y * 0.5 + 0.5;
            vec3 color = mix(uHorizonColor, uZenithColor, smoothstep(0.08, 0.88, height));
            float haze = 1.0 - smoothstep(0.02, 0.3, height);
            color += uHorizonColor * haze * 0.23;
            float milky = exp(-pow((direction.x * 0.52 + direction.y - 0.45) * 4.2, 2.0));
            milky *= smoothstep(0.24, 0.78, height);
            float grain = noise(direction.xz * 130.0 + uTime * 0.002);
            color += mix(uHorizonColor, vec3(0.42, 0.46, 0.68), 0.44) * milky * (0.035 + grain * 0.025);
            float aurora = sin(direction.x * 17.0 + uTime * 0.045 + sin(direction.z * 9.0) * 1.6);
            aurora = pow(max(0.0, aurora), 4.0) * smoothstep(0.34, 0.58, height) * (1.0 - smoothstep(0.7, 0.92, height));
            color += uHorizonColor * aurora * 0.075;
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    );
    sky.name = "layered realtime moon sky";
    this.atmosphere.add(sky);
  }

  private createStars() {
    const count = 2200;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const palette = [new THREE.Color(0xfff6e8), new THREE.Color(0xb7d6ff), new THREE.Color(0xffcde5)];
    for (let index = 0; index < count; index += 1) {
      const radius = 90 + seeded(index, 1) * 58;
      const theta = seeded(index, 2) * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.lerp(-0.08, 0.98, seeded(index, 3)));
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = Math.abs(radius * Math.cos(phi)) + 6;
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 26;
      sizes[index] = 0.72 + seeded(index, 4) * 2.7;
      phases[index] = seeded(index, 5) * Math.PI * 2;
      const color = palette[index % palette.length];
      color.toArray(colors, index * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const stars = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: this.starUniforms,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        vertexShader: /* glsl */ `
          attribute float aSize;
          attribute float aPhase;
          uniform float uTime;
          uniform float uPixelRatio;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vColor = color;
            vAlpha = 0.46 + sin(uTime * (0.62 + fract(aPhase) * 1.3) + aPhase) * 0.3;
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = aSize * uPixelRatio * clamp(96.0 / -viewPosition.z, 0.68, 2.5);
            gl_Position = projectionMatrix * viewPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vec2 point = gl_PointCoord - 0.5;
            float distanceToCenter = length(point);
            float glow = 1.0 - smoothstep(0.06, 0.5, distanceToCenter);
            float core = 1.0 - smoothstep(0.0, 0.085, distanceToCenter);
            float alpha = glow * vAlpha + core * 0.46;
            if (alpha < 0.015) discard;
            gl_FragColor = vec4(vColor, alpha);
          }
        `,
      }),
    );
    stars.name = "depth layered star field";
    this.atmosphere.add(stars);
  }

  private createMoon() {
    const glowTexture = makeGlowTexture();
    this.ownedTextures.push(glowTexture);
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(2.15, 64, 48),
      new THREE.MeshBasicMaterial({ color: 0xe2e9f5, toneMapped: false }),
    );
    moon.position.set(-28, 29, -66);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: glowTexture,
        color: 0xb8cdff,
        transparent: true,
        opacity: 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.position.copy(moon.position);
    halo.scale.set(12, 12, 1);
    this.atmosphere.add(halo, moon);
  }

  private createWater() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(210, 175, 130, 96),
      new THREE.ShaderMaterial({
        uniforms: this.waterUniforms,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          varying vec3 vWorldPosition;
          varying float vWave;
          void main() {
            vUv = uv;
            vec3 displaced = position;
            float wave = sin(displaced.x * 0.34 + uTime * 0.52) * 0.055;
            wave += cos(displaced.y * 0.22 - uTime * 0.41) * 0.043;
            wave += sin((displaced.x + displaced.y) * 0.115 - uTime * 0.29) * 0.027;
            displaced.z += wave;
            vWave = wave;
            vec4 world = modelMatrix * vec4(displaced, 1.0);
            vWorldPosition = world.xyz;
            gl_Position = projectionMatrix * viewMatrix * world;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform vec3 uDeepColor;
          uniform vec3 uNearColor;
          uniform vec3 uAccentColor;
          uniform vec3 uBurstPositions[${BURST_SLOTS}];
          uniform vec3 uBurstColors[${BURST_SLOTS}];
          uniform float uBurstIntensities[${BURST_SLOTS}];
          varying vec2 vUv;
          varying vec3 vWorldPosition;
          varying float vWave;

          void main() {
            float horizon = smoothstep(0.0, 1.0, vUv.y);
            vec3 color = mix(uNearColor, uDeepColor, horizon);
            float broad = pow(max(0.0, sin(vUv.y * 165.0 + sin(vUv.x * 21.0 + uTime * 0.54) * 1.8)), 26.0);
            float fine = pow(max(0.0, sin(vUv.y * 310.0 - uTime * 0.43 + sin(vUv.x * 31.0))), 38.0);
            float moonPath = pow(max(0.0, 1.0 - abs(vUv.x - 0.34) * 6.8), 3.0);
            color += uAccentColor * moonPath * (0.028 + broad * 0.16);
            color += uAccentColor * fine * (1.0 - horizon) * 0.045;
            color += uAccentColor * max(0.0, vWave + 0.06) * 0.035;

            for (int index = 0; index < ${BURST_SLOTS}; index++) {
              float intensity = uBurstIntensities[index];
              float horizontal = exp(-abs(vWorldPosition.x - uBurstPositions[index].x) * 0.17);
              float depth = exp(-abs(vWorldPosition.z - uBurstPositions[index].z) * 0.045);
              float broken = 0.25 + pow(max(0.0, sin(vUv.y * 235.0 + uTime * 0.7 + float(index))), 18.0) * 0.75;
              float reflection = horizontal * depth * broken * intensity;
              color += uBurstColors[index] * reflection * 0.34;
            }
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    );
    water.name = "firework reactive moon water";
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.58, -43);
    this.atmosphere.add(water);
  }

  private createLanterns() {
    const frameMaterial = new THREE.MeshStandardMaterial({ color: 0x4a2717, roughness: 0.48, metalness: 0.65 });
    const glowMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb36b,
      emissive: 0xff6b27,
      emissiveIntensity: 2.8,
      roughness: 0.34,
    });
    for (let index = 0; index < 14; index += 1) {
      const group = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.32, 12), glowMaterial);
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 6, 16), frameMaterial);
      frame.rotation.x = Math.PI / 2;
      frame.position.y = 0.16;
      group.add(body, frame);
      group.position.set(-17 + seeded(index, 40) * 34, 5 + seeded(index, 41) * 8, -27 - seeded(index, 42) * 30);
      group.scale.setScalar(0.72 + seeded(index, 43) * 0.7);
      this.floatingLanterns.push({ object: group, baseY: group.position.y, phase: index * 0.83, speed: 0.28 + seeded(index, 44) * 0.24 });
      this.atmosphere.add(group);
    }
  }

  private createReactiveLights() {
    for (let index = 0; index < BURST_SLOTS; index += 1) {
      const light = new THREE.PointLight(0xffffff, 0, 92, 1.45);
      light.name = `firework-world-light-${index}`;
      this.reactiveBursts.push({
        light,
        position: new THREE.Vector3(),
        color: new THREE.Color(),
        age: Number.POSITIVE_INFINITY,
        lifetime: 1,
        power: 1,
      });
      this.atmosphere.add(light);
    }
  }

  private disposeObject(root: THREE.Object3D) {
    root.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      object.geometry.dispose();
      materialsOf(object).forEach((material) => material.dispose());
    });
  }
}
