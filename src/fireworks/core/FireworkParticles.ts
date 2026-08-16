import * as THREE from "three";
import {
  DEFAULT_FIREWORK_TUNING,
  type FireworkDissipation,
  type FireworkLaunchStyle,
  type FireworkTuning,
  type LaunchOptions,
  type PaletteName,
  type PatternPoint,
} from "../types";

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

type CloudOptions = {
  lifetime: number;
  gravity: number;
  drag: number;
  trailLength: number;
  formation?: boolean;
  formationSpeed?: number;
  dissipation?: FireworkDissipation;
};

export function resolveTuning(tuning?: Partial<FireworkTuning>): FireworkTuning {
  return {
    power: THREE.MathUtils.clamp(tuning?.power ?? DEFAULT_FIREWORK_TUNING.power, 0.55, 1.7),
    spread: THREE.MathUtils.clamp(tuning?.spread ?? DEFAULT_FIREWORK_TUNING.spread, 0.5, 1.75),
    lifetime: THREE.MathUtils.clamp(tuning?.lifetime ?? DEFAULT_FIREWORK_TUNING.lifetime, 0.5, 1.8),
    trail: THREE.MathUtils.clamp(tuning?.trail ?? DEFAULT_FIREWORK_TUNING.trail, 0.35, 1.9),
    launchStyle: tuning?.launchStyle ?? DEFAULT_FIREWORK_TUNING.launchStyle,
    dissipation: tuning?.dissipation ?? DEFAULT_FIREWORK_TUNING.dissipation,
  };
}

export function resolveColors(options: Pick<LaunchOptions, "colors" | "palette">) {
  const custom = options.colors?.filter(Boolean).slice(0, 5);
  return custom?.length
    ? custom.map((color) => new THREE.Color(color).getHex())
    : PALETTES[options.palette ?? "love"];
}

export function randomColor(colors: number[], index = Math.floor(Math.random() * colors.length)) {
  return new THREE.Color(colors[index % colors.length]);
}

export function easeOutCubic(value: number) {
  return 1 - Math.pow(1 - value, 3);
}

function easeOutBack(value: number) {
  const c1 = 1.70158;
  return 1 + (c1 + 1) * Math.pow(value - 1, 3) + c1 * Math.pow(value - 1, 2);
}

function randomUnitVector() {
  const theta = Math.random() * Math.PI * 2;
  const z = Math.random() * 2 - 1;
  const radius = Math.sqrt(1 - z * z);
  return new THREE.Vector3(radius * Math.cos(theta), z, radius * Math.sin(theta));
}

function makeParticleMaterial(intensity: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uIntensity: { value: intensity },
    },
    vertexShader: PARTICLE_VERTEX,
    fragmentShader: PARTICLE_FRAGMENT,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexColors: true,
    toneMapped: false,
  });
}

export class ParticleCloud {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly particles: ParticleState[];
  private readonly positions: Float32Array;
  private readonly alphas: Float32Array;
  private readonly trailLength: number;
  private readonly lifetime: number;
  private readonly gravity: number;
  private readonly drag: number;
  private readonly formation: boolean;
  private readonly formationSpeed: number;
  private readonly dissipation: FireworkDissipation;
  private age = 0;

