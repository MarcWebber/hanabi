import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export type FireworkPattern =
  | "peony"
  | "chrysanthemum"
  | "willow"
  | "heart"
  | "saturn"
  | "star"
  | "text"
  | "custom";

export type PaletteName = "love" | "aurora" | "gold" | "dream";

export type PatternPoint = {
  x: number;
  y: number;
};

export type LaunchOptions = {
  pattern: FireworkPattern;
  palette?: PaletteName;
  points?: PatternPoint[];
  label?: string;
  x?: number;
  y?: number;
  z?: number;
  silent?: boolean;
};

const PALETTES: Record<PaletteName, number[]> = {
  love: [0xff4d9d, 0xff8cc8, 0xffd2e7, 0xff776b, 0xffffff],
  aurora: [0x35f2ca, 0x55b8ff, 0x9b7bff, 0xff77df, 0xe8ffff],
  gold: [0xffb42e, 0xffe39a, 0xfff7d1, 0xff7b36, 0xffffff],
  dream: [0x6d5cff, 0x2ad4ff, 0xff4fe1, 0xffd34e, 0xffffff],
};

const PARTICLE_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uPixelRatio;

  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * clamp(210.0 / -mvPosition.z, 0.65, 5.5);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    float softDisc = 1.0 - smoothstep(0.12, 0.5, distanceToCenter);
    float hotCore = 1.0 - smoothstep(0.0, 0.13, distanceToCenter);
    float alpha = (softDisc * 0.72 + hotCore * 1.45) * vAlpha;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(vColor * (1.1 + hotCore * 1.8), alpha);
  }
