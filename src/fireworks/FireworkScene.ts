import * as THREE from "three";
import { BokehPass } from "three/examples/jsm/postprocessing/BokehPass.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  ParticleCloud,
  RocketTrail,
  easeOutCubic,
  makeBurstClouds,
  randomColor,
  resolveColors,
  resolveTuning,
} from "./core/FireworkParticles";
import {
  DEFAULT_CAMERA_SETTINGS,
  type CameraFilter,
  type CameraSettings,
  type EnvironmentPreset,
  type FireworkDissipation,
  type FireworkLaunchStyle,
  type FireworkPattern,
  type FireworkShowCue,
  type FireworkTuning,
  type LaunchOptions,
  type PaletteName,
  type PatternPoint,
} from "./types";
import { MagicCityWorld } from "./world/MagicCityWorld";

export * from "./types";

type Rocket = {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  trail: RocketTrail;
  start: THREE.Vector3;
  target: THREE.Vector3;
  duration: number;
  age: number;
  options: LaunchOptions;
  color: THREE.Color;
  tuning: FireworkTuning;
};

type Burst = {
  clouds: ParticleCloud[];
  flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
  age: number;
  lifetime: number;
  power: number;
  spread: number;
};

const COLOR_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new THREE.Vector3(0.95, 0.97, 1.05) },
    uSaturation: { value: 0.94 },
    uContrast: { value: 1.06 },
    uVignette: { value: 0.18 },
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

const FILTER_GRADES: Record<CameraFilter, {
  tint: [number, number, number];
  saturation: number;
  contrast: number;
  vignette: number;
  lift: number;
}> = {
  neutral: { tint: [1, 1, 1], saturation: 0.98, contrast: 1.01, vignette: 0.1, lift: 0.008 },
  cinema: { tint: [0.95, 0.98, 1.04], saturation: 0.94, contrast: 1.06, vignette: 0.18, lift: 0.014 },
  rose: { tint: [1.05, 0.94, 0.99], saturation: 0.96, contrast: 1.04, vignette: 0.16, lift: 0.012 },
  moonlight: { tint: [0.88, 0.96, 1.09], saturation: 0.84, contrast: 1.08, vignette: 0.22, lift: 0.007 },
};