  constructor(origin: THREE.Vector3, specs: ParticleSpec[], options: CloudOptions) {
    this.lifetime = options.lifetime;
    this.gravity = options.gravity;
    this.drag = options.drag;
    this.trailLength = options.trailLength;
    this.formation = Boolean(options.formation);
    this.formationSpeed = options.formationSpeed ?? 1;
    this.dissipation = options.dissipation ?? "soft";
    this.particles = specs.map((spec) => ({
      ...spec,
      position: origin.clone(),
      origin: origin.clone(),
      history: Array.from({ length: options.trailLength }, () => origin.clone()),
    }));

    const renderedCount = specs.length * options.trailLength;
    this.positions = new Float32Array(renderedCount * 3);
    this.alphas = new Float32Array(renderedCount);
    const sizes = new Float32Array(renderedCount);
    const colors = new Float32Array(renderedCount * 3);
    this.particles.forEach((particle, particleIndex) => {
      for (let trailIndex = 0; trailIndex < options.trailLength; trailIndex += 1) {
        const renderedIndex = particleIndex * options.trailLength + trailIndex;
        colors[renderedIndex * 3] = particle.color.r;
        colors[renderedIndex * 3 + 1] = particle.color.g;
        colors[renderedIndex * 3 + 2] = particle.color.b;
        sizes[renderedIndex] = particle.size * Math.pow(1 - trailIndex / options.trailLength, 0.7);
      }
    });

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(this.alphas, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    this.points = new THREE.Points(geometry, makeParticleMaterial(0.78));
    this.points.frustumCulled = false;
    this.writeAttributes();
  }

  update(delta: number) {
    this.age += delta;
    const remaining = Math.max(0, 1 - this.age / this.lifetime);
    const fade = this.dissipation === "embers"
      ? Math.pow(remaining, 0.62)
      : this.dissipation === "glitter"
        ? Math.pow(remaining, 0.92)
        : this.dissipation === "strobe"
          ? Math.pow(remaining, 1.08)
          : Math.pow(remaining, 1.35);

    for (const particle of this.particles) {
      if (this.formation && particle.target) {
        const formationTime = Math.min(1, this.age / (0.86 / this.formationSpeed));
        const settleTime = Math.max(0, this.age - 1.05 / this.formationSpeed);
        particle.position.copy(particle.origin).addScaledVector(particle.target, easeOutBack(formationTime));
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
      const twinkle = this.dissipation === "glitter"
        ? 0.18 + Math.pow(Math.max(0, Math.sin(this.age * 22 + particle.phase)), 3) * 0.82
        : this.dissipation === "strobe"
          ? (Math.sin(this.age * 28 + particle.phase) > 0.22 ? 1 : 0.06)
          : this.dissipation === "embers"
            ? 0.68 + Math.sin(this.age * 5.5 + particle.phase) * 0.16
            : 0.82 + Math.sin(this.age * 11 + particle.phase) * 0.18;
      for (let trailIndex = 0; trailIndex < this.trailLength; trailIndex += 1) {
        const renderedIndex = particleIndex * this.trailLength + trailIndex;
        const point = particle.history[trailIndex];
        this.positions[renderedIndex * 3] = point.x;
        this.positions[renderedIndex * 3 + 1] = point.y;
        this.positions[renderedIndex * 3 + 2] = point.z;
        this.alphas[renderedIndex] = fade * twinkle * Math.pow(1 - trailIndex / this.trailLength, 1.6);
      }
    });
    this.writeAttributes();
    return this.age < this.lifetime;
  }

  setPixelRatio(value: number) {
    this.points.material.uniforms.uPixelRatio.value = value;
  }

  setIntensity(value: number) {
    this.points.material.uniforms.uIntensity.value = value;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }

  private writeAttributes() {
    this.points.geometry.getAttribute("position").needsUpdate = true;
    this.points.geometry.getAttribute("aAlpha").needsUpdate = true;
  }
}

export class RocketTrail {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private readonly positions: Float32Array;
  private readonly history: THREE.Vector3[];

