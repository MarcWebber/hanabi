import * as THREE from "three";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export type FireworkPattern =
  | "peony"
  | "chrysanthemum"
  | "willow"
  | "heart"
  | "saturn"
  | "star"
  | "spiral"
  | "butterfly"
  | "palm"
  | "crown"
  | "double-ring"
  | "meteor"
  | "text"
  | "custom";

export type PaletteName = "love" | "aurora" | "gold" | "dream";

export type EnvironmentPreset = "moon-castle" | "rose-garden" | "cloud-observatory";

export type FireworkShowCue = {
  pattern: Exclude<FireworkPattern, "text" | "custom">;
  palette: PaletteName;
  delay: number;
};

export type CameraFilter = "neutral" | "cinema" | "rose" | "moonlight";

export type CameraSettings = {
  focalLength: number;
  aperture: number;
  shutterSeconds: number;
  iso: number;
  focusDistance: number;
  bloom: number;
  filter: CameraFilter;
};

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  focalLength: 28,
  aperture: 2.8,
  shutterSeconds: 1 / 60,
  iso: 320,
  focusDistance: 30,
  bloom: 0.42,
  filter: "cinema",
};

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
  love: [0xe94391, 0xf479b5, 0xffb2d3, 0xe85c55, 0xffd8e8],
  aurora: [0x24c9ad, 0x3f8fe6, 0x8066dc, 0xd657bd, 0xb8eee8],
  gold: [0xe79928, 0xf2c56d, 0xffdfa0, 0xdc672c, 0xffedc8],
  dream: [0x5946d5, 0x239ec9, 0xd63ab7, 0xe7ae36, 0xc7cef2],
};

const PARTICLE_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uPixelRatio;
  uniform float uIntensity;

  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uPixelRatio * clamp(175.0 / -mvPosition.z, 0.58, 4.5);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const PARTICLE_FRAGMENT = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  uniform float uIntensity;

  void main() {
    float distanceToCenter = length(gl_PointCoord - vec2(0.5));
    float softDisc = 1.0 - smoothstep(0.12, 0.5, distanceToCenter);
    float hotCore = 1.0 - smoothstep(0.0, 0.13, distanceToCenter);
    float alpha = (softDisc * 0.48 + hotCore * 0.72) * vAlpha;
    if (alpha < 0.012) discard;
    gl_FragColor = vec4(vColor * (0.68 + hotCore * 0.58) * uIntensity, alpha);
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

function seededValue(index: number, salt = 0) {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
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
        uIntensity: { value: 0.78 },
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

  setIntensity(intensity: number) {
    this.points.material.uniforms.uIntensity.value = intensity;
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
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uIntensity: { value: 0.72 },
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

  setIntensity(intensity: number) {
    this.points.material.uniforms.uIntensity.value = intensity;
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
      size: 1.9 + Math.random() * 1.25,
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

function butterflyPoints(count: number): PatternPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const t = (index / count) * Math.PI * 12;
    const radius = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) + Math.pow(Math.sin(t / 12), 5);
    return {
      x: (Math.sin(t) * radius) / 4.6,
      y: (Math.cos(t) * radius) / 4.6,
    };
  });
}