`;

type ParticleSpec = {
  velocity: THREE.Vector3;
  color: THREE.Color;
  size: number;
  target?: THREE.Vector3;
  phase: number;
};

type ParticleState = ParticleSpec & {
  position: THREE.Vector3;
  origin: THREE.Vector3;
  history: THREE.Vector3[];
};

function randomUnitVector() {
  const theta = Math.random() * Math.PI * 2;
  const z = Math.random() * 2 - 1;
  const radius = Math.sqrt(1 - z * z);
  return new THREE.Vector3(radius * Math.cos(theta), z, radius * Math.sin(theta));
}

function randomColor(colors: number[], index = Math.floor(Math.random() * colors.length)) {
  return new THREE.Color(colors[index % colors.length]);
}

function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function easeOutBack(value: number) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

class ParticleCloud {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  private readonly particles: ParticleState[];
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly sizes: Float32Array;
  private readonly trailLength: number;
  private readonly lifetime: number;
  private readonly gravity: number;
  private readonly drag: number;
  private readonly formation: boolean;
  private age = 0;

  constructor(
    origin: THREE.Vector3,
    specs: ParticleSpec[],
    options: {
      lifetime: number;
      gravity: number;
      drag: number;
      trailLength: number;
      formation?: boolean;
    },
  ) {
    this.lifetime = options.lifetime;
    this.gravity = options.gravity;
    this.drag = options.drag;
    this.trailLength = options.trailLength;
    this.formation = Boolean(options.formation);
    this.particles = specs.map((spec) => ({
      ...spec,
      position: origin.clone(),
      origin: origin.clone(),
      history: Array.from({ length: options.trailLength }, () => origin.clone()),
    }));

    const renderedCount = specs.length * options.trailLength;
    this.positions = new Float32Array(renderedCount * 3);
    this.alphas = new Float32Array(renderedCount);
    this.sizes = new Float32Array(renderedCount);
    const colors = new Float32Array(renderedCount * 3);

    this.particles.forEach((particle, particleIndex) => {
      for (let trailIndex = 0; trailIndex < options.trailLength; trailIndex += 1) {
        const renderedIndex = particleIndex * options.trailLength + trailIndex;
        colors[renderedIndex * 3] = particle.color.r;
        colors[renderedIndex * 3 + 1] = particle.color.g;
        colors[renderedIndex * 3 + 2] = particle.color.b;
        this.sizes[renderedIndex] = particle.size * Math.pow(1 - trailIndex / options.trailLength, 0.7);
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(this.sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      },
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      toneMapped: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.writeAttributes();
  }

  update(delta: number) {
    this.age += delta;
    const normalizedAge = this.age / this.lifetime;
    const fade = Math.pow(Math.max(0, 1 - normalizedAge), 1.35);

    for (const particle of this.particles) {
      if (this.formation && particle.target) {
        const formationTime = Math.min(1, this.age / 0.86);
        const settleTime = Math.max(0, this.age - 1.05);
        particle.position
          .copy(particle.origin)
          .addScaledVector(particle.target, easeOutBack(formationTime));
        particle.position.y -= settleTime * settleTime * 0.2;
        particle.position.x += Math.sin(this.age * 1.4 + particle.phase) * settleTime * 0.025;
      } else {
        particle.velocity.multiplyScalar(Math.pow(this.drag, delta * 60));
        particle.velocity.y += this.gravity * delta;
        particle.position.addScaledVector(particle.velocity, delta);
      }

      particle.history.pop();
      particle.history.unshift(particle.position.clone());
    }

    this.particles.forEach((particle, particleIndex) => {
      const twinkle = 0.76 + Math.sin(this.age * 11 + particle.phase) * 0.24;
      for (let trailIndex = 0; trailIndex < this.trailLength; trailIndex += 1) {
        const renderedIndex = particleIndex * this.trailLength + trailIndex;
        const point = particle.history[trailIndex];
        this.positions[renderedIndex * 3] = point.x;
        this.positions[renderedIndex * 3 + 1] = point.y;
        this.positions[renderedIndex * 3 + 2] = point.z;
        this.alphas[renderedIndex] =
          fade * twinkle * Math.pow(1 - trailIndex / this.trailLength, 1.6);
      }
    });

    this.writeAttributes();
    return this.age < this.lifetime;
  }

  setPixelRatio(pixelRatio: number) {
    this.points.material.uniforms.uPixelRatio.value = pixelRatio;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }

  private writeAttributes() {
    this.points?.geometry.getAttribute("position") &&
      (this.points.geometry.getAttribute("position").needsUpdate = true);
    this.points?.geometry.getAttribute("aAlpha") &&
      (this.points.geometry.getAttribute("aAlpha").needsUpdate = true);
  }
}

class RocketTrail {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly history: THREE.Vector3[];

  constructor(origin: THREE.Vector3, color: THREE.Color) {
    const count = 44;
    this.positions = new Float32Array(count * 3);
    this.alphas = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    this.history = Array.from({ length: count }, () => origin.clone());

    for (let index = 0; index < count; index += 1) {
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      sizes[index] = 4.8 * Math.pow(1 - index / count, 0.7);
      this.alphas[index] = Math.pow(1 - index / count, 1.5);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));

    const material = new THREE.ShaderMaterial({
      uniforms: { uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) } },
      vertexShader: PARTICLE_VERTEX,
      fragmentShader: PARTICLE_FRAGMENT,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      toneMapped: false,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
  }

  update(position: THREE.Vector3) {
    this.history.pop();
    this.history.unshift(position.clone());
    this.history.forEach((point, index) => {
      this.positions[index * 3] = point.x;
      this.positions[index * 3 + 1] = point.y;
      this.positions[index * 3 + 2] = point.z;
    });
    this.points.geometry.getAttribute("position").needsUpdate = true;
  }

  setPixelRatio(pixelRatio: number) {
    this.points.material.uniforms.uPixelRatio.value = pixelRatio;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

type Rocket = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  trail: RocketTrail;
  start: THREE.Vector3;
  target: THREE.Vector3;
  duration: number;
  age: number;
  options: LaunchOptions;
  color: THREE.Color;
};

type Burst = {
  clouds: ParticleCloud[];
  flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  lifetime: number;
};

function makeShapeSpecs(
  points: PatternPoint[],
  colors: number[],
  scale: number,
  limit = 950,
): ParticleSpec[] {
  if (points.length === 0) return [];
  const stride = Math.max(1, Math.ceil(points.length / limit));
  return points
    .filter((_, index) => index % stride === 0)
    .slice(0, limit)
    .map((point, index) => ({
      velocity: new THREE.Vector3(),
      target: new THREE.Vector3(point.x * scale, point.y * scale, (Math.random() - 0.5) * 0.42),
      color: randomColor(colors, index + Math.floor(index / 17)),
      size: 2.7 + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
    }));
}

function heartPoints(count: number): PatternPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const t = (index / count) * Math.PI * 2;
    const layer = 0.82 + Math.random() * 0.2;
    return {
      x: (Math.pow(Math.sin(t), 3) * layer),
      y:
        ((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) /
          16) *
        layer,
    };
  });
}

function starPoints(count: number): PatternPoint[] {
  const vertices: PatternPoint[] = [];
  for (let index = 0; index < 10; index += 1) {
    const radius = index % 2 === 0 ? 1 : 0.42;
    const angle = Math.PI / 2 + (index * Math.PI) / 5;
    vertices.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return Array.from({ length: count }, (_, index) => {
    const progress = (index / count) * 10;
    const edge = Math.floor(progress) % 10;
    const local = progress - Math.floor(progress);
    const from = vertices[edge];
    const to = vertices[(edge + 1) % 10];
    return {
      x: THREE.MathUtils.lerp(from.x, to.x, local),
      y: THREE.MathUtils.lerp(from.y, to.y, local),
    };
  });
}

function makeBurstClouds(
  origin: THREE.Vector3,
  options: LaunchOptions,
  pixelRatio: number,
): ParticleCloud[] {
  const colors = PALETTES[options.palette ?? "love"];
  const clouds: ParticleCloud[] = [];
  const addCloud = (
    specs: ParticleSpec[],
    cloudOptions: ConstructorParameters<typeof ParticleCloud>[2],
  ) => {
    const cloud = new ParticleCloud(origin, specs, cloudOptions);
    cloud.setPixelRatio(pixelRatio);
    clouds.push(cloud);
  };

  if (options.pattern === "text" || options.pattern === "custom") {
    const specs = makeShapeSpecs(options.points ?? [], colors, options.pattern === "text" ? 7.4 : 6.4);
    addCloud(specs, {
      lifetime: options.pattern === "text" ? 4.6 : 4.1,
      gravity: 0,
      drag: 1,
      trailLength: 3,
      formation: true,
    });
    return clouds;
  }

  if (options.pattern === "heart" || options.pattern === "star") {
    const points = options.pattern === "heart" ? heartPoints(520) : starPoints(460);
    const specs = makeShapeSpecs(points, colors, options.pattern === "heart" ? 5.3 : 5.8, 600);
    addCloud(specs, {
      lifetime: 3.8,
      gravity: 0,
      drag: 1,
      trailLength: 5,
      formation: true,
    });
    const glitter = Array.from({ length: 120 }, () => ({
      velocity: randomUnitVector().multiplyScalar(1.8 + Math.random() * 4.2),
      color: randomColor(colors),
      size: 1.8 + Math.random() * 1.4,
      phase: Math.random() * Math.PI * 2,
    }));
    addCloud(glitter, { lifetime: 2.2, gravity: -1.1, drag: 0.975, trailLength: 3 });
    return clouds;
  }

  if (options.pattern === "saturn") {
    const specs: ParticleSpec[] = [];
    for (let index = 0; index < 420; index += 1) {
      const angle = (index / 420) * Math.PI * 2 + Math.random() * 0.025;
      const radius = 0.82 + Math.random() * 0.34;
      const ringVector = new THREE.Vector3(
        Math.cos(angle) * 9 * radius,
        Math.sin(angle) * 3.1 * radius,
        Math.sin(angle) * 2.2,
      );
      specs.push({
        velocity: ringVector,
        color: randomColor(colors, index),
        size: 2.5 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
      });
    }
    for (let index = 0; index < 210; index += 1) {
      specs.push({
        velocity: randomUnitVector().multiplyScalar(3.8 + Math.random() * 3.8),
        color: randomColor(colors, index + 2),
        size: 2.3 + Math.random() * 1.7,
        phase: Math.random() * Math.PI * 2,
      });
    }
    addCloud(specs, { lifetime: 3.4, gravity: -1.2, drag: 0.978, trailLength: 6 });
    return clouds;
  }

  const isWillow = options.pattern === "willow";
  const isChrysanthemum = options.pattern === "chrysanthemum";
  const count = isChrysanthemum ? 680 : isWillow ? 430 : 520;
  const specs = Array.from({ length: count }, (_, index) => {
    const direction = randomUnitVector();
    if (isWillow) direction.y = Math.abs(direction.y) * 0.9 + 0.12;
    const baseSpeed = isWillow ? 4.3 : isChrysanthemum ? 7.8 : 7.1;
    const ripple = isChrysanthemum ? 1 + Math.sin(index * 0.72) * 0.12 : 1;
    return {
      velocity: direction.multiplyScalar((baseSpeed + Math.random() * 4.4) * ripple),
      color: isWillow ? randomColor(PALETTES.gold, index) : randomColor(colors, index),
      size: (isWillow ? 2.15 : 2.45) + Math.random() * 1.8,
      phase: Math.random() * Math.PI * 2,
    };
  });
  addCloud(specs, {
    lifetime: isWillow ? 4.8 : isChrysanthemum ? 3.5 : 3.0,
    gravity: isWillow ? -2.45 : -1.85,
    drag: isWillow ? 0.988 : 0.975,
    trailLength: isWillow ? 9 : isChrysanthemum ? 7 : 6,
  });

  const innerSpecs = Array.from({ length: isWillow ? 90 : 170 }, (_, index) => ({
    velocity: randomUnitVector().multiplyScalar(2.1 + Math.random() * 4.2),
    color: randomColor(colors, index + 1),
    size: 1.8 + Math.random() * 1.6,
    phase: Math.random() * Math.PI * 2,
  }));
  addCloud(innerSpecs, { lifetime: 2.2, gravity: -1.4, drag: 0.97, trailLength: 3 });
  return clouds;
}

function makeGlowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 1, 64, 64, 64);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.12, "rgba(195,220,255,.8)");
  gradient.addColorStop(0.4, "rgba(115,142,255,.25)");
  gradient.addColorStop(1, "rgba(30,20,110,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

export class FireworkScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 300);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly controls: OrbitControls;
  private readonly resizeObserver: ResizeObserver;
  private readonly rockets: Rocket[] = [];
  private readonly bursts: Burst[] = [];
  private readonly timers = new Set<number>();
  private readonly clock = new THREE.Clock();
  private readonly waterUniforms = { uTime: { value: 0 } };
  private readonly starUniforms = { uTime: { value: 0 }, uPixelRatio: { value: 1 } };
  private frameHandle = 0;
  private disposed = false;
  private autoPlay = true;
  private nextAutoLaunch = 0.8;
  private autoPatternIndex = 0;
  private audioContext: AudioContext | null = null;
  private soundEnabled = false;
  private pixelRatio = 1;

  constructor(private readonly container: HTMLDivElement, onReady?: () => void) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setClearColor(0x010108, 1);
    this.renderer.domElement.setAttribute("aria-label", "可交互的 3D 双人烟花夜景");
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);

    this.camera.position.set(0, 7.2, 24);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 8.4, -18);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.045;
    this.controls.minDistance = 16;
    this.controls.maxDistance = 34;
    this.controls.minPolarAngle = 0.72;
    this.controls.maxPolarAngle = 1.48;
    this.controls.rotateSpeed = 0.34;
    this.controls.zoomSpeed = 0.55;
    this.controls.update();

    const renderPass = new RenderPass(this.scene, this.camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 1.72, 0.72, 0.12);
    bloomPass.threshold = 0.08;
    bloomPass.strength = 1.58;
    bloomPass.radius = 0.68;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(bloomPass);
    this.composer.addPass(new OutputPass());

    this.buildWorld();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.animate();

    const readyTimer = window.setTimeout(() => {
      this.timers.delete(readyTimer);
      onReady?.();
      this.openingSequence();
    }, 260);
    this.timers.add(readyTimer);
  }

  setAutoPlay(enabled: boolean) {
    this.autoPlay = enabled;
    this.nextAutoLaunch = this.clock.elapsedTime + 0.4;
  }

  setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
    if (enabled && !this.audioContext) this.audioContext = new AudioContext();
    if (enabled) void this.audioContext?.resume();
  }

  launch(options: LaunchOptions) {
    const palette = PALETTES[options.palette ?? "love"];
    const color = randomColor(palette);
    const start = new THREE.Vector3((options.x ?? (Math.random() - 0.5) * 20) * 0.3, 0.18, 3.8);
    const target = new THREE.Vector3(
      options.x ?? (Math.random() - 0.5) * 22,
      options.y ?? 10.5 + Math.random() * 8.5,
      options.z ?? -17 - Math.random() * 16,
    );
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.095, 8, 8),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    mesh.position.copy(start);
    const trail = new RocketTrail(start, color);
    trail.setPixelRatio(this.pixelRatio);
    this.scene.add(mesh, trail.points);
    this.rockets.push({
      mesh,
      trail,
      start,
      target,
      duration: 0.82 + Math.random() * 0.34,
      age: 0,
      options,
      color,
    });
    if (!options.silent) this.playLaunchSound();
  }

  launchAt(clientX: number, clientY: number, options: Omit<LaunchOptions, "x" | "y">) {
    const rect = this.container.getBoundingClientRect();
    const normalizedX = (clientX - rect.left) / rect.width;
    const normalizedY = (clientY - rect.top) / rect.height;
    this.launch({
      ...options,
      x: (normalizedX - 0.5) * 27,
      y: THREE.MathUtils.clamp(19 - normalizedY * 10.5, 8.5, 19),
      z: -19 - Math.abs(normalizedX - 0.5) * 7,
    });
  }

  launchFinale(textPoints?: PatternPoint[], palette: PaletteName = "love") {
    this.setAutoPlay(false);
    const schedule = (delay: number, action: () => void) => {
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        action();
      }, delay);
      this.timers.add(timer);
    };
    const sequence: Array<{ delay: number; options: LaunchOptions }> = [
      { delay: 0, options: { pattern: "peony", palette: "aurora", x: -10, y: 13, z: -24 } },
      { delay: 180, options: { pattern: "chrysanthemum", palette: "gold", x: 9, y: 15, z: -26 } },
      { delay: 520, options: { pattern: "heart", palette, x: 0, y: 16.5, z: -22 } },
      { delay: 900, options: { pattern: "saturn", palette: "dream", x: -7, y: 18, z: -31 } },
      { delay: 1060, options: { pattern: "willow", palette: "gold", x: 8, y: 18, z: -30 } },
      { delay: 1430, options: { pattern: "star", palette: "aurora", x: -12, y: 10, z: -22 } },
      { delay: 1600, options: { pattern: "peony", palette, x: 12, y: 11.5, z: -23 } },
    ];
    sequence.forEach((item) => schedule(item.delay, () => this.launch(item.options)));
    if (textPoints?.length) {
      schedule(2300, () =>
        this.launch({ pattern: "text", palette, points: textPoints, x: 0, y: 14.5, z: -22 }),
      );
    }
    schedule(7100, () => this.setAutoPlay(true));
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers.clear();
    this.rockets.forEach((rocket) => {
      rocket.mesh.geometry.dispose();
      rocket.mesh.material.dispose();
      rocket.trail.dispose();
    });
    this.bursts.forEach((burst) => {
      burst.clouds.forEach((cloud) => cloud.dispose());
      burst.flash.geometry.dispose();
      burst.flash.material.dispose();
      burst.ring.geometry.dispose();
      burst.ring.material.dispose();
    });
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
        object.geometry?.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material?.dispose());
      }
    });
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    void this.audioContext?.close();
  }

  private openingSequence() {
    const launches: Array<[number, LaunchOptions]> = [
      [80, { pattern: "peony", palette: "aurora", x: -8, y: 14, z: -26, silent: true }],
      [430, { pattern: "heart", palette: "love", x: 5, y: 16, z: -24, silent: true }],
      [930, { pattern: "willow", palette: "gold", x: 0, y: 18, z: -31, silent: true }],
    ];
    launches.forEach(([delay, options]) => {
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        this.launch(options);
      }, delay);
      this.timers.add(timer);
    });
  }

  private explode(rocket: Rocket) {
    const clouds = makeBurstClouds(rocket.target, rocket.options, this.pixelRatio);
    clouds.forEach((cloud) => this.scene.add(cloud.points));

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 16),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 1,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    flash.position.copy(rocket.target);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 0.82, 72),
      new THREE.MeshBasicMaterial({
        color: rocket.color,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    ring.position.copy(rocket.target);
    ring.lookAt(this.camera.position);
    this.scene.add(flash, ring);
    this.bursts.push({ clouds, flash, ring, age: 0, lifetime: 5.2 });
    this.playBoomSound(rocket.options.pattern === "text" ? 0.72 : 1);
  }

  private updateRockets(delta: number) {
    for (let index = this.rockets.length - 1; index >= 0; index -= 1) {
      const rocket = this.rockets[index];
      rocket.age += delta;
      const progress = Math.min(1, rocket.age / rocket.duration);
      rocket.mesh.position.lerpVectors(rocket.start, rocket.target, easeOutCubic(progress));
      rocket.mesh.position.y += Math.sin(progress * Math.PI) * 1.65;
      const pulse = 1 + Math.sin(rocket.age * 38) * 0.28;
      rocket.mesh.scale.setScalar(pulse);
      rocket.trail.update(rocket.mesh.position);
      if (progress >= 1) {
        this.explode(rocket);
        this.scene.remove(rocket.mesh, rocket.trail.points);
        rocket.mesh.geometry.dispose();
        rocket.mesh.material.dispose();
        rocket.trail.dispose();
        this.rockets.splice(index, 1);
      }
    }
  }

  private updateBursts(delta: number) {
    for (let index = this.bursts.length - 1; index >= 0; index -= 1) {
      const burst = this.bursts[index];
      burst.age += delta;
      let cloudAlive = false;
      burst.clouds.forEach((cloud) => {
        cloudAlive = cloud.update(delta) || cloudAlive;
      });
      burst.flash.scale.setScalar(1 + burst.age * 5.5);
      burst.flash.material.opacity = Math.max(0, 1 - burst.age * 5.3);
      burst.ring.scale.setScalar(1 + burst.age * 5.8);
      burst.ring.material.opacity = Math.max(0, 0.64 - burst.age * 0.95);
      burst.ring.lookAt(this.camera.position);
      if (!cloudAlive && burst.age > burst.lifetime) {
        burst.clouds.forEach((cloud) => {
          this.scene.remove(cloud.points);
          cloud.dispose();
        });
        this.scene.remove(burst.flash, burst.ring);
        burst.flash.geometry.dispose();
        burst.flash.material.dispose();
        burst.ring.geometry.dispose();
        burst.ring.material.dispose();
        this.bursts.splice(index, 1);
      }
    }
  }

  private animate = () => {
    if (this.disposed) return;
    const delta = Math.min(this.clock.getDelta(), 0.034);
    const elapsed = this.clock.elapsedTime;
    this.controls.update();
    this.waterUniforms.uTime.value = elapsed;
    this.starUniforms.uTime.value = elapsed;
    this.updateRockets(delta);
    this.updateBursts(delta);

    if (this.autoPlay && elapsed >= this.nextAutoLaunch) {
      const patterns: FireworkPattern[] = [
        "peony",
        "chrysanthemum",
        "heart",
        "saturn",
        "willow",
        "star",
      ];
      const palettes: PaletteName[] = ["aurora", "love", "gold", "dream"];
      this.launch({
        pattern: patterns[this.autoPatternIndex % patterns.length],
        palette: palettes[this.autoPatternIndex % palettes.length],
        silent: true,
      });
      this.autoPatternIndex += 1;
      this.nextAutoLaunch = elapsed + 1.25 + Math.random() * 1.25;
    }

    this.composer.render();
    this.frameHandle = requestAnimationFrame(this.animate);
  };

  private resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio, width < 700 ? 1.45 : 1.85);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.starUniforms.uPixelRatio.value = this.pixelRatio;
    this.rockets.forEach((rocket) => rocket.trail.setPixelRatio(this.pixelRatio));
    this.bursts.forEach((burst) =>
      burst.clouds.forEach((cloud) => cloud.setPixelRatio(this.pixelRatio)),
    );
  }

  private buildWorld() {
    this.scene.fog = new THREE.FogExp2(0x06091c, 0.0115);
    this.scene.add(new THREE.HemisphereLight(0x7184c8, 0x120c24, 1.1));
    const moonLight = new THREE.DirectionalLight(0x9dbbff, 1.4);
    moonLight.position.set(-22, 30, 12);
    this.scene.add(moonLight);

    this.createSky();
    this.createStars();
    this.createMoon();
    this.createWater();
    this.createHorizon();
    this.createDeck();
    this.createCouple();
  }

  private createSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(145, 48, 32),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        uniforms: { uTime: this.waterUniforms.uTime },
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
          void main() {
            float h = normalize(vPosition).y * 0.5 + 0.5;
            vec3 horizon = vec3(0.075, 0.055, 0.16);
            vec3 zenith = vec3(0.002, 0.004, 0.035);
            vec3 color = mix(horizon, zenith, smoothstep(0.18, 0.88, h));
            float veil = sin(vPosition.x * 0.052 + uTime * 0.035) * sin(vPosition.z * 0.031 - uTime * 0.025);
            veil *= smoothstep(0.34, 0.72, h) * (1.0 - smoothstep(0.72, 0.96, h));
            color += vec3(0.04, 0.025, 0.1) * max(0.0, veil);
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    );
    this.scene.add(sky);
  }

  private createStars() {
    const count = 1700;
    const positions = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const phases = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    const starColors = [new THREE.Color(0xffffff), new THREE.Color(0xaed8ff), new THREE.Color(0xffd8ee)];
    for (let index = 0; index < count; index += 1) {
      const radius = 72 + Math.random() * 52;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.lerp(-0.18, 0.98, Math.random()));
      positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
      positions[index * 3 + 1] = Math.abs(radius * Math.cos(phi)) + 7;
      positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta) - 24;
      sizes[index] = 0.8 + Math.random() * 2.6;
      phases[index] = Math.random() * Math.PI * 2;
      const color = starColors[Math.floor(Math.random() * starColors.length)];
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
          vAlpha = 0.48 + sin(uTime * (0.7 + fract(aPhase) * 1.4) + aPhase) * 0.38;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uPixelRatio * clamp(90.0 / -mvPosition.z, 0.7, 2.5);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - vec2(0.5));
          float a = (1.0 - smoothstep(0.05, 0.5, d)) * vAlpha;
          if (a < 0.02) discard;
          gl_FragColor = vec4(vColor * 1.6, a);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexColors: true,
      toneMapped: false,
    });
    const stars = new THREE.Points(geometry, material);
    stars.frustumCulled = false;
    this.scene.add(stars);
  }

  private createMoon() {
    const moon = new THREE.Mesh(
      new THREE.SphereGeometry(2.1, 40, 40),
      new THREE.MeshBasicMaterial({ color: 0xdce8ff, toneMapped: false }),
    );
    moon.position.set(-25, 26, -58);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: 0xb9c7ff,
        transparent: true,
        opacity: 0.72,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.position.copy(moon.position);
    halo.scale.set(12, 12, 1);
    this.scene.add(halo, moon);
  }

  private createWater() {
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(180, 150, 100, 70),
      new THREE.ShaderMaterial({
        uniforms: this.waterUniforms,
        transparent: false,
        side: THREE.DoubleSide,
        vertexShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            vUv = uv;
            vec3 p = position;
            float wave = sin(p.x * 0.34 + uTime * 0.75) * 0.06 + cos(p.y * 0.22 - uTime * 0.5) * 0.05;
            p.z += wave;
            vWave = wave;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            float ribbon = pow(max(0.0, sin(vUv.y * 170.0 + sin(vUv.x * 20.0 + uTime) * 2.0)), 18.0);
            float moonPath = pow(max(0.0, 1.0 - abs(vUv.x - 0.34) * 6.0), 3.0) * (0.12 + ribbon * 0.45);
            vec3 deep = vec3(0.006, 0.018, 0.055);
            vec3 near = vec3(0.028, 0.035, 0.105);
            vec3 color = mix(near, deep, vUv.y);
            color += vec3(0.16, 0.18, 0.38) * moonPath;
            color += vec3(0.035, 0.028, 0.12) * (vWave + 0.1);
            gl_FragColor = vec4(color, 1.0);
          }
        `,
      }),
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(0, -0.45, -40);
    this.scene.add(water);
  }

  private createHorizon() {
    const mountainMaterial = new THREE.MeshBasicMaterial({ color: 0x07091a });
    for (let index = 0; index < 24; index += 1) {
      const height = 5 + Math.random() * 12;
      const mountain = new THREE.Mesh(
        new THREE.ConeGeometry(5 + Math.random() * 8, height, 5),
        mountainMaterial,
      );
      mountain.position.set(-58 + index * 5.2, height * 0.45 - 0.6, -61 - Math.random() * 9);
      mountain.scale.z = 0.52 + Math.random() * 0.5;
      this.scene.add(mountain);
    }

    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const buildingMaterial = new THREE.MeshBasicMaterial({ color: 0x080a18 });
    const buildings = new THREE.InstancedMesh(buildingGeometry, buildingMaterial, 42);
    const windowGeometry = new THREE.PlaneGeometry(0.09, 0.13);
    const windowMaterial = new THREE.MeshBasicMaterial({
      color: 0xffc76c,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    const windows = new THREE.InstancedMesh(windowGeometry, windowMaterial, 108);
    const matrix = new THREE.Matrix4();
    let windowIndex = 0;
    for (let index = 0; index < 42; index += 1) {
      const x = -42 + index * 2.05 + Math.random();
      const height = 0.8 + Math.random() * 3.2;
      const width = 0.7 + Math.random() * 1.3;
      matrix.compose(
        new THREE.Vector3(x, height * 0.5 - 0.15, -48 - Math.random() * 4),
        new THREE.Quaternion(),
        new THREE.Vector3(width, height, 0.9 + Math.random() * 1.4),
      );
      buildings.setMatrixAt(index, matrix);
      const windowCount = Math.min(3, Math.floor(height));
      for (let row = 0; row < windowCount && windowIndex < 108; row += 1) {
        if (Math.random() > 0.72) continue;
        matrix.compose(
          new THREE.Vector3(x, 0.45 + row * 0.67, -47.42),
          new THREE.Quaternion(),
          new THREE.Vector3(1, 1, 1),
        );
        windows.setMatrixAt(windowIndex, matrix);
        windowIndex += 1;
      }
    }
    windows.count = windowIndex;
    this.scene.add(buildings, windows);
  }

  private createDeck() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x120d18, roughness: 0.82, metalness: 0.08 });
    const deck = new THREE.Mesh(new THREE.BoxGeometry(18, 0.45, 12), wood);
    deck.position.set(0, -0.13, 5.1);
    this.scene.add(deck);

    const seamMaterial = new THREE.MeshBasicMaterial({ color: 0x2b1734 });
    for (let index = -8; index <= 8; index += 1) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 11.5), seamMaterial);
      seam.position.set(index, 0.1, 5.1);
      this.scene.add(seam);
    }

    const benchMaterial = new THREE.MeshStandardMaterial({ color: 0x271521, roughness: 0.72 });
    const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.25, 1), benchMaterial);
    benchSeat.position.set(0, 1.02, 4.25);
    const benchBack = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.35, 0.22), benchMaterial);
    benchBack.position.set(0, 1.6, 4.82);
    this.scene.add(benchSeat, benchBack);

    const railMaterial = new THREE.MeshStandardMaterial({ color: 0x160f1c, roughness: 0.62, metalness: 0.25 });
    for (const x of [-8.3, 8.3]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.35, 0.16), railMaterial);
      post.position.set(x, 0.65, -0.1);
      this.scene.add(post);
    }
    const rail = new THREE.Mesh(new THREE.BoxGeometry(16.8, 0.14, 0.16), railMaterial);
    rail.position.set(0, 1.24, -0.1);
    this.scene.add(rail);

    for (const x of [-7.6, -4.6, 4.6, 7.6]) this.createLantern(x, 0.08, 0.1);
  }

  private createLantern(x: number, y: number, z: number) {
    const frame = new THREE.Mesh(
      new THREE.CylinderGeometry(0.13, 0.18, 0.46, 6),
      new THREE.MeshStandardMaterial({ color: 0x261627, roughness: 0.5, metalness: 0.4 }),
    );
    frame.position.set(x, y + 0.34, z);
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.095, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff9c55, toneMapped: false }),
    );
    glow.position.set(x, y + 0.34, z);
    const light = new THREE.PointLight(0xff704f, 1.6, 4.5, 2);
    light.position.copy(glow.position);
    this.scene.add(frame, glow, light);
  }

  private createCouple() {
    const personOne = this.createPerson(-0.82, 0x402139, 0x17111e, 0xf0b294, false);
    const personTwo = this.createPerson(0.82, 0x1c3556, 0x251420, 0xe7a17e, true);
    this.scene.add(personOne, personTwo);

    const handGlow = new THREE.PointLight(0xff7aac, 1.4, 3.4, 2);
    handGlow.position.set(0, 1.42, 3.63);
    this.scene.add(handGlow);
    const tinyHeart = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff8bb8, toneMapped: false }),
    );
    tinyHeart.position.copy(handGlow.position);
    this.scene.add(tinyHeart);
  }

  private createPerson(
    x: number,
    coatColor: number,
    hairColor: number,
    skinColor: number,
    longHair: boolean,
  ) {
    const group = new THREE.Group();
    const coat = new THREE.MeshStandardMaterial({ color: coatColor, roughness: 0.76 });
    const hair = new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.88 });
    const skin = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.92 });
    const trousers = new THREE.MeshStandardMaterial({ color: 0x0d0d18, roughness: 0.8 });

    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.38, 0.72, 5, 10), coat);
    torso.position.set(x, 1.75, 4.18);
    torso.rotation.x = -0.04;
    group.add(torso);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 16, 12), skin);
    head.position.set(x, 2.58, 4.08);
    group.add(head);
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.325, 16, 10, 0, Math.PI * 2, 0, Math.PI * (longHair ? 0.84 : 0.66)),
      hair,
    );
    hairCap.position.set(x, 2.68, 4.12);
    hairCap.rotation.x = Math.PI;
    group.add(hairCap);
    if (longHair) {
      const backHair = new THREE.Mesh(new THREE.CapsuleGeometry(0.29, 0.56, 4, 10), hair);
      backHair.position.set(x, 2.2, 4.38);
      group.add(backHair);
    }

    const outerArmX = x + Math.sign(x) * 0.43;
    const innerArmX = x - Math.sign(x) * 0.33;
    const outerArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.55, 4, 8), coat);
    outerArm.position.set(outerArmX, 1.78, 4.12);
    outerArm.rotation.z = -Math.sign(x) * 0.15;
    group.add(outerArm);
    const innerArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.105, 0.72, 4, 8), coat);
    innerArm.position.set(innerArmX, 1.65, 3.88);
    innerArm.rotation.z = Math.sign(x) * 0.9;
    innerArm.rotation.x = 0.35;
    group.add(innerArm);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.115, 10, 8), skin);
    hand.position.set(x - Math.sign(x) * 0.69, 1.42, 3.64);
    group.add(hand);

    for (const side of [-0.2, 0.2]) {
      const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.54, 4, 8), trousers);
      thigh.position.set(x + side, 0.9, 3.78);
      thigh.rotation.x = Math.PI / 2.3;
      group.add(thigh);
      const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.62, 4, 8), trousers);
      shin.position.set(x + side, 0.48, 3.5);
      shin.rotation.x = 0.06;
      group.add(shin);
    }
    return group;
  }

  private playLaunchSound() {
    if (!this.soundEnabled || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(120, now);
    oscillator.frequency.exponentialRampToValueAtTime(520, now + 0.72);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.065, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);
    oscillator.connect(gain).connect(this.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.86);
  }

  private playBoomSound(intensity: number) {
    if (!this.soundEnabled || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    const duration = 0.92;
    const buffer = this.audioContext.createBuffer(
      1,
      Math.floor(this.audioContext.sampleRate * duration),
      this.audioContext.sampleRate,
    );
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      const progress = index / data.length;
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - progress, 2.6);
    }
    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;
    const filter = this.audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(95, now + duration);
    const noiseGain = this.audioContext.createGain();
    noiseGain.gain.setValueAtTime(0.18 * intensity, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(filter).connect(noiseGain).connect(this.audioContext.destination);
    noise.start(now);

    const sub = this.audioContext.createOscillator();
    const subGain = this.audioContext.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(68, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.48);
    subGain.gain.setValueAtTime(0.14 * intensity, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    sub.connect(subGain).connect(this.audioContext.destination);
    sub.start(now);
    sub.stop(now + 0.65);
  }
}