  constructor(origin: THREE.Vector3, color: THREE.Color, style: FireworkLaunchStyle, trailScale: number) {
    const baseCount = style === "comet" ? 70 : style === "spiral" ? 58 : 44;
    const count = THREE.MathUtils.clamp(Math.round(baseCount * trailScale), 22, 104);
    this.positions = new Float32Array(count * 3);
    this.history = Array.from({ length: count }, () => origin.clone());
    const alphas = new Float32Array(count);
    const sizes = new Float32Array(count);
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index += 1) {
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
      sizes[index] = 4.8 * Math.pow(1 - index / count, 0.7);
      alphas[index] = Math.pow(1 - index / count, 1.5);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alphas, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    this.points = new THREE.Points(geometry, makeParticleMaterial(0.72));
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

  setPixelRatio(value: number) {
    this.points.material.uniforms.uPixelRatio.value = value;
  }

  setIntensity(value: number) {
    this.points.material.uniforms.uIntensity.value = value;
  }

  dispose() {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

function makeShapeSpecs(points: PatternPoint[], colors: number[], scale: number, limit = 950) {
  if (!points.length) return [];
  const stride = Math.max(1, Math.ceil(points.length / limit));
  return points
    .filter((_, index) => index % stride === 0)
    .slice(0, limit)
    .map((point, index): ParticleSpec => ({
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
      x: Math.pow(Math.sin(t), 3) * layer,
      y: ((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16) * layer,
    };
  });
}

function starPoints(count: number): PatternPoint[] {
  const vertices = Array.from({ length: 10 }, (_, index) => {
    const radius = index % 2 === 0 ? 1 : 0.42;
    const angle = Math.PI / 2 + (index * Math.PI) / 5;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
  return Array.from({ length: count }, (_, index) => {
    const progress = (index / count) * 10;
    const edge = Math.floor(progress) % 10;
    const local = progress - Math.floor(progress);
    return {
      x: THREE.MathUtils.lerp(vertices[edge].x, vertices[(edge + 1) % 10].x, local),
      y: THREE.MathUtils.lerp(vertices[edge].y, vertices[(edge + 1) % 10].y, local),
    };
  });
}

function butterflyPoints(count: number): PatternPoint[] {
  return Array.from({ length: count }, (_, index) => {
    const t = (index / count) * Math.PI * 12;
    const radius = Math.exp(Math.cos(t)) - 2 * Math.cos(4 * t) + Math.pow(Math.sin(t / 12), 5);
    return { x: (Math.sin(t) * radius) / 4.6, y: (Math.cos(t) * radius) / 4.6 };
  });
}

function crownPoints(count: number): PatternPoint[] {
  const outline: PatternPoint[] = [
    { x: -1, y: -0.52 }, { x: -0.95, y: 0.35 }, { x: -0.5, y: -0.05 },
    { x: -0.25, y: 0.78 }, { x: 0, y: 0.08 }, { x: 0.28, y: 0.78 },
    { x: 0.52, y: -0.05 }, { x: 0.96, y: 0.35 }, { x: 1, y: -0.52 },
    { x: -1, y: -0.52 },
  ];
  return Array.from({ length: count }, (_, index) => {
    const progress = (index / count) * (outline.length - 1);
    const edge = Math.min(outline.length - 2, Math.floor(progress));
    return {
      x: THREE.MathUtils.lerp(outline[edge].x, outline[edge + 1].x, progress - edge),
      y: THREE.MathUtils.lerp(outline[edge].y, outline[edge + 1].y, progress - edge),
    };
  });
}

export function makeBurstClouds(origin: THREE.Vector3, options: LaunchOptions, pixelRatio: number) {
  const colors = resolveColors(options);
  const tuning = resolveTuning(options.tuning);
  const clouds: ParticleCloud[] = [];
  const addCloud = (specs: ParticleSpec[], cloudOptions: CloudOptions) => {
    const tunedSpecs = specs.map((spec) => {
      const velocity = spec.velocity.clone().multiplyScalar(tuning.power);
      velocity.x *= tuning.spread;
      velocity.z *= tuning.spread;
      velocity.y *= 0.82 + tuning.spread * 0.18;
      return {
        ...spec,
        velocity,
        target: spec.target?.clone().multiplyScalar(tuning.spread),
        size: spec.size * (0.86 + tuning.power * 0.14),
      };
    });
    const cloud = new ParticleCloud(origin, tunedSpecs, {
      ...cloudOptions,
      lifetime: cloudOptions.lifetime * tuning.lifetime,
      trailLength: THREE.MathUtils.clamp(Math.round(cloudOptions.trailLength * tuning.trail), 1, 16),
      gravity: tuning.dissipation === "embers" ? cloudOptions.gravity * 1.12 : cloudOptions.gravity,
      formationSpeed: tuning.power,
      dissipation: tuning.dissipation,
    });
    cloud.setPixelRatio(pixelRatio);
    clouds.push(cloud);
  };

  if (options.pattern === "text" || options.pattern === "custom") {
    addCloud(makeShapeSpecs(options.points ?? [], colors, options.pattern === "text" ? 7.4 : 6.4), {
      lifetime: options.pattern === "text" ? 4.6 : 4.1,
      gravity: 0,
      drag: 1,
      trailLength: 3,
      formation: true,
    });
    return clouds;
  }

  if (["heart", "star", "butterfly", "crown"].includes(options.pattern)) {
    const points = options.pattern === "heart"
      ? heartPoints(520)
      : options.pattern === "star"
        ? starPoints(460)
        : options.pattern === "butterfly"
          ? butterflyPoints(620)
          : crownPoints(500);
    const scale = options.pattern === "heart" ? 5.1 : options.pattern === "butterfly" ? 6.5 : options.pattern === "crown" ? 5.7 : 5.6;
    addCloud(makeShapeSpecs(points, colors, scale, 650), {
      lifetime: 3.8,
      gravity: 0,
      drag: 1,
      trailLength: 5,
      formation: true,
    });
    addCloud(Array.from({ length: 120 }, (): ParticleSpec => ({
      velocity: randomUnitVector().multiplyScalar(1.8 + Math.random() * 4.2),
      color: randomColor(colors),
      size: 1.25 + Math.random() * 0.9,
      phase: Math.random() * Math.PI * 2,
    })), { lifetime: 2.2, gravity: -1.1, drag: 0.975, trailLength: 3 });
    return clouds;
  }

  if (options.pattern === "spiral") {
    const specs: ParticleSpec[] = [];
    for (let arm = 0; arm < 3; arm += 1) {
      for (let index = 0; index < 190; index += 1) {
        const progress = index / 189;
        const angle = progress * Math.PI * 4.8 + (arm * Math.PI * 2) / 3;
        const radius = 0.35 + progress * 5.8;
        specs.push({
          velocity: new THREE.Vector3(),
          target: new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, Math.sin(angle * 0.5) * progress * 1.2),
          color: randomColor(colors, index + arm),
          size: 1.55 + Math.random() * 1.05,
          phase: Math.random() * Math.PI * 2,
        });
      }
    }
    addCloud(specs, { lifetime: 4.1, gravity: 0, drag: 1, trailLength: 4, formation: true });
    return clouds;
  }

  if (options.pattern === "double-ring") {
    const specs: ParticleSpec[] = [];
    for (let ring = 0; ring < 2; ring += 1) {
      for (let index = 0; index < 300; index += 1) {
        const angle = (index / 300) * Math.PI * 2;
        const speed = 7.4 + ring * 1.6 + Math.random() * 0.35;
        specs.push({
          velocity: ring === 0
            ? new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed, 0)
            : new THREE.Vector3(Math.cos(angle) * speed, Math.sin(angle) * speed * 0.36, Math.sin(angle) * speed),
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
      specs.push({
        velocity: new THREE.Vector3(Math.cos(angle) * 9 * radius, Math.sin(angle) * 3.1 * radius, Math.sin(angle) * 2.2),
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
          color: options.pattern === "palm" && !options.colors?.length ? randomColor(PALETTES.gold, index) : randomColor(colors, branch),
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

  const willow = options.pattern === "willow";
  const chrysanthemum = options.pattern === "chrysanthemum";
  const specs = Array.from({ length: chrysanthemum ? 680 : willow ? 430 : 520 }, (_, index): ParticleSpec => {
    const direction = randomUnitVector();
    if (willow) direction.y = Math.abs(direction.y) * 0.9 + 0.12;
    const speed = (willow ? 4.3 : chrysanthemum ? 7.8 : 7.1) + Math.random() * 4.4;
    return {
      velocity: direction.multiplyScalar(speed * (chrysanthemum ? 1 + Math.sin(index * 0.72) * 0.12 : 1)),
      color: willow && !options.colors?.length ? randomColor(PALETTES.gold, index) : randomColor(colors, index),
      size: (willow ? 1.45 : 1.7) + Math.random() * 1.15,
      phase: Math.random() * Math.PI * 2,
    };
  });
  addCloud(specs, {
    lifetime: willow ? 4.8 : chrysanthemum ? 3.5 : 3,
    gravity: willow ? -2.45 : -1.85,
    drag: willow ? 0.988 : 0.975,
    trailLength: willow ? 9 : chrysanthemum ? 7 : 6,
  });
  addCloud(Array.from({ length: willow ? 90 : 170 }, (_, index): ParticleSpec => ({
    velocity: randomUnitVector().multiplyScalar(2.1 + Math.random() * 4.2),
    color: randomColor(colors, index + 1),
    size: 1.25 + Math.random() * 0.95,
    phase: Math.random() * Math.PI * 2,
  })), { lifetime: 2.2, gravity: -1.4, drag: 0.97, trailLength: 3 });
  return clouds;
}