export class FireworkScene {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46.4, 1, 0.08, 320);
  private readonly renderer: THREE.WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly bokehPass: BokehPass;
  private readonly gradePass: ShaderPass;
  private readonly world: MagicCityWorld;
  private readonly resizeObserver: ResizeObserver;
  private readonly rockets: Rocket[] = [];
  private readonly bursts: Burst[] = [];
  private readonly timers = new Set<number>();
  private readonly clock = new THREE.Timer();
  private readonly eyeAnchor = new THREE.Vector3(-0.72, 1.82, 3.55);
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
  private pitch = -0.33;
  private lookPointer: { id: number; x: number; y: number } | null = null;
  private cameraSettings: CameraSettings = { ...DEFAULT_CAMERA_SETTINGS };

  constructor(private readonly container: HTMLDivElement, onReady?: () => void) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.86;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x030510, 1);
    this.renderer.domElement.setAttribute("role", "img");
    this.renderer.domElement.setAttribute("aria-label", "坐在城堡露台仰望的可交互 3D 烟花夜景，拖动可转动视线");
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.style.touchAction = "none";
    this.container.appendChild(this.renderer.domElement);
    this.clock.connect(document);

    this.resetView();
    this.renderer.domElement.addEventListener("pointerdown", this.handleLookStart);
    this.renderer.domElement.addEventListener("pointermove", this.handleLookMove);
    this.renderer.domElement.addEventListener("pointerup", this.handleLookEnd);
    this.renderer.domElement.addEventListener("pointercancel", this.handleLookEnd);

    this.world = new MagicCityWorld(this.scene, this.renderer);
    const renderPass = new RenderPass(this.scene, this.camera);
    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus: DEFAULT_CAMERA_SETTINGS.focusDistance,
      aperture: 0.000014,
      maxblur: 0.002,
    });
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.34, 0.28, 0.52);
    this.gradePass = new ShaderPass(COLOR_GRADE_SHADER);
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(renderPass);
    this.composer.addPass(this.bokehPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(new OutputPass());

    this.setCameraSettings(DEFAULT_CAMERA_SETTINGS);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    this.resize();
    this.animate();
    void this.world.ready
      .then(() => {
        if (this.disposed) return;
        this.schedule(140, () => {
          onReady?.();
          this.openingSequence();
        });
      })
      .catch((error: unknown) => {
        console.error("Unable to load the authored Moonharbor scene", error);
        onReady?.();
      });
  }

  setAutoPlay(enabled: boolean) {
    this.autoPlay = enabled;
    this.nextAutoLaunch = this.visualTime + 0.4;
  }

  setEnvironment(preset: EnvironmentPreset) {
    this.world.setPreset(preset);
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
    const exposureStops = (shutterStops + isoStops + apertureStops) * 0.18;
    this.renderer.toneMappingExposure = THREE.MathUtils.clamp(0.86 * Math.pow(2, exposureStops), 0.48, 1.14);
    this.bloomPass.threshold = THREE.MathUtils.lerp(0.68, 0.4, settings.bloom);
    this.bloomPass.strength = THREE.MathUtils.lerp(0.12, 0.62, settings.bloom);
    this.bloomPass.radius = THREE.MathUtils.lerp(0.15, 0.38, settings.bloom);
    this.bokehPass.uniforms.focus.value = settings.focusDistance;
    this.bokehPass.uniforms.aperture.value = 0.000012 * Math.pow(2.8 / settings.aperture, 1.35);
    this.bokehPass.uniforms.maxblur.value = THREE.MathUtils.lerp(
      0.0004,
      0.0034,
      THREE.MathUtils.clamp((16 - settings.aperture) / 14.6, 0, 1),
    );
    this.bokehPass.enabled = settings.aperture < 13;

    const grade = FILTER_GRADES[settings.filter];
    this.gradePass.uniforms.uTint.value.set(...grade.tint);
    this.gradePass.uniforms.uSaturation.value = grade.saturation;
    this.gradePass.uniforms.uContrast.value = grade.contrast;
    this.gradePass.uniforms.uVignette.value = grade.vignette;
    this.gradePass.uniforms.uLift.value = grade.lift;

    const particleIntensity = THREE.MathUtils.clamp(0.54 + settings.bloom * 0.18 + exposureStops * 0.035, 0.46, 0.76);
    this.rockets.forEach((rocket) => rocket.trail.setIntensity(particleIntensity * 0.9));
    this.bursts.forEach((burst) => burst.clouds.forEach((cloud) => cloud.setIntensity(particleIntensity)));
  }

  resetView() {
    this.yaw = 0;
    this.pitch = -0.33;
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
    const tuning = resolveTuning(options.tuning);
    if (tuning.launchStyle !== "twin") {
      this.launchSingle({ ...options, tuning }, tuning);
      return;
    }
    const targetX = options.x ?? (Math.random() - 0.5) * 18;
    const targetY = options.y ?? 11.5 + Math.random() * 7;
    const targetZ = options.z ?? -19 - Math.random() * 13;
    const separation = 1.2 + tuning.spread * 0.85;
    const pairedTuning: FireworkTuning = { ...tuning, launchStyle: "comet" };
    this.launchSingle({ ...options, x: targetX - separation, y: targetY - 0.35, z: targetZ, tuning: pairedTuning }, pairedTuning);
    this.launchSingle({ ...options, x: targetX + separation, y: targetY + 0.35, z: targetZ - 0.5, tuning: pairedTuning, silent: true }, pairedTuning);
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

  launchFinale(
    textPoints?: PatternPoint[],
    palette: PaletteName = "love",
    effect: Pick<LaunchOptions, "colors" | "tuning"> = {},
  ) {
    this.setAutoPlay(false);
    const sequence: Array<[number, LaunchOptions]> = [
      [0, { pattern: "peony", palette: "aurora", x: -10, y: 13, z: -24, ...effect }],
      [180, { pattern: "chrysanthemum", palette: "gold", x: 9, y: 15, z: -26, ...effect }],
      [520, { pattern: "heart", palette, x: 0, y: 16.5, z: -22, ...effect }],
      [900, { pattern: "saturn", palette: "dream", x: -7, y: 18, z: -31, ...effect }],
      [1060, { pattern: "willow", palette: "gold", x: 8, y: 18, z: -30, ...effect }],
      [1430, { pattern: "star", palette: "aurora", x: -12, y: 10, z: -22, ...effect }],
      [1600, { pattern: "peony", palette, x: 12, y: 11.5, z: -23, ...effect }],
    ];
    sequence.forEach(([delay, launch]) => this.schedule(delay, () => this.launch(launch)));
    if (textPoints?.length) {
      this.schedule(2300, () => this.launch({ pattern: "text", palette, points: textPoints, x: 0, y: 14.5, z: -22, ...effect }));
    }
    this.schedule(7100, () => this.setAutoPlay(true));
  }

  launchSequence(cues: FireworkShowCue[]) {
    this.setAutoPlay(false);
    let elapsed = 0;
    cues.slice(0, 12).forEach((cue, index) => {
      elapsed += Math.max(0.25, cue.delay) * 1000;
      const side = index % 2 === 0 ? -1 : 1;
      const lane = Math.floor(index / 2) % 3;
      this.schedule(elapsed, () => this.launch({
        pattern: cue.pattern,
        palette: cue.palette,
        colors: cue.colors,
        tuning: cue.tuning,
        x: side * (4.5 + lane * 3.7),
        y: 12.5 + (index % 4) * 1.8,
        z: -22 - lane * 4.5,
      }));
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
    this.rockets.forEach((rocket) => this.disposeRocket(rocket));
    this.bursts.forEach((burst) => this.disposeBurst(burst));
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh || object instanceof THREE.Points || object instanceof THREE.Line)) return;
      if (object.geometry) geometries.add(object.geometry);
      const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
      objectMaterials.forEach((material) => material && materials.add(material));
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.world.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.clock.dispose();
    void this.audioContext?.close();
  }

  private launchSingle(options: LaunchOptions, tuning: FireworkTuning) {
    const color = randomColor(resolveColors(options));
    const start = new THREE.Vector3((options.x ?? (Math.random() - 0.5) * 20) * 0.3, 0.2, 2.9);
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
    const trail = new RocketTrail(start, color, tuning.launchStyle, tuning.trail);
    trail.setPixelRatio(this.pixelRatio);
    trail.setIntensity(0.53 + this.cameraSettings.bloom * 0.16);
    this.scene.add(mesh, trail.points);
    this.rockets.push({
      mesh,
      trail,
      start,
      target,
      duration: (tuning.launchStyle === "comet" ? 1.04 : tuning.launchStyle === "spiral" ? 1.12 : 0.86) + Math.random() * 0.22,
      age: 0,
      options,
      color,
      tuning,
    });
    if (!options.silent) this.playLaunchSound();
  }

  private explode(rocket: Rocket) {
    this.world.pulseFirework(rocket.target, rocket.color, rocket.tuning.power);
    const clouds = makeBurstClouds(rocket.target, rocket.options, this.pixelRatio);
    const particleIntensity = 0.53 + this.cameraSettings.bloom * 0.18;
    clouds.forEach((cloud) => {
      cloud.setIntensity(particleIntensity);
      this.scene.add(cloud.points);
    });
    const flash = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 14), new THREE.MeshBasicMaterial({
      color: rocket.color,
      transparent: true,
      opacity: 0.34,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }));
    flash.position.copy(rocket.target);
    flash.scale.setScalar(0.72 + rocket.tuning.power * 0.28);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.79, 72), new THREE.MeshBasicMaterial({
      color: rocket.color,
      transparent: true,
      opacity: 0.24,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }));
    ring.position.copy(rocket.target);
    ring.scale.setScalar(0.72 + rocket.tuning.spread * 0.28);
    ring.lookAt(this.camera.position);
    this.scene.add(flash, ring);
    this.bursts.push({
      clouds,
      flash,
      ring,
      age: 0,
      lifetime: 5.4 * rocket.tuning.lifetime,
      power: rocket.tuning.power,
      spread: rocket.tuning.spread,
    });
    this.playBoomSound((rocket.options.pattern === "text" ? 0.72 : 1) * THREE.MathUtils.lerp(0.62, 1.22, rocket.tuning.power / 1.7));
  }

  private updateRockets(delta: number) {
    for (let index = this.rockets.length - 1; index >= 0; index -= 1) {
      const rocket = this.rockets[index];
      rocket.age += delta;
      const progress = Math.min(1, rocket.age / rocket.duration);
      rocket.mesh.position.lerpVectors(rocket.start, rocket.target, easeOutCubic(progress));
      const launchArc = rocket.tuning.launchStyle === "comet" ? 2.65 : rocket.tuning.launchStyle === "spiral" ? 2.05 : 1.65;
      rocket.mesh.position.y += Math.sin(progress * Math.PI) * launchArc;
      if (rocket.tuning.launchStyle === "spiral") {
        const radius = Math.sin(progress * Math.PI) * (0.9 + rocket.tuning.spread * 0.72);
        const angle = progress * Math.PI * 7.5;
        rocket.mesh.position.x += Math.cos(angle) * radius;
        rocket.mesh.position.z += Math.sin(angle) * radius * 0.52;
      }
      rocket.mesh.scale.setScalar(1 + Math.sin(rocket.age * 38) * 0.28);
      rocket.trail.update(rocket.mesh.position);
      if (progress < 1) continue;
      this.explode(rocket);
      this.disposeRocket(rocket);
      this.rockets.splice(index, 1);
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
      burst.flash.scale.setScalar(0.78 + burst.power * 0.3 + burst.age * (2.8 + burst.power));
      burst.flash.material.opacity = Math.max(0, 0.24 + burst.power * 0.09 - burst.age * 3.5);
      burst.ring.scale.setScalar(0.72 + burst.spread * 0.28 + burst.age * (4 + burst.spread * 1.7));
      burst.ring.material.opacity = Math.max(0, 0.23 - burst.age * 0.56);
      burst.ring.lookAt(this.camera.position);
      if (cloudAlive || burst.age <= burst.lifetime) continue;
      this.disposeBurst(burst);
      this.bursts.splice(index, 1);
    }
  }

  private disposeRocket(rocket: Rocket) {
    this.scene.remove(rocket.mesh, rocket.trail.points);
    rocket.mesh.geometry.dispose();
    rocket.mesh.material.dispose();
    rocket.trail.dispose();
  }

  private disposeBurst(burst: Burst) {
    burst.clouds.forEach((cloud) => {
      this.scene.remove(cloud.points);
      cloud.dispose();
    });
    this.scene.remove(burst.flash, burst.ring);
    burst.flash.geometry.dispose();
    burst.flash.material.dispose();
    burst.ring.geometry.dispose();
    burst.ring.material.dispose();
  }

  private animate = () => {
    if (this.disposed) return;
    this.clock.update();
    const delta = Math.min(this.clock.getDelta(), 0.034);
    if (!this.paused) {
      this.visualTime += delta;
      this.updateRockets(delta);
      this.updateBursts(delta);
      this.world.update(this.visualTime, delta);
      this.runAutoplay();
    }
    this.composer.render();
    this.frameHandle = requestAnimationFrame(this.animate);
  };

  private runAutoplay() {
    if (!this.autoPlay || this.visualTime < this.nextAutoLaunch) return;
    const patterns: FireworkPattern[] = [
      "peony", "chrysanthemum", "heart", "saturn", "willow", "star",
      "spiral", "butterfly", "palm", "double-ring", "crown", "meteor",
    ];
    const palettes: PaletteName[] = ["aurora", "love", "gold", "dream"];
    const launchStyles: FireworkLaunchStyle[] = ["comet", "classic", "spiral", "twin"];
    const dissipations: FireworkDissipation[] = ["glitter", "soft", "strobe", "embers"];
    this.launch({
      pattern: patterns[this.autoPatternIndex % patterns.length],
      palette: palettes[this.autoPatternIndex % palettes.length],
      tuning: {
        launchStyle: launchStyles[this.autoPatternIndex % launchStyles.length],
        dissipation: dissipations[this.autoPatternIndex % dissipations.length],
        power: 0.86 + (this.autoPatternIndex % 4) * 0.11,
        spread: 0.88 + (this.autoPatternIndex % 5) * 0.09,
        lifetime: 0.9 + (this.autoPatternIndex % 3) * 0.12,
        trail: 0.82 + (this.autoPatternIndex % 4) * 0.13,
      },
      silent: true,
    });
    this.autoPatternIndex += 1;
    this.nextAutoLaunch = this.visualTime + 1.25 + Math.random() * 1.25;
  }

  private openingSequence() {
    const launches: Array<[number, LaunchOptions]> = [
      [80, { pattern: "peony", palette: "aurora", x: -8, y: 14, z: -26, silent: true, tuning: { launchStyle: "comet", dissipation: "glitter", spread: 1.12 } }],
      [430, { pattern: "heart", palette: "love", x: 5, y: 16, z: -24, silent: true, tuning: { launchStyle: "spiral", dissipation: "strobe", lifetime: 1.15 } }],
      [930, { pattern: "willow", palette: "gold", x: 0, y: 18, z: -31, silent: true, tuning: { launchStyle: "twin", dissipation: "embers", trail: 1.25, lifetime: 1.18 } }],
    ];
    launches.forEach(([delay, options]) => this.schedule(delay, () => this.launch(options)));
  }

  private resize() {
    const width = Math.max(1, this.container.clientWidth);
    const height = Math.max(1, this.container.clientHeight);
    this.pixelRatio = Math.min(window.devicePixelRatio, width < 700 ? 1.4 : 1.8);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.world.setPixelRatio(this.pixelRatio);
    this.rockets.forEach((rocket) => rocket.trail.setPixelRatio(this.pixelRatio));
    this.bursts.forEach((burst) => burst.clouds.forEach((cloud) => cloud.setPixelRatio(this.pixelRatio)));
  }

  private schedule(delay: number, action: () => void) {
    const timer = window.setTimeout(() => {
      this.timers.delete(timer);
      if (!this.disposed) action();
    }, delay);
    this.timers.add(timer);
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

  private playLaunchSound() {
    if (!this.soundEnabled || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    const oscillator = this.audioContext.createOscillator();
    const gain = this.audioContext.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(120, now);
    oscillator.frequency.exponentialRampToValueAtTime(520, now + 0.72);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.055, now + 0.08);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.82);
    oscillator.connect(gain).connect(this.audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.86);
  }

  private playBoomSound(intensity: number) {
    if (!this.soundEnabled || !this.audioContext) return;
    const now = this.audioContext.currentTime;
    const duration = 0.92;
    const buffer = this.audioContext.createBuffer(1, Math.floor(this.audioContext.sampleRate * duration), this.audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (Math.random() * 2 - 1) * Math.pow(1 - index / data.length, 2.6);
    }
    const noise = this.audioContext.createBufferSource();
    noise.buffer = buffer;
    const filter = this.audioContext.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(520, now);
    filter.frequency.exponentialRampToValueAtTime(95, now + duration);
    const gain = this.audioContext.createGain();
    gain.gain.setValueAtTime(0.16 * intensity, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(filter).connect(gain).connect(this.audioContext.destination);
    noise.start(now);

    const sub = this.audioContext.createOscillator();
    const subGain = this.audioContext.createGain();
    sub.type = "sine";
    sub.frequency.setValueAtTime(68, now);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.48);
    subGain.gain.setValueAtTime(0.12 * intensity, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);
    sub.connect(subGain).connect(this.audioContext.destination);
    sub.start(now);
    sub.stop(now + 0.65);
  }
}