function crownPoints(count: number): PatternPoint[] {
  const outline: PatternPoint[] = [
    { x: -1, y: -0.52 },
    { x: -0.95, y: 0.35 },
    { x: -0.5, y: -0.05 },
    { x: -0.25, y: 0.78 },
    { x: 0, y: 0.08 },
    { x: 0.28, y: 0.78 },
    { x: 0.52, y: -0.05 },
    { x: 0.96, y: 0.35 },
    { x: 1, y: -0.52 },
    { x: -1, y: -0.52 },
  ];
  return Array.from({ length: count }, (_, index) => {
    const progress = (index / count) * (outline.length - 1);
    const edge = Math.min(outline.length - 2, Math.floor(progress));
    const local = progress - edge;
    return {
      x: THREE.MathUtils.lerp(outline[edge].x, outline[edge + 1].x, local),
      y: THREE.MathUtils.lerp(outline[edge].y, outline[edge + 1].y, local),
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

  if (
    options.pattern === "heart" ||
    options.pattern === "star" ||
    options.pattern === "butterfly" ||
    options.pattern === "crown"
  ) {
    const points = options.pattern === "heart"
      ? heartPoints(520)
      : options.pattern === "star"
        ? starPoints(460)
        : options.pattern === "butterfly"
          ? butterflyPoints(620)
          : crownPoints(500);
    const shapeScale = options.pattern === "heart"
      ? 5.1
      : options.pattern === "butterfly"
        ? 6.5
        : options.pattern === "crown"
          ? 5.7
          : 5.6;
    const specs = makeShapeSpecs(points, colors, shapeScale, 650);
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
      size: 1.25 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
    }));
    addCloud(glitter, { lifetime: 2.2, gravity: -1.1, drag: 0.975, trailLength: 3 });
    return clouds;
  }

  if (options.pattern === "spiral") {
    const points: ParticleSpec[] = [];
    for (let arm = 0; arm < 3; arm += 1) {
      for (let index = 0; index < 190; index += 1) {
        const progress = index / 189;
        const angle = progress * Math.PI * 4.8 + (arm * Math.PI * 2) / 3;
        const radius = 0.35 + progress * 5.8;
        points.push({
          velocity: new THREE.Vector3(),
          target: new THREE.Vector3(
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
            Math.sin(angle * 0.5) * progress * 1.2,
          ),
          color: randomColor(colors, index + arm),
          size: 1.55 + Math.random() * 1.05,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    addCloud(points, {
      lifetime: 4.1,
      gravity: 0,
      drag: 1,
      trailLength: 4,
      formation: true,
    });
    return clouds;
  }

  if (options.pattern === "double-ring") {
    const specs: ParticleSpec[] = [];
    for (let ring = 0; ring < 2; ring += 1) {
      for (let index = 0; index < 300; index += 1) {
        const angle = (index / 300) * Math.PI * 2;
        const speed = 7.4 + ring * 1.6 + Math.random() * 0.35;
        const vector = ring === 0
          ? new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, 0)
          : new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed * 0.36, Math.sin(angle) * speed);
        specs.push({
          velocity: vector,
          color: randomColor(colors, index + ring * 2),
          size: 1.65 + Math.random() * 0.95,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    addCloud(specs, { lifetime: 3.2, gravity: -0.72, drag: 0.982, trailLength: 5 });
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
        size: 1.8 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
      });
    }
    for (let index = 0; index < 210; index += 1) {
      specs.push({
        velocity: randomUnitVector().multiplyScalar(3.8 + Math.random() * 3.8),
        color: randomColor(colors, index + 2),
        size: 1.65 + Math.random() * 1.1,
        phase: Math.random() * Math.PI * 2,
      });
    }
    addCloud(specs, { lifetime: 3.4, gravity: -1.2, drag: 0.978, trailLength: 6 });
    return clouds;
  }

  if (options.pattern === "palm" || options.pattern === "meteor") {
    const specs: ParticleSpec[] = [];
    const branchCount = options.pattern === "palm" ? 15 : 9;
    const particlesPerBranch = options.pattern === "palm" ? 34 : 48;
    for (let branch = 0; branch < branchCount; branch += 1) {
      const angle = (branch / branchCount) * Math.PI * 2;
      const elevation = options.pattern === "meteor" ? 0.2 + branch * 0.045 : 0.45 + Math.random() * 0.5;
      const direction = new THREE.Vector3(Math.cos(angle), elevation, Math.sin(angle)).normalize();
      for (let index = 0; index < particlesPerBranch; index += 1) {
        const spread = randomUnitVector().multiplyScalar(options.pattern === "meteor" ? 0.16 : 0.3);
        specs.push({
          velocity: direction.clone().add(spread).normalize().multiplyScalar(5.4 + index * 0.1),
          color: options.pattern === "palm" ? randomColor(PALETTES.gold, index) : randomColor(colors, branch),
          size: 1.45 + Math.random() * 0.9,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    addCloud(specs, {
      lifetime: options.pattern === "palm" ? 4.5 : 3.7,
      gravity: options.pattern === "palm" ? -2.15 : -1.25,
      drag: 0.988,
      trailLength: options.pattern === "palm" ? 10 : 12,
    });
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
      size: (isWillow ? 1.45 : 1.7) + Math.random() * 1.15,
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
    size: 1.25 + Math.random() * 0.95,
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

const COLOR_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new THREE.Vector3(0.95, 0.97, 1.05) },
    uSaturation: { value: 0.92 },
    uContrast: { value: 1.08 },
    uVignette: { value: 0.22 },
    uLift: { value: 0.018 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uTint;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    uniform float uLift;
    varying vec2 vUv;

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luminance), color, uSaturation);
      color = (color - 0.5) * uContrast + 0.5;
      color = max(vec3(0.0), color * uTint + uLift);
      vec2 centered = vUv - 0.5;
      float vignette = smoothstep(0.78, 0.18, dot(centered, centered));
      color *= mix(1.0 - uVignette, 1.0, vignette);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
};

const FILTER_GRADES: Record<
  CameraFilter,
  { tint: [number, number, number]; saturation: number; contrast: number; vignette: number; lift: number }
> = {
  neutral: { tint: [1, 1, 1], saturation: 0.96, contrast: 1.02, vignette: 0.13, lift: 0.008 },
  cinema: { tint: [0.92, 0.96, 1.07], saturation: 0.9, contrast: 1.1, vignette: 0.23, lift: 0.014 },
  rose: { tint: [1.07, 0.91, 0.98], saturation: 0.94, contrast: 1.06, vignette: 0.2, lift: 0.012 },
  moonlight: { tint: [0.82, 0.94, 1.13], saturation: 0.78, contrast: 1.13, vignette: 0.28, lift: 0.006 },
};

const ENVIRONMENT_SETTINGS: Record<
  EnvironmentPreset,
  {
    fog: number;
    clear: number;
    horizon: number;
    zenith: number;
    waterDeep: number;
    waterNear: number;
    waterAccent: number;
  }
> = {
  "moon-castle": {
    fog: 0x070a1a,
    clear: 0x010108,
    horizon: 0x172044,
    zenith: 0x01031a,
    waterDeep: 0x02102b,
    waterNear: 0x0b2653,
    waterAccent: 0x6a79bd,
  },
  "rose-garden": {
    fog: 0x13091c,
    clear: 0x06010d,
    horizon: 0x381736,
    zenith: 0x08031c,
    waterDeep: 0x170a29,
    waterNear: 0x3b173e,
    waterAccent: 0xd778a9,
  },
  "cloud-observatory": {
    fog: 0x081326,
    clear: 0x010914,
    horizon: 0x16334d,
    zenith: 0x010b20,
    waterDeep: 0x031a2d,
    waterNear: 0x0b3a51,
    waterAccent: 0x76d3d8,
  },
};

export class FireworkScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46.4, 1, 0.08, 300);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly bokehPass: BokehPass;
  private readonly gradePass: ShaderPass;
  private readonly resizeObserver: ResizeObserver;
  private readonly rockets: Rocket[] = [];
  private readonly bursts: Burst[] = [];
  private readonly timers = new Set<number>();
  private readonly clock = new THREE.Timer();
  private readonly waterUniforms = {
    uTime: { value: 0 },
    uDeepColor: { value: new THREE.Color(0x02102b) },
    uNearColor: { value: new THREE.Color(0x0b2653) },
    uAccentColor: { value: new THREE.Color(0x6a79bd) },
  };
  private readonly skyUniforms = {
    uTime: this.waterUniforms.uTime,
    uHorizonColor: { value: new THREE.Color(0x172044) },
    uZenithColor: { value: new THREE.Color(0x01031a) },
  };
  private readonly starUniforms = { uTime: { value: 0 }, uPixelRatio: { value: 1 } };
  private readonly environmentGroups = new Map<EnvironmentPreset, THREE.Group>();
  private readonly animatedDecorations: Array<{
    object: THREE.Object3D;
    mode: "float" | "spin" | "sway";
    speed: number;
    phase: number;
    baseY: number;
  }> = [];
  private readonly driftingClouds: Array<{ object: THREE.Group; startX: number; range: number; speed: number }> = [];
  private readonly eyeAnchor = new THREE.Vector3(-0.72, 2.52, 3.48);
  private frameHandle = 0;
  private disposed = false;
  private autoPlay = true;
  private nextAutoLaunch = 0.8;
  private autoPatternIndex = 0;
  private audioContext: AudioContext | null = null;
  private soundEnabled = false;
  private pixelRatio = 1;
  private paused = false;
  private visualTime = 0;
  private yaw = 0;
  private pitch = -0.36;
  private lookPointer: { id: number; x: number; y: number } | null = null;
  private cameraSettings: CameraSettings = { ...DEFAULT_CAMERA_SETTINGS };
  private environment: EnvironmentPreset = "moon-castle";

  constructor(private readonly container: HTMLDivElement, onReady?: () => void) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.72;
    this.renderer.setClearColor(0x010108, 1);
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.setAttribute("aria-label", "坐在湖畔仰望的可交互 3D 烟花夜景，拖动可转动视线");
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.style.touchAction = "none";
    container.appendChild(this.renderer.domElement);
    this.clock.connect(document);

    this.resetView();
    this.renderer.domElement.addEventListener("pointerdown", this.handleLookStart);
    this.renderer.domElement.addEventListener("pointermove", this.handleLookMove);
    this.renderer.domElement.addEventListener("pointerup", this.handleLookEnd);
    this.renderer.domElement.addEventListener("pointercancel", this.handleLookEnd);

    const renderPass = new RenderPass(this.scene, this.camera);
    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus: DEFAULT_CAMERA_SETTINGS.focusDistance,
      aperture: 0.000016,
      maxblur: 0.0022,
    });
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.52, 0.34, 0.42);
    this.bloomPass.threshold = 0.38;
    this.bloomPass.strength = 0.52;
    this.bloomPass.radius = 0.34;
    this.gradePass = new ShaderPass(COLOR_GRADE_SHADER);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bokehPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());

    this.buildWorld();
    this.setCameraSettings(DEFAULT_CAMERA_SETTINGS);
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
    this.nextAutoLaunch = this.visualTime + 0.4;
  }

  setEnvironment(preset: EnvironmentPreset) {
    this.environment = preset;
    this.environmentGroups.forEach((group, id) => {
      group.visible = id === preset;
    });
    const settings = ENVIRONMENT_SETTINGS[preset];
    this.renderer.setClearColor(settings.clear, 1);
    if (this.scene.fog instanceof THREE.FogExp2) {
      this.scene.fog.color.setHex(settings.fog);
      this.scene.fog.density = preset === "rose-garden" ? 0.011 : 0.0092;
    }
    this.skyUniforms.uHorizonColor.value.setHex(settings.horizon);
    this.skyUniforms.uZenithColor.value.setHex(settings.zenith);
    this.waterUniforms.uDeepColor.value.setHex(settings.waterDeep);
    this.waterUniforms.uNearColor.value.setHex(settings.waterNear);
    this.waterUniforms.uAccentColor.value.setHex(settings.waterAccent);
  }

  setPaused(paused: boolean) {
    this.paused = paused;
  }

  setCameraSettings(settings: CameraSettings) {
    this.cameraSettings = { ...settings };
    const sensorHeight = 24;
    this.camera.fov = THREE.MathUtils.radToDeg(
      2 * Math.atan(sensorHeight / (2 * THREE.MathUtils.clamp(settings.focalLength, 16, 120))),
    );
    this.camera.updateProjectionMatrix();

    const shutterStops = Math.log2(settings.shutterSeconds / (1 / 60));
    const isoStops = Math.log2(settings.iso / 320);
    const apertureStops = Math.log2(Math.pow(2.8 / settings.aperture, 2));
    const exposureStops = (shutterStops + isoStops + apertureStops) * 0.2;
    this.renderer.toneMappingExposure = THREE.MathUtils.clamp(0.72 * Math.pow(2, exposureStops), 0.38, 1.08);

    this.bloomPass.threshold = THREE.MathUtils.lerp(0.58, 0.28, settings.bloom);
    this.bloomPass.strength = THREE.MathUtils.lerp(0.16, 0.82, settings.bloom);
    this.bloomPass.radius = THREE.MathUtils.lerp(0.18, 0.46, settings.bloom);
    this.bokehPass.uniforms.focus.value = settings.focusDistance;
    this.bokehPass.uniforms.aperture.value = 0.000014 * Math.pow(2.8 / settings.aperture, 1.35);
    this.bokehPass.uniforms.maxblur.value = THREE.MathUtils.lerp(
      0.0005,
      0.0038,
      THREE.MathUtils.clamp((16 - settings.aperture) / 14.6, 0, 1),
    );
    this.bokehPass.enabled = settings.aperture < 13;

    const grade = FILTER_GRADES[settings.filter];
    this.gradePass.uniforms.uTint.value.set(...grade.tint);
    this.gradePass.uniforms.uSaturation.value = grade.saturation;
    this.gradePass.uniforms.uContrast.value = grade.contrast;
    this.gradePass.uniforms.uVignette.value = grade.vignette;
    this.gradePass.uniforms.uLift.value = grade.lift;

    const particleIntensity = THREE.MathUtils.clamp(
      0.55 + settings.bloom * 0.22 + exposureStops * 0.04,
      0.48,
      0.82,
    );
    this.rockets.forEach((rocket) => rocket.trail.setIntensity(particleIntensity * 0.9));
    this.bursts.forEach((burst) =>
      burst.clouds.forEach((cloud) => cloud.setIntensity(particleIntensity)),
    );
  }

  resetView() {
    this.yaw = 0;
    this.pitch = -0.36;
    this.camera.position.copy(this.eyeAnchor);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  captureFrame() {
    this.composer.render();
    return this.renderer.domElement.toDataURL("image/png");
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
      new THREE.SphereGeometry(0.065, 8, 8),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    mesh.position.copy(start);
    const trail = new RocketTrail(start, color);
    trail.setPixelRatio(this.pixelRatio);
    trail.setIntensity(0.55 + this.cameraSettings.bloom * 0.18);
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
    const pointer = new THREE.Vector3(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
      0.35,
    );
    const direction = pointer.unproject(this.camera).sub(this.camera.position).normalize();
    const target = this.camera.position.clone().addScaledVector(direction, 34);
    this.launch({
      ...options,
      x: THREE.MathUtils.clamp(target.x, -24, 24),
      y: THREE.MathUtils.clamp(target.y, 8.5, 22),
      z: Math.min(-13, target.z),
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

  launchSequence(cues: FireworkShowCue[]) {
    this.setAutoPlay(false);
    let elapsed = 0;
    cues.slice(0, 12).forEach((cue, index) => {
      elapsed += Math.max(0.25, cue.delay) * 1000;
      const side = index % 2 === 0 ? -1 : 1;
      const lane = Math.floor(index / 2) % 3;
      const timer = window.setTimeout(() => {
        this.timers.delete(timer);
        this.launch({
          pattern: cue.pattern,
          palette: cue.palette,
          x: side * (4.5 + lane * 3.7),
          y: 12.5 + (index % 4) * 1.8,
          z: -22 - lane * 4.5,
        });
      }, elapsed);
      this.timers.add(timer);
    });
    return elapsed + 2600;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    this.resizeObserver.disconnect();
    this.renderer.domElement.removeEventListener("pointerdown", this.handleLookStart);
    this.renderer.domElement.removeEventListener("pointermove", this.handleLookMove);
    this.renderer.domElement.removeEventListener("pointerup", this.handleLookEnd);
    this.renderer.domElement.removeEventListener("pointercancel", this.handleLookEnd);
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
    this.clock.dispose();
    void this.audioContext?.close();
  }

  private handleLookStart = (event: PointerEvent) => {
    if (event.button !== 0) return;
    this.lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private handleLookMove = (event: PointerEvent) => {
    if (!this.lookPointer || this.lookPointer.id !== event.pointerId) return;
    const deltaX = event.clientX - this.lookPointer.x;
    const deltaY = event.clientY - this.lookPointer.y;
    this.lookPointer.x = event.clientX;
    this.lookPointer.y = event.clientY;
    this.yaw = THREE.MathUtils.clamp(this.yaw - deltaX * 0.0032, -1.72, 1.72);
    this.pitch = THREE.MathUtils.clamp(this.pitch + deltaY * 0.003, -1.12, 0.34);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  };

  private handleLookEnd = (event: PointerEvent) => {
    if (!this.lookPointer || this.lookPointer.id !== event.pointerId) return;
    this.lookPointer = null;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
  };

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
    const particleIntensity = 0.55 + this.cameraSettings.bloom * 0.22;
    clouds.forEach((cloud) => {
      cloud.setIntensity(particleIntensity);
      this.scene.add(cloud.points);
    });

    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 14, 14),
      new THREE.MeshBasicMaterial({
        color: rocket.color,
        transparent: true,
        opacity: 0.42,
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
        opacity: 0.32,
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
      burst.flash.scale.setScalar(1 + burst.age * 4.2);
      burst.flash.material.opacity = Math.max(0, 0.42 - burst.age * 3.8);
      burst.ring.scale.setScalar(1 + burst.age * 5.8);
      burst.ring.material.opacity = Math.max(0, 0.3 - burst.age * 0.62);
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
    this.clock.update();
    const delta = Math.min(this.clock.getDelta(), 0.034);
    if (!this.paused) this.visualTime += delta;
    const elapsed = this.visualTime;
    this.waterUniforms.uTime.value = elapsed;
    this.starUniforms.uTime.value = elapsed;
    if (!this.paused) {
      this.updateRockets(delta);
      this.updateBursts(delta);
      this.updateEnvironment(elapsed, delta);
    }

    if (!this.paused && this.autoPlay && elapsed >= this.nextAutoLaunch) {
      const patterns: FireworkPattern[] = [
        "peony",
        "chrysanthemum",
        "heart",
        "saturn",
        "willow",
        "star",
        "spiral",
        "butterfly",
        "palm",
        "double-ring",
        "crown",
        "meteor",
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

  private updateEnvironment(elapsed: number, delta: number) {
    this.animatedDecorations.forEach((decoration) => {
      if (decoration.mode === "float") {
        decoration.object.position.y = decoration.baseY + Math.sin(elapsed * decoration.speed + decoration.phase) * 0.34;
        decoration.object.rotation.y += delta * decoration.speed * 0.18;
      } else if (decoration.mode === "spin") {
        decoration.object.rotation.z += delta * decoration.speed;
      } else {
        decoration.object.rotation.z = Math.sin(elapsed * decoration.speed + decoration.phase) * 0.09;
        decoration.object.rotation.y = Math.sin(elapsed * decoration.speed * 0.7 + decoration.phase) * 0.16;
      }
    });
    this.driftingClouds.forEach((cloud) => {
      cloud.object.position.x += delta * cloud.speed;
      if (cloud.object.position.x > cloud.startX + cloud.range) {
        cloud.object.position.x = cloud.startX - cloud.range;
      }
    });
  }

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
    this.scene.fog = new THREE.FogExp2(0x05091a, 0.0092);
    this.scene.add(new THREE.HemisphereLight(0x526b9e, 0x120b1c, 0.68));
    const moonLight = new THREE.DirectionalLight(0x8ca9d8, 0.82);
    moonLight.position.set(-22, 30, 12);
    this.scene.add(moonLight);

    this.createSky();
    this.createStars();
    this.createMoon();
    this.createWater();
    this.createHorizon();
    this.createLakeIslands();
    this.createDeck();
    this.createEnvironmentPresets();
    this.createFireflies();
    this.createCouple();
    this.setEnvironment(this.environment);
  }

  private createSky() {
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(145, 48, 32),
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
            vec3 color = mix(uHorizonColor, uZenithColor, smoothstep(0.18, 0.88, h));
            float veil = sin(vPosition.x * 0.052 + uTime * 0.035) * sin(vPosition.z * 0.031 - uTime * 0.025);
            veil *= smoothstep(0.34, 0.72, h) * (1.0 - smoothstep(0.72, 0.96, h));
            color += mix(uHorizonColor, vec3(0.02, 0.07, 0.13), 0.46) * max(0.0, veil) * 0.48;
            float horizonGlow = 1.0 - smoothstep(0.1, 0.4, h);
            color += uHorizonColor * horizonGlow * 0.18;
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
          gl_FragColor = vec4(vColor * 1.08, a * 0.78);
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
      new THREE.MeshBasicMaterial({ color: 0xb7c9df, toneMapped: false }),
    );
    moon.position.set(-25, 26, -58);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: makeGlowTexture(),
        color: 0xb9c7ff,
        transparent: true,
        opacity: 0.36,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    halo.position.copy(moon.position);
    halo.scale.set(9.5, 9.5, 1);
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
          uniform vec3 uDeepColor;
          uniform vec3 uNearColor;
          uniform vec3 uAccentColor;
          varying vec2 vUv;
          varying float vWave;
          void main() {
            vUv = uv;
            vec3 p = position;
            float wave = sin(p.x * 0.34 + uTime * 0.58) * 0.045 + cos(p.y * 0.22 - uTime * 0.42) * 0.036;
            wave += sin((p.x + p.y) * 0.12 - uTime * 0.26) * 0.025;
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
            float ribbon = pow(max(0.0, sin(vUv.y * 190.0 + sin(vUv.x * 22.0 + uTime * 0.7) * 2.1)), 22.0);
            float fineRipple = pow(max(0.0, sin(vUv.y * 315.0 - uTime * 0.48 + sin(vUv.x * 31.0))), 32.0);
            float moonPath = pow(max(0.0, 1.0 - abs(vUv.x - 0.34) * 7.0), 3.0) * (0.08 + ribbon * 0.32);
            vec3 color = mix(uNearColor, uDeepColor, vUv.y);
            color += uAccentColor * moonPath * 0.56;
            color += uAccentColor * fineRipple * (1.0 - vUv.y) * 0.11;
            color += uAccentColor * (vWave + 0.08) * 0.08;
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
    const layers = [
      { count: 17, z: -78, color: 0x111a39, height: 11, width: 13 },
      { count: 20, z: -65, color: 0x0b122b, height: 14, width: 11 },
      { count: 24, z: -53, color: 0x060b1c, height: 9, width: 8 },
    ];
    layers.forEach((layer, layerIndex) => {
      const material = new THREE.MeshBasicMaterial({ color: layer.color });
      for (let index = 0; index < layer.count; index += 1) {
        const rhythm = Math.sin(index * 2.17 + layerIndex) * 0.5 + 0.5;
        const height = layer.height * (0.46 + rhythm * 0.75);
        const mountain = new THREE.Mesh(
          new THREE.ConeGeometry(layer.width * (0.65 + rhythm * 0.45), height, 5),
          material,
        );
        mountain.position.set(
          -62 + index * (124 / (layer.count - 1)),
          height * 0.44 - 0.65,
          layer.z - Math.sin(index * 1.31) * 3,
        );
        mountain.scale.z = 0.56 + rhythm * 0.38;
        mountain.rotation.y = rhythm * 0.5;
        this.scene.add(mountain);
      }
    });

    const ridgeLine = new THREE.Mesh(
      new THREE.BoxGeometry(130, 0.55, 4),
      new THREE.MeshBasicMaterial({ color: 0x050916 }),
    );
    ridgeLine.position.set(0, -0.1, -49);
    this.scene.add(ridgeLine);

    for (let index = 0; index < 18; index += 1) {
      const x = -46 + index * 5.4;
      const pine = new THREE.Mesh(
        new THREE.ConeGeometry(0.85 + (index % 3) * 0.22, 4.2 + (index % 4) * 0.72, 7),
        new THREE.MeshBasicMaterial({ color: 0x050916 }),
      );
      pine.position.set(x, 1.5, -47 + Math.sin(index) * 1.2);
      this.scene.add(pine);
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

  private createLakeIslands() {
    const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x101629, roughness: 0.96 });
    const mossMaterial = new THREE.MeshStandardMaterial({ color: 0x18273a, roughness: 0.92 });
    const islands = [
      { x: -20, z: -31, sx: 4.7, sz: 2.8 },
      { x: 22, z: -38, sx: 5.2, sz: 3.1 },
    ];
    islands.forEach((island, index) => {
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1.5, 0), rockMaterial);
      rock.position.set(island.x, -0.58, island.z);
      rock.scale.set(island.sx, 0.72, island.sz);
      const moss = new THREE.Mesh(new THREE.DodecahedronGeometry(1.12, 1), mossMaterial);
      moss.position.set(island.x, -0.12, island.z);
      moss.scale.set(island.sx * 0.86, 0.46, island.sz * 0.84);
      this.scene.add(rock, moss);

      if (index === 0) {
        const timber = new THREE.MeshStandardMaterial({ color: 0x171321, roughness: 0.78 });
        const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.15, 2.15, 0.18, 8), timber);
        floor.position.set(island.x, 0.5, island.z);
        this.scene.add(floor);
        for (const offsetX of [-1.35, 1.35]) {
          for (const offsetZ of [-0.85, 0.85]) {
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.2, 8), timber);
            post.position.set(island.x + offsetX, 2.05, island.z + offsetZ);
            this.scene.add(post);
          }
        }
        const roof = new THREE.Mesh(
          new THREE.ConeGeometry(3.25, 1.15, 4),
          new THREE.MeshStandardMaterial({ color: 0x1b1630, roughness: 0.7, metalness: 0.08 }),
        );
        roof.position.set(island.x, 3.85, island.z);
        roof.rotation.y = Math.PI / 4;
        roof.scale.z = 0.78;
        this.scene.add(roof);
        this.createLantern(island.x, 0.7, island.z);
      }
    });
  }

  private createEnvironmentPresets() {
    const castle = new THREE.Group();
    castle.name = "moon-castle";
    this.createCastleEnvironment(castle);

    const garden = new THREE.Group();
    garden.name = "rose-garden";
    this.createRoseGardenEnvironment(garden);

    const observatory = new THREE.Group();
    observatory.name = "cloud-observatory";
    this.createObservatoryEnvironment(observatory);

    this.environmentGroups.set("moon-castle", castle);
    this.environmentGroups.set("rose-garden", garden);
    this.environmentGroups.set("cloud-observatory", observatory);
    this.scene.add(castle, garden, observatory);
  }

  private createCastleEnvironment(parent: THREE.Group) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x252a42, roughness: 0.88, metalness: 0.04 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x3c3958, roughness: 0.74, metalness: 0.12 });
    const roof = new THREE.MeshStandardMaterial({ color: 0x251d42, roughness: 0.68, metalness: 0.16 });
    const warmWindow = new THREE.MeshBasicMaterial({ color: 0xf5b86b, toneMapped: false });

    const keep = new THREE.Mesh(new THREE.BoxGeometry(18, 7.2, 7), stone);
    keep.position.set(0, 3.15, -39);
    parent.add(keep);
    const keepCrown = new THREE.Mesh(new THREE.BoxGeometry(19.1, 0.65, 8.1), trim);
    keepCrown.position.set(0, 7, -39);
    parent.add(keepCrown);

    for (let index = 0; index < 13; index += 1) {
      const x = -8.4 + index * 1.4;
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.78, 1.05, 0.85), trim);
      merlon.position.set(x, 7.72, -35.35);
      parent.add(merlon);
    }
    for (let row = 0; row < 2; row += 1) {
      for (let column = 0; column < 7; column += 1) {
        const window = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.72, 0.06), warmWindow);
        window.position.set(-6.6 + column * 2.2, 2.2 + row * 2.15, -35.47);
        parent.add(window);
      }
    }

    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(1.55, 0.28, 8, 38, Math.PI),
      trim,
    );
    arch.position.set(0, 2.18, -35.28);
    parent.add(arch);
    const gate = new THREE.Mesh(new THREE.BoxGeometry(3.1, 2.3, 0.28), new THREE.MeshStandardMaterial({ color: 0x16111f, roughness: 0.9 }));
    gate.position.set(0, 0.84, -35.4);
    parent.add(gate);

    [
      [-10.8, -38, 2.8, 10.8],
      [10.8, -38, 2.8, 10.8],
      [-7.6, -43, 2.35, 9.2],
      [7.6, -43, 2.35, 9.2],
      [-11.2, -5.8, 1.9, 7.6],
      [11.2, -5.8, 1.9, 7.6],
    ].forEach(([x, z, radius, height], index) => {
      this.createCastleTower(parent, x, z, radius, height, index % 2 === 0 ? 0x2f234f : 0x3a2447);
    });

    const bridge = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.55, 3.1), trim);
    bridge.position.set(0, 0.05, -32.8);
    parent.add(bridge);
    for (const side of [-1, 1]) {
      const bridgeRail = new THREE.Mesh(new THREE.BoxGeometry(10.8, 0.48, 0.22), stone);
      bridgeRail.position.set(0, 0.5, -32.8 + side * 1.38);
      parent.add(bridgeRail);
    }

    const castleGlow = new THREE.PointLight(0xef8f66, 2.3, 27, 2);
    castleGlow.position.set(0, 5.4, -34.5);
    parent.add(castleGlow);
    this.createCloud(parent, -24, 9.2, -47, 1.2, 27);
    this.createCloud(parent, 16, 14.5, -61, 0.8, 31);
  }

  private createCastleTower(
    parent: THREE.Group,
    x: number,
    z: number,
    radius: number,
    height: number,
    roofColor: number,
  ) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x272b43, roughness: 0.9, metalness: 0.03 });
    const trim = new THREE.MeshStandardMaterial({ color: 0x44425f, roughness: 0.76, metalness: 0.1 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius * 1.08, height, 10), stone);
    tower.position.set(x, height * 0.5 - 0.35, z);
    parent.add(tower);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(radius * 1.18, radius * 1.18, 0.55, 10), trim);
    crown.position.set(x, height - 0.12, z);
    parent.add(crown);
    for (let index = 0; index < 10; index += 1) {
      const angle = (index / 10) * Math.PI * 2;
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.9, 0.62), trim);
      merlon.position.set(
        x + Math.cos(angle) * radius * 1.05,
        height + 0.48,
        z + Math.sin(angle) * radius * 1.05,
      );
      merlon.rotation.y = -angle;
      parent.add(merlon);
    }
    const roof = new THREE.Mesh(
      new THREE.ConeGeometry(radius * 1.32, radius * 2.5, 10),
      new THREE.MeshStandardMaterial({ color: roofColor, roughness: 0.7, metalness: 0.14 }),
    );
    roof.position.set(x, height + radius * 1.55, z);
    roof.rotation.y = Math.PI / 10;
    parent.add(roof);

    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xf1ae67, toneMapped: false });
    for (const offsetY of [height * 0.35, height * 0.63]) {
      const window = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.82), windowMaterial);
      window.position.set(x, offsetY, z + radius * 1.01);
      parent.add(window);
    }

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 2.9, 6),
      new THREE.MeshStandardMaterial({ color: 0xa78f72, metalness: 0.55, roughness: 0.4 }),
    );
    pole.position.set(x, height + radius * 2.7, z);
    parent.add(pole);
    const flag = new THREE.Mesh(
      new THREE.PlaneGeometry(1.35, 0.72, 5, 2),
      new THREE.MeshBasicMaterial({ color: 0x9d315e, side: THREE.DoubleSide }),
    );
    flag.position.set(x + 0.72, height + radius * 3.35, z);
    parent.add(flag);
    this.animatedDecorations.push({ object: flag, mode: "sway", speed: 1.35, phase: x * 0.4, baseY: flag.position.y });
  }

  private createRoseGardenEnvironment(parent: THREE.Group) {
    this.createGarden(parent);
    const metal = new THREE.MeshStandardMaterial({ color: 0x685670, roughness: 0.48, metalness: 0.54 });
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xb37aab,
      transparent: true,
      opacity: 0.17,
      roughness: 0.18,
      metalness: 0.04,
      transmission: 0.48,
      side: THREE.DoubleSide,
    });
    const island = new THREE.Mesh(
      new THREE.CylinderGeometry(8.2, 9.1, 1.1, 12),
      new THREE.MeshStandardMaterial({ color: 0x1b1830, roughness: 0.92 }),
    );
    island.position.set(0, -0.14, -31);
    parent.add(island);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(6.5, 28, 16, 0, Math.PI * 2, 0, Math.PI / 2), glass);
    dome.position.set(0, 0.44, -31);
    parent.add(dome);
    for (let index = 0; index < 8; index += 1) {
      const angle = (index / 8) * Math.PI * 2;
      const rib = new THREE.Mesh(new THREE.TorusGeometry(6.52, 0.055, 6, 52, Math.PI), metal);
      rib.position.set(0, 0.44, -31);
      rib.rotation.y = angle;
      parent.add(rib);
    }
    const roseLight = new THREE.PointLight(0xe87baa, 2.6, 29, 2);
    roseLight.position.set(0, 4.2, -30);
    parent.add(roseLight);

    const petalCount = 220;
    const positions = new Float32Array(petalCount * 3);
    const phases = new Float32Array(petalCount);
    for (let index = 0; index < petalCount; index += 1) {
      positions[index * 3] = (seededValue(index, 2) - 0.5) * 31;
      positions[index * 3 + 1] = seededValue(index, 3) * 10;
      positions[index * 3 + 2] = -8 - seededValue(index, 4) * 32;
      phases[index] = seededValue(index, 5) * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const petals = new THREE.Points(
      geometry,
      new THREE.ShaderMaterial({
        uniforms: { uTime: this.waterUniforms.uTime, uPixelRatio: this.starUniforms.uPixelRatio },
        vertexShader: /* glsl */ `
          attribute float aPhase;
          uniform float uTime;
          uniform float uPixelRatio;
          varying float vAlpha;
          void main() {
            vec3 p = position;
            p.y = mod(position.y - uTime * (0.28 + fract(aPhase) * 0.16), 10.0);
            p.x += sin(uTime * 0.34 + aPhase) * 0.8;
            p.z += cos(uTime * 0.25 + aPhase) * 0.3;
            vAlpha = 0.34 + sin(aPhase + uTime) * 0.18;
            vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = (2.4 + fract(aPhase) * 2.6) * uPixelRatio * clamp(19.0 / -mvPosition.z, 0.65, 2.4);
            gl_Position = projectionMatrix * mvPosition;
          }
        `,
        fragmentShader: /* glsl */ `
          varying float vAlpha;
          void main() {
            vec2 p = gl_PointCoord - vec2(0.5);
            float alpha = (1.0 - smoothstep(0.2, 0.52, length(vec2(p.x * 1.8, p.y)))) * vAlpha;
            gl_FragColor = vec4(0.95, 0.45, 0.68, alpha);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    );
    parent.add(petals);
    this.createCloud(parent, -20, 11, -52, 0.7, 29);
  }

  private createObservatoryEnvironment(parent: THREE.Group) {
    const stone = new THREE.MeshStandardMaterial({ color: 0x152d3f, roughness: 0.74, metalness: 0.18 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x5b8793, roughness: 0.32, metalness: 0.72 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(8.8, 10.4, 1.35, 12), stone);
    platform.position.set(0, -0.02, -33);
    parent.add(platform);
    const spire = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.5, 8, 10), stone);
    spire.position.set(0, 4.1, -33);
    parent.add(spire);

    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(1.32, 28, 22),
      new THREE.MeshBasicMaterial({ color: 0x7de1dd, transparent: true, opacity: 0.84, toneMapped: false }),
    );
    orb.position.set(0, 10.7, -33);
    parent.add(orb);
    this.animatedDecorations.push({ object: orb, mode: "float", speed: 0.72, phase: 0.5, baseY: orb.position.y });
    const orbLight = new THREE.PointLight(0x65d8de, 3.2, 25, 2);
    orbLight.position.copy(orb.position);
    parent.add(orbLight);

    [4.1, 5.2, 6.25].forEach((radius, index) => {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.09 + index * 0.02, 8, 96), metal);
      ring.position.set(0, 10.7, -33);
      ring.rotation.x = Math.PI / 2.5 + index * 0.42;
      ring.rotation.y = index * 0.67;
      parent.add(ring);
      this.animatedDecorations.push({ object: ring, mode: "spin", speed: (index % 2 === 0 ? 1 : -1) * (0.045 + index * 0.018), phase: index, baseY: ring.position.y });
    });

    for (let index = 0; index < 5; index += 1) {
      const angle = (index / 5) * Math.PI * 2;
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.55 + seededValue(index, 8) * 0.4, 0),
        new THREE.MeshStandardMaterial({
          color: index % 2 === 0 ? 0x4faab5 : 0x7264be,
          emissive: index % 2 === 0 ? 0x123f47 : 0x241b54,
          emissiveIntensity: 0.7,
          roughness: 0.2,
          metalness: 0.38,
        }),
      );
      crystal.position.set(Math.cos(angle) * 7.2, 2.3 + (index % 2) * 1.2, -33 + Math.sin(angle) * 7.2);
      parent.add(crystal);
      this.animatedDecorations.push({ object: crystal, mode: "float", speed: 0.8 + index * 0.09, phase: index * 1.4, baseY: crystal.position.y });
    }
    this.createCloud(parent, -18, 6.6, -30, 1, 32);
    this.createCloud(parent, 15, 13.4, -55, 0.64, 38);
    this.createCloud(parent, -8, 19.2, -72, 0.42, 44);
  }

  private createCloud(
    parent: THREE.Group,
    x: number,
    y: number,
    z: number,
    speed: number,
    range: number,
  ) {
    const cloud = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({
      color: 0x9fb7d1,
      transparent: true,
      opacity: 0.075,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    for (let index = 0; index < 8; index += 1) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(1.8 + seededValue(index, 10) * 2.2, 14, 10), material);
      puff.position.set(index * 2.1, seededValue(index, 11) * 1.5, (seededValue(index, 12) - 0.5) * 2.6);
      puff.scale.y = 0.42 + seededValue(index, 13) * 0.28;
      cloud.add(puff);
    }
    cloud.position.set(x, y, z);
    parent.add(cloud);
    this.driftingClouds.push({ object: cloud, startX: x, range, speed });
  }

  private createGarden(parent: THREE.Object3D) {
    const timber = new THREE.MeshStandardMaterial({ color: 0x1a1220, roughness: 0.82 });
    const trunk = new THREE.MeshStandardMaterial({ color: 0x201722, roughness: 0.96 });
    const blossomMaterials = [
      new THREE.MeshStandardMaterial({ color: 0x693752, emissive: 0x230c20, emissiveIntensity: 0.22, roughness: 0.92 }),
      new THREE.MeshStandardMaterial({ color: 0x8b466c, emissive: 0x2d0b25, emissiveIntensity: 0.26, roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ color: 0x4b345d, emissive: 0x140a24, emissiveIntensity: 0.18, roughness: 0.92 }),
    ];

    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 5.8, 8), timber);
      post.position.set(side * 7.7, 2.82, 3.05);
      parent.add(post);

      const treeTrunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.36, 4.9, 7), trunk);
      treeTrunk.position.set(side * 6.7, 2.3, 1.85);
      treeTrunk.rotation.z = side * 0.08;
      parent.add(treeTrunk);

      for (let branch = 0; branch < 6; branch += 1) {
        const branchMesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.055, 0.11, 2.8 + branch * 0.17, 6),
          trunk,
        );
        branchMesh.position.set(
          side * (6.25 - branch * 0.19),
          3.5 + branch * 0.31,
          1.55 - Math.sin(branch * 1.7) * 0.65,
        );
        branchMesh.rotation.z = side * (0.62 + branch * 0.055);
        branchMesh.rotation.x = Math.sin(branch) * 0.28;
        parent.add(branchMesh);
      }

      for (let cluster = 0; cluster < 25; cluster += 1) {
        const rhythm = Math.sin(cluster * 4.13 + side) * 0.5 + 0.5;
        const blossom = new THREE.Mesh(
          new THREE.IcosahedronGeometry(0.32 + rhythm * 0.32, 1),
          blossomMaterials[cluster % blossomMaterials.length],
        );
        blossom.position.set(
          side * (4.6 + rhythm * 2.5),
          3.15 + ((cluster * 0.71) % 2.5),
          0.6 + Math.sin(cluster * 1.33) * 1.5,
        );
        blossom.scale.set(1.15, 0.72, 1);
        parent.add(blossom);
      }
    }

    const topBeam = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 15.5, 8), timber);
    topBeam.position.set(0, 5.65, 3.05);
    topBeam.rotation.z = Math.PI / 2;
    parent.add(topBeam);

    const cablePoints: THREE.Vector3[] = [];
    for (let index = 0; index <= 24; index += 1) {
      const x = -7.2 + index * 0.6;
      cablePoints.push(new THREE.Vector3(x, 5.25 - Math.cos((x / 7.2) * Math.PI) * 0.35, 2.74));
    }
    const cable = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(cablePoints),
      new THREE.LineBasicMaterial({ color: 0x3f304c, transparent: true, opacity: 0.72 }),
    );
    parent.add(cable);
    for (let index = 0; index < 9; index += 1) {
      const x = -6.4 + index * 1.6;
      const y = 5.25 - Math.cos((x / 7.2) * Math.PI) * 0.35;
      const bulb = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 10, 8),
        new THREE.MeshBasicMaterial({ color: index % 2 === 0 ? 0xf0a56f : 0xd8789e, toneMapped: false }),
      );
      bulb.position.set(x, y - 0.12, 2.74);
      parent.add(bulb);
      if (index % 2 === 0) {
        const glow = new THREE.PointLight(0xe98578, 0.42, 2.4, 2);
        glow.position.copy(bulb.position);
        parent.add(glow);
      }
    }
  }

  private createFireflies() {
    const count = 110;
    const positions = new Float32Array(count * 3);
    const phases = new Float32Array(count);
    for (let index = 0; index < count; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      positions[index * 3] = side * (4.5 + Math.random() * 11);
      positions[index * 3 + 1] = 0.25 + Math.random() * 4.6;
      positions[index * 3 + 2] = -9 + Math.random() * 18;
      phases[index] = Math.random() * Math.PI * 2;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: { uTime: this.waterUniforms.uTime, uPixelRatio: this.starUniforms.uPixelRatio },
      vertexShader: /* glsl */ `
        attribute float aPhase;
        uniform float uTime;
        uniform float uPixelRatio;
        varying float vAlpha;
        void main() {
          vec3 p = position;
          p.x += sin(uTime * 0.35 + aPhase) * 0.18;
          p.y += cos(uTime * 0.27 + aPhase * 1.7) * 0.12;
          vAlpha = 0.18 + pow(max(0.0, sin(uTime * 1.7 + aPhase)), 4.0) * 0.72;
          vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
          gl_PointSize = 2.2 * uPixelRatio * clamp(18.0 / -mvPosition.z, 0.7, 2.2);
          gl_Position = projectionMatrix * mvPosition;
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float alpha = (1.0 - smoothstep(0.08, 0.5, d)) * vAlpha;
          gl_FragColor = vec4(1.0, 0.67, 0.3, alpha);
        }
      `,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.scene.add(new THREE.Points(geometry, material));
  }

  private createDeck() {
    const terraceStone = new THREE.MeshStandardMaterial({ color: 0x26263b, roughness: 0.9, metalness: 0.03 });
    const terrace = new THREE.Mesh(new THREE.BoxGeometry(20, 0.68, 14), terraceStone);
    terrace.position.set(0, -0.24, 4.7);
    this.scene.add(terrace);

    const seamMaterial = new THREE.MeshBasicMaterial({ color: 0x41415b, transparent: true, opacity: 0.48 });
    for (let index = -9; index <= 9; index += 1) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.012, 13.5), seamMaterial);
      seam.position.set(index, 0.105, 4.7);
      this.scene.add(seam);
    }
    for (let index = -1; index <= 11; index += 1.45) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(19.5, 0.012, 0.018), seamMaterial);
      seam.position.set(0, 0.105, index);
      this.scene.add(seam);
    }

    const benchMaterial = new THREE.MeshStandardMaterial({ color: 0x271521, roughness: 0.72 });
    const benchSeat = new THREE.Mesh(new THREE.BoxGeometry(5.8, 0.25, 1), benchMaterial);
    benchSeat.position.set(0, 1.02, 4.25);
    const benchBack = new THREE.Mesh(new THREE.BoxGeometry(5.8, 1.35, 0.22), benchMaterial);
    benchBack.position.set(0, 1.6, 4.82);
    this.scene.add(benchSeat, benchBack);

    const parapet = new THREE.MeshStandardMaterial({ color: 0x303149, roughness: 0.84, metalness: 0.06 });
    const frontWall = new THREE.Mesh(new THREE.BoxGeometry(19.4, 0.72, 0.46), parapet);
    frontWall.position.set(0, 0.45, -1.05);
    this.scene.add(frontWall);
    for (let index = -9; index <= 9; index += 1.5) {
      const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.66), parapet);
      merlon.position.set(index, 1.15, -1.05);
      this.scene.add(merlon);
    }
    for (const x of [-9.75, 9.75]) {
      const sideWall = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.68, 13.3), parapet);
      sideWall.position.set(x, 0.43, 4.7);
      this.scene.add(sideWall);
      for (let z = -0.2; z <= 10.2; z += 1.65) {
        const merlon = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.7, 0.76), parapet);
        merlon.position.set(x, 1.12, z);
        this.scene.add(merlon);
      }
    }

    const runner = new THREE.Mesh(
      new THREE.PlaneGeometry(4.7, 3.4),
      new THREE.MeshStandardMaterial({ color: 0x34213b, roughness: 0.98 }),
    );
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(0, 0.115, 3.05);
    this.scene.add(runner);

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
    const light = new THREE.PointLight(0xff704f, 0.72, 3.8, 2);
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
