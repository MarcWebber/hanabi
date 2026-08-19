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
  calculateExposureStops,
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
import { FireworkAudio } from "./audio/FireworkAudio";

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

type CameraMotion = {
  startedAt: number;
  duration: number;
  fromYaw: number;
  toYaw: number;
  fromPitch: number;
  toPitch: number;
};

type CinematicCue = {
  at: number;
  fired?: boolean;
  run: () => void;
};

type CinematicShow = {
  startedAt: number;
  duration: number;
  cues: CinematicCue[];
  lastProgress: number;
};

type ExposureCapture = {
  startedAt: number;
  physicalDuration: number;
  interfaceDuration: number;
  lastProgress: number;
  accumulator: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
  frameCount: number;
  image: string | null;
  onProgress: (progress: number) => void;
  resolve: (image: string) => void;
};

export type FireworkSceneCallbacks = {
  onReady?: () => void;
  onLoadProgress?: (progress: number) => void;
  onImpact?: (intensity: number) => void;
  onShowProgress?: (progress: number, chapter: string, active: boolean) => void;
};

const COLOR_GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new THREE.Vector3(0.95, 0.97, 1.05) },
    uSaturation: { value: 0.94 },
    uContrast: { value: 1.06 },
    uVignette: { value: 0.18 },
    uLift: { value: 0.018 },
    uGrain: { value: 0.008 },
    uTime: { value: 0 },
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
    uniform float uGrain;
    uniform float uTime;
    varying vec2 vUv;

    float sensorHash(vec2 value) {
      return fract(sin(dot(value, vec2(12.9898, 78.233))) * 43758.5453);
    }

    void main() {
      vec3 color = texture2D(tDiffuse, vUv).rgb;
      float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722));
      color = mix(vec3(luminance), color, uSaturation);
      color = (color - 0.5) * uContrast + 0.5;
      color = max(vec3(0.0), color * uTint + uLift);
      vec2 sensorPixel = floor(gl_FragCoord.xy);
      float timeStep = floor(uTime);
      float luminanceNoise = sensorHash(sensorPixel + vec2(timeStep, -timeStep));
      vec3 chromaNoise = vec3(
        sensorHash(sensorPixel * 0.73 + timeStep * 1.17),
        sensorHash(sensorPixel * 0.81 - timeStep * 0.83),
        sensorHash(sensorPixel * 0.67 + timeStep * 1.43)
      ) - 0.5;
      float shadowResponse = mix(1.0, 0.34, smoothstep(0.035, 0.82, luminance));
      color += (luminanceNoise - 0.5) * uGrain * shadowResponse;
      color += chromaNoise * uGrain * 0.14 * shadowResponse;
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
  private readonly audio = new FireworkAudio();
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
  private pixelRatio = 1;
  private paused = false;
  private visualTime = 0;
  private yaw = 0;
  private pitch = 0.18;
  private lookPointer: { id: number; x: number; y: number } | null = null;
  private cameraSettings: CameraSettings = { ...DEFAULT_CAMERA_SETTINGS };
  private cameraMotion: CameraMotion | null = null;
  private cinematicShow: CinematicShow | null = null;
  private exposureCapture: ExposureCapture | null = null;

  constructor(
    private readonly container: HTMLDivElement,
    private readonly callbacks: FireworkSceneCallbacks = {},
  ) {
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
    this.renderer.shadowMap.type = THREE.VSMShadowMap;
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

    this.callbacks.onLoadProgress?.(0.08);
    this.world = new MagicCityWorld(this.scene, this.renderer, (progress) => {
      this.callbacks.onLoadProgress?.(0.08 + progress * 0.92);
    });
    const renderPass = new RenderPass(this.scene, this.camera);
    this.bokehPass = new BokehPass(this.scene, this.camera, {
      focus: DEFAULT_CAMERA_SETTINGS.focusDistance,
      aperture: 0.00001,
      maxblur: 0.0015,
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
          this.callbacks.onLoadProgress?.(1);
          this.callbacks.onReady?.();
          this.openingSequence();
        });
      })
      .catch((error: unknown) => {
        console.error("Unable to load the authored Moonharbor scene", error);
        this.callbacks.onReady?.();
      });
  }

  setAutoPlay(enabled: boolean) {
    if (enabled && this.cinematicShow) this.stopCinematicShow(false);
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

    const exposureStops = calculateExposureStops(settings);
    const exposureGain = Math.pow(2, exposureStops);
    this.renderer.toneMappingExposure = THREE.MathUtils.clamp(0.44 * exposureGain, 0.025, 34);
    const overexposure = THREE.MathUtils.clamp(exposureStops / 7, 0, 1);
    this.bloomPass.threshold = THREE.MathUtils.lerp(0.68, 0.4, settings.bloom) - overexposure * 0.12;
    this.bloomPass.strength = THREE.MathUtils.lerp(0.12, 0.62, settings.bloom);
    this.bloomPass.radius = THREE.MathUtils.lerp(0.15, 0.38, settings.bloom);
    const bokehUniforms = this.bokehPass.uniforms as Record<string, { value: number }>;
    const focalLengthMeters = settings.focalLength / 1000;
    const focusDistance = Math.max(settings.focusDistance, focalLengthMeters + 0.01);
    const sensorWidthMeters = 0.036;
    const physicalDefocus = (
      focalLengthMeters * focalLengthMeters
      / (settings.aperture * focusDistance * (focusDistance - focalLengthMeters) * sensorWidthMeters)
    );
    const apertureScale = Math.pow(2.8 / settings.aperture, 0.32);
    bokehUniforms.focus.value = settings.focusDistance;
    bokehUniforms.aperture.value = THREE.MathUtils.clamp(physicalDefocus * 5.2, 0.000002, 0.0045);
    bokehUniforms.maxblur.value = THREE.MathUtils.clamp(
      0.001 + 0.0065 * Math.pow(settings.focalLength / 50, 1.15) * apertureScale,
      0.001,
      0.012,
    );
    this.bokehPass.enabled = true;

    const grade = FILTER_GRADES[settings.filter];
    this.gradePass.uniforms.uTint.value.set(...grade.tint);
    this.gradePass.uniforms.uSaturation.value = grade.saturation;
    this.gradePass.uniforms.uContrast.value = grade.contrast;
    this.gradePass.uniforms.uVignette.value = grade.vignette;
    this.gradePass.uniforms.uLift.value = grade.lift;
    const sensorNoise = THREE.MathUtils.clamp(Math.log2(settings.iso / 100) / 8, 0, 1);
    this.gradePass.uniforms.uGrain.value = THREE.MathUtils.lerp(0.002, 0.07, Math.pow(sensorNoise, 1.5));

    const particleIntensity = this.currentParticleIntensity();
    this.rockets.forEach((rocket) => rocket.trail.setIntensity(particleIntensity * 0.9));
    this.bursts.forEach((burst) => burst.clouds.forEach((cloud) => cloud.setIntensity(particleIntensity)));
  }

  resetView() {
    this.yaw = 0;
    this.pitch = 0.18;
    this.cameraMotion = null;
    this.camera.position.copy(this.eyeAnchor);
    this.camera.rotation.order = "YXZ";
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  captureExposure(onProgress: (progress: number) => void) {
    if (this.exposureCapture) {
      return Promise.reject(new Error("An exposure is already in progress"));
    }
    const physicalDuration = THREE.MathUtils.clamp(this.cameraSettings.shutterSeconds, 1 / 1000, 8);
    const interfaceDuration = Math.max(physicalDuration, 0.09) + 0.09;
    const source = this.renderer.domElement;
    const captureScale = Math.min(1, 1920 / source.width);
    const accumulator = document.createElement("canvas");
    accumulator.width = Math.max(1, Math.round(source.width * captureScale));
    accumulator.height = Math.max(1, Math.round(source.height * captureScale));
    const context = accumulator.getContext("2d", { alpha: false });
    if (!context) return Promise.reject(new Error("Unable to create the exposure accumulator"));
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    this.cameraMotion = null;
    this.lookPointer = null;
    return new Promise<string>((resolve) => {
      this.exposureCapture = {
        startedAt: performance.now() / 1000,
        physicalDuration,
        interfaceDuration,
        lastProgress: -1,
        accumulator,
        context,
        frameCount: 0,
        image: null,
        onProgress,
        resolve,
      };
      onProgress(0);
    });
  }

  setSoundEnabled(enabled: boolean) {
    this.audio.setEnabled(enabled);
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

  playCinematicShow(textPoints?: PatternPoint[], palette: PaletteName = "love") {
    this.autoPlay = false;
    this.resetView();
    const cues: CinematicCue[] = [];
    const add = (at: number, options: LaunchOptions) => {
      cues.push({ at, run: () => this.launch(options) });
    };
    const camera = (at: number, yaw: number, pitch: number, duration = 4.8) => {
      cues.push({ at, run: () => this.moveCamera(yaw, pitch, duration) });
    };

    camera(0, 0, 0.18, 0.1);
    add(1.0, { pattern: "peony", palette: "gold", x: -8.5, y: 12.8, z: -28, tuning: { launchStyle: "comet", dissipation: "soft", power: 0.78, spread: 0.9, lifetime: 1.05, trail: 1.15 } });
    add(4.4, { pattern: "chrysanthemum", palette: "aurora", x: 7.8, y: 14.2, z: -29, tuning: { launchStyle: "classic", dissipation: "glitter", power: 0.84, spread: 0.94, lifetime: 1.1, trail: 0.92 } });
    add(7.8, { pattern: "willow", palette: "gold", x: 0, y: 16.1, z: -33, tuning: { launchStyle: "comet", dissipation: "embers", power: 0.92, spread: 1.08, lifetime: 1.24, trail: 1.2 } });

    camera(11, -0.08, 0.2, 5.2);
    add(11.5, { pattern: "heart", palette, x: -4.8, y: 14.6, z: -25, tuning: { launchStyle: "spiral", dissipation: "strobe", power: 0.9, spread: 1.02, lifetime: 1.12, trail: 1.05 } });
    add(14.8, { pattern: "butterfly", palette: "aurora", x: 5.6, y: 13.8, z: -26, tuning: { launchStyle: "comet", dissipation: "glitter", power: 0.88, spread: 1.08, lifetime: 1.08, trail: 1.12 } });
    add(18.0, { pattern: "saturn", palette: "dream", x: 0.5, y: 16.6, z: -31, tuning: { launchStyle: "classic", dissipation: "soft", power: 0.96, spread: 1.15, lifetime: 1.15, trail: 0.95 } });
    add(21.2, { pattern: "spiral", palette: "love", x: -7.2, y: 12.5, z: -25, tuning: { launchStyle: "spiral", dissipation: "glitter", power: 0.92, spread: 1.05, lifetime: 1.05, trail: 1.28 } });

    camera(24.5, 0.08, 0.16, 5.8);
    add(25.0, { pattern: "peony", palette: "aurora", x: -9.5, y: 13.4, z: -28, tuning: { launchStyle: "twin", dissipation: "soft", power: 1.02, spread: 1.12, lifetime: 1.08, trail: 1.1 } });
    add(28.2, { pattern: "crown", palette: "gold", x: 7.5, y: 15.4, z: -28, tuning: { launchStyle: "comet", dissipation: "glitter", power: 1.02, spread: 1.16, lifetime: 1.12, trail: 1.18 } });
    add(31.0, { pattern: "double-ring", palette: "dream", x: -3.8, y: 17.1, z: -32, tuning: { launchStyle: "classic", dissipation: "strobe", power: 1.08, spread: 1.18, lifetime: 1.12, trail: 0.95 } });
    add(34.0, { pattern: "palm", palette: "gold", x: 6.2, y: 13.1, z: -26, tuning: { launchStyle: "comet", dissipation: "embers", power: 1.05, spread: 1.18, lifetime: 1.2, trail: 1.18 } });

    camera(37, -0.04, 0.21, 5.4);
    add(37.4, { pattern: "star", palette: "aurora", x: -9.5, y: 15, z: -28, tuning: { launchStyle: "spiral", dissipation: "glitter", power: 1.02, spread: 1.12, lifetime: 1.08, trail: 1.12 } });
    add(39.0, { pattern: "meteor", palette: "dream", x: 9.2, y: 14.2, z: -27, tuning: { launchStyle: "comet", dissipation: "strobe", power: 1.08, spread: 1.14, lifetime: 1.1, trail: 1.3 } });
    add(42.0, { pattern: "heart", palette, x: 0, y: 17.2, z: -29, tuning: { launchStyle: "twin", dissipation: "glitter", power: 1.08, spread: 1.18, lifetime: 1.16, trail: 1.15 } });
    add(45.5, { pattern: "willow", palette: "gold", x: -7.8, y: 16.4, z: -33, tuning: { launchStyle: "comet", dissipation: "embers", power: 1.1, spread: 1.2, lifetime: 1.35, trail: 1.28 } });
    add(46.1, { pattern: "willow", palette: "love", x: 7.8, y: 16.4, z: -33, silent: true, tuning: { launchStyle: "comet", dissipation: "embers", power: 1.1, spread: 1.2, lifetime: 1.35, trail: 1.28 } });

    camera(51, 0.02, 0.17, 4.2);
    add(51.4, { pattern: "peony", palette: "aurora", x: -10.5, y: 12.4, z: -26, tuning: { launchStyle: "twin", dissipation: "glitter", power: 1.12, spread: 1.2, lifetime: 1.12, trail: 1.2 } });
    add(53.0, { pattern: "chrysanthemum", palette: "love", x: 0, y: 17.6, z: -31, tuning: { launchStyle: "comet", dissipation: "strobe", power: 1.2, spread: 1.25, lifetime: 1.16, trail: 1.25 } });
    add(54.6, { pattern: "crown", palette: "gold", x: 10.2, y: 13.2, z: -27, tuning: { launchStyle: "twin", dissipation: "glitter", power: 1.16, spread: 1.22, lifetime: 1.12, trail: 1.18 } });
    add(57.0, { pattern: "saturn", palette: "dream", x: -6.8, y: 16.4, z: -30, tuning: { launchStyle: "spiral", dissipation: "strobe", power: 1.18, spread: 1.28, lifetime: 1.14, trail: 1.22 } });
    add(58.0, { pattern: "butterfly", palette, x: 6.8, y: 16.0, z: -29, tuning: { launchStyle: "comet", dissipation: "glitter", power: 1.16, spread: 1.24, lifetime: 1.15, trail: 1.18 } });

    for (let index = 0; index < 8; index += 1) {
      const side = index % 2 === 0 ? -1 : 1;
      add(61 + index * 0.62, {
        pattern: index % 3 === 0 ? "crown" : index % 3 === 1 ? "peony" : "meteor",
        palette: index % 2 === 0 ? "gold" : "aurora",
        x: side * (4.2 + (index % 4) * 2.2),
        y: 12.2 + (index % 4) * 1.55,
        z: -25 - (index % 3) * 3.2,
        silent: index % 2 === 1,
        tuning: { launchStyle: index % 2 === 0 ? "comet" : "classic", dissipation: index % 3 === 0 ? "embers" : "glitter", power: 1.2, spread: 1.22, lifetime: 1.18, trail: 1.22 },
      });
    }
    if (textPoints?.length) {
      add(67.0, { pattern: "text", palette, points: textPoints, x: 0, y: 15.8, z: -25, tuning: { launchStyle: "comet", dissipation: "glitter", power: 1.05, spread: 1.08, lifetime: 1.28, trail: 1.18 } });
    }
    add(71.0, { pattern: "willow", palette: "gold", x: 0, y: 18, z: -34, tuning: { launchStyle: "twin", dissipation: "embers", power: 1.28, spread: 1.32, lifetime: 1.42, trail: 1.35 } });

    this.cinematicShow = {
      startedAt: this.visualTime,
      duration: 78,
      cues: cues.sort((a, b) => a.at - b.at),
      lastProgress: -1,
    };
    this.callbacks.onShowProgress?.(0, "序幕", true);
    return 78;
  }

  stopCinematicShow(resumeAuto = true) {
    if (!this.cinematicShow) return;
    this.cinematicShow = null;
    this.cameraMotion = null;
    this.callbacks.onShowProgress?.(1, "余韵", false);
    this.autoPlay = resumeAuto;
    this.nextAutoLaunch = this.visualTime + 3.5;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.frameHandle);
    if (this.exposureCapture) {
      this.exposureCapture.resolve(this.exposureCapture.image ?? "");
      this.exposureCapture = null;
    }
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
    this.audio.dispose();
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
    trail.setIntensity(this.currentParticleIntensity() * 0.9);
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
    if (!options.silent) this.audio.playLaunch(tuning.launchStyle, tuning.trail, start);
  }

  private explode(rocket: Rocket) {
    this.world.pulseFirework(rocket.target, rocket.color, rocket.tuning.power);
    this.callbacks.onImpact?.(rocket.tuning.power);
    const clouds = makeBurstClouds(rocket.target, rocket.options, this.pixelRatio);
    const particleIntensity = this.currentParticleIntensity();
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
    this.audio.playBurst(
      rocket.options.pattern,
      rocket.tuning.dissipation,
      (rocket.options.pattern === "text" ? 0.72 : 1)
        * THREE.MathUtils.lerp(0.62, 1.22, rocket.tuning.power / 1.7),
      rocket.target,
    );
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
      if (!this.exposureCapture) this.updateCameraMotion();
      this.updateCinematicShow();
      this.updateRockets(delta);
      this.updateBursts(delta);
      this.world.update(this.visualTime, delta);
      this.runAutoplay();
    }
    this.gradePass.uniforms.uTime.value = performance.now() * 0.04713;
    this.audio.updateListener(this.camera);
    this.composer.render();
    this.updateExposureCapture(performance.now() / 1000);
    this.frameHandle = requestAnimationFrame(this.animate);
  };

  private currentParticleIntensity() {
    const gain = Math.pow(2, calculateExposureStops(this.cameraSettings));
    return THREE.MathUtils.clamp(
      (0.5 + this.cameraSettings.bloom * 0.2) * Math.pow(gain, 0.3),
      0.18,
      2.1,
    );
  }

  private updateExposureCapture(now: number) {
    const capture = this.exposureCapture;
    if (!capture) return;
    const elapsed = now - capture.startedAt;
    const progress = THREE.MathUtils.clamp(elapsed / capture.interfaceDuration, 0, 1);
    if (progress - capture.lastProgress >= 0.01 || progress === 1) {
      capture.lastProgress = progress;
      capture.onProgress(progress);
    }
    if (elapsed < capture.physicalDuration || capture.frameCount === 0) {
      capture.frameCount += 1;
      capture.context.globalCompositeOperation = capture.frameCount === 1 ? "copy" : "source-over";
      capture.context.globalAlpha = capture.frameCount === 1 ? 1 : 1 / capture.frameCount;
      capture.context.drawImage(
        this.renderer.domElement,
        0,
        0,
        capture.accumulator.width,
        capture.accumulator.height,
      );
      capture.context.globalAlpha = 1;
    }
    if (!capture.image && elapsed >= capture.physicalDuration && capture.frameCount > 0) {
      capture.image = capture.accumulator.toDataURL("image/png");
    }
    if (elapsed < capture.interfaceDuration || !capture.image) return;
    this.exposureCapture = null;
    capture.resolve(capture.image);
  }

  private moveCamera(yaw: number, pitch: number, duration: number) {
    if (this.exposureCapture) return;
    this.cameraMotion = {
      startedAt: this.visualTime,
      duration: Math.max(0.05, duration),
      fromYaw: this.yaw,
      toYaw: yaw,
      fromPitch: this.pitch,
      toPitch: pitch,
    };
  }

  private updateCameraMotion() {
    if (!this.cameraMotion) return;
    const progress = THREE.MathUtils.clamp(
      (this.visualTime - this.cameraMotion.startedAt) / this.cameraMotion.duration,
      0,
      1,
    );
    const eased = progress < 0.5
      ? 4 * progress * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 3) / 2;
    this.yaw = THREE.MathUtils.lerp(this.cameraMotion.fromYaw, this.cameraMotion.toYaw, eased);
    this.pitch = THREE.MathUtils.lerp(this.cameraMotion.fromPitch, this.cameraMotion.toPitch, eased);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    if (progress >= 1) this.cameraMotion = null;
  }

  private updateCinematicShow() {
    const show = this.cinematicShow;
    if (!show) return;
    const elapsed = this.visualTime - show.startedAt;
    for (const cue of show.cues) {
      if (cue.fired || cue.at > elapsed) continue;
      cue.fired = true;
      cue.run();
    }
    const progress = THREE.MathUtils.clamp(elapsed / show.duration, 0, 1);
    if (progress - show.lastProgress >= 0.004 || progress === 1) {
      show.lastProgress = progress;
      this.callbacks.onShowProgress?.(progress, this.showChapter(elapsed), true);
    }
    if (elapsed >= show.duration) this.stopCinematicShow(true);
  }

  private showChapter(elapsed: number) {
    if (elapsed < 11) return "序幕";
    if (elapsed < 25) return "相遇";
    if (elapsed < 39) return "靠近";
    if (elapsed < 52) return "心跳";
    if (elapsed < 67) return "盛放";
    return "余韵";
  }

  private runAutoplay() {
    if (!this.autoPlay || this.visualTime < this.nextAutoLaunch) return;
    const patterns: FireworkPattern[] = [
      "peony", "chrysanthemum", "heart", "saturn", "willow", "star",
      "spiral", "butterfly", "palm", "double-ring", "crown", "meteor",
    ];
    const palettes: PaletteName[] = ["aurora", "love", "gold", "dream"];
    const launchStyles: FireworkLaunchStyle[] = ["comet", "classic", "spiral", "twin"];
    const dissipations: FireworkDissipation[] = ["glitter", "soft", "strobe", "embers"];
    const lane = this.autoPatternIndex % 6;
    const laneX = [-9.2, 7.4, -3.8, 9.6, 2.8, -7.1][lane];
    const laneY = [12.8, 14.2, 16.4, 12.4, 15.2, 13.6][lane];
    this.launch({
      pattern: patterns[this.autoPatternIndex % patterns.length],
      palette: palettes[this.autoPatternIndex % palettes.length],
      x: laneX,
      y: laneY,
      z: -25 - (lane % 3) * 3.4,
      tuning: {
        launchStyle: launchStyles[this.autoPatternIndex % launchStyles.length],
        dissipation: dissipations[this.autoPatternIndex % dissipations.length],
        power: 0.86 + (this.autoPatternIndex % 4) * 0.11,
        spread: 0.88 + (this.autoPatternIndex % 5) * 0.09,
        lifetime: 0.9 + (this.autoPatternIndex % 3) * 0.12,
        trail: 0.82 + (this.autoPatternIndex % 4) * 0.13,
      },
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
    if (event.button !== 0 || this.exposureCapture) return;
    this.cameraMotion = null;
    this.lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private handleLookMove = (event: PointerEvent) => {
    if (this.exposureCapture || !this.lookPointer || this.lookPointer.id !== event.pointerId) return;
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

}
