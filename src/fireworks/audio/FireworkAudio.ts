import * as THREE from "three";
import type {
  FireworkDissipation,
  FireworkLaunchStyle,
  FireworkPattern,
} from "../types";

type Point3 = Pick<THREE.Vector3, "x" | "y" | "z">;
type FilterShape = BiquadFilterType;

const RECORDED_BURSTS = [
  "/audio/fireworks/fw-01.ogg",
  "/audio/fireworks/fw-02.ogg",
  "/audio/fireworks/fw-03.ogg",
  "/audio/fireworks/fw-04.ogg",
  "/audio/fireworks/fw-05.ogg",
  "/audio/fireworks/fw-06.ogg",
  "/audio/fireworks/cannon-01.ogg",
  "/audio/fireworks/cannon-02.ogg",
  "/audio/fireworks/cannon-03.ogg",
] as const;

const PATTERN_ACCENTS: Partial<Record<FireworkPattern, "double" | "air" | "crack" | "rumble">> = {
  heart: "air",
  butterfly: "air",
  saturn: "double",
  "double-ring": "double",
  crown: "crack",
  palm: "crack",
  meteor: "crack",
  willow: "rumble",
};

/** Spatial procedural firework sound design with launch, impact and tail layers. */
export class FireworkAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private dryBus: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private wetBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private sampleBuffers: AudioBuffer[] = [];
  private sampleLoading: Promise<void> | null = null;
  private sampleIndex = 0;
  private enabled = false;
  private readonly listenerPosition = new THREE.Vector3();
  private readonly listenerForward = new THREE.Vector3();

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) return;
    this.ensureGraph();
    void this.loadSamples();
    void this.context?.resume();
  }

  updateListener(camera: THREE.Camera) {
    if (!this.context || !this.enabled) return;
    camera.getWorldPosition(this.listenerPosition);
    camera.getWorldDirection(this.listenerForward);
    const listener = this.context.listener;
    const now = this.context.currentTime;
    listener.positionX.setTargetAtTime(this.listenerPosition.x, now, 0.03);
    listener.positionY.setTargetAtTime(this.listenerPosition.y, now, 0.03);
    listener.positionZ.setTargetAtTime(this.listenerPosition.z, now, 0.03);
    listener.forwardX.setTargetAtTime(this.listenerForward.x, now, 0.03);
    listener.forwardY.setTargetAtTime(this.listenerForward.y, now, 0.03);
    listener.forwardZ.setTargetAtTime(this.listenerForward.z, now, 0.03);
    listener.upX.setTargetAtTime(0, now, 0.03);
    listener.upY.setTargetAtTime(1, now, 0.03);
    listener.upZ.setTargetAtTime(0, now, 0.03);
  }

  playLaunch(
    style: FireworkLaunchStyle,
    trail: number,
    position: Point3,
  ) {
    const context = this.readyContext();
    if (!context) return;
    const now = context.currentTime;
    const duration = style === "comet" ? 1.12 : style === "spiral" ? 1.24 : 0.88;
    const basePitch = style === "spiral" ? 155 : style === "twin" ? 112 : 126;

    this.tone(
      now,
      duration,
      position,
      "sine",
      basePitch,
      style === "comet" ? 680 : 510,
      0.035 * trail,
      0.12,
    );
    this.noiseShot(
      now,
      duration * 0.92,
      position,
      "bandpass",
      style === "comet" ? 920 : 660,
      style === "spiral" ? 4300 : 3100,
      0.022 * trail,
      0.1,
      2.4,
    );

    if (style === "spiral") {
      for (let index = 0; index < 5; index += 1) {
        this.tone(
          now + 0.12 + index * 0.17,
          0.12,
          position,
          "triangle",
          480 + index * 56,
          620 + index * 62,
          0.009 * trail,
          0.08,
        );
      }
    }
    if (style === "comet" || style === "twin") {
      for (let index = 0; index < 4; index += 1) {
        this.crackle(now + 0.28 + index * 0.16, position, 0.012 * trail, 2200, 0.08);
      }
    }
  }

  playBurst(
    pattern: FireworkPattern,
    dissipation: FireworkDissipation,
    intensity: number,
    position: Point3,
  ) {
    const context = this.readyContext();
    if (!context) return;
    const distance = this.listenerPosition.distanceTo(
      new THREE.Vector3(position.x, position.y, position.z),
    );
    const now = context.currentTime + THREE.MathUtils.clamp(distance / 343, 0.025, 0.16);
    const accent = PATTERN_ACCENTS[pattern];
    const bodyDuration = accent === "rumble" ? 1.65 : 1.06;
    const hasRecording = this.sampleBuffers.length > 0;

    if (hasRecording) this.playRecordedBurst(now, position, intensity, accent === "rumble");

    this.noiseShot(now, 0.075, position, "highpass", 6200, 1800, (hasRecording ? 0.06 : 0.15) * intensity, 0.08, 0.6);
    this.noiseShot(now + 0.012, bodyDuration, position, "lowpass", 860, 78, (hasRecording ? 0.07 : 0.16) * intensity, 0.32, 0.8);
    this.tone(now, 0.78, position, "sine", 72, 27, (hasRecording ? 0.075 : 0.13) * intensity, 0.22);

    if (accent === "double") {
      this.noiseShot(now + 0.19, 0.54, position, "lowpass", 640, 92, 0.075 * intensity, 0.38, 0.8);
      this.tone(now + 0.18, 0.48, position, "sine", 58, 31, 0.055 * intensity, 0.3);
    } else if (accent === "air") {
      this.noiseShot(now + 0.06, 0.72, this.offset(position, -0.8), "bandpass", 1800, 720, 0.036 * intensity, 0.46, 1.4);
      this.noiseShot(now + 0.13, 0.7, this.offset(position, 0.8), "bandpass", 2100, 820, 0.03 * intensity, 0.46, 1.5);
    } else if (accent === "crack") {
      for (let index = 0; index < 5; index += 1) {
        this.crackle(now + 0.08 + index * 0.055, this.offset(position, (index - 2) * 0.24), 0.03 * intensity, 2900, 0.18);
      }
    } else if (accent === "rumble") {
      this.noiseShot(now + 0.22, 1.9, position, "lowpass", 310, 55, 0.055 * intensity, 0.56, 0.7);
    }

    this.playDissipationTail(now, dissipation, intensity, position);
  }

  dispose() {
    this.enabled = false;
    void this.context?.close();
    this.context = null;
    this.master = null;
    this.dryBus = null;
    this.convolver = null;
    this.wetBus = null;
    this.noiseBuffer = null;
    this.sampleBuffers = [];
    this.sampleLoading = null;
  }

  private readyContext() {
    if (!this.enabled) return null;
    this.ensureGraph();
    return this.context;
  }

  private ensureGraph() {
    if (this.context) return;
    const context = new AudioContext();
    const master = context.createGain();
    const compressor = context.createDynamicsCompressor();
    const dryBus = context.createGain();
    const convolver = context.createConvolver();
    const wetBus = context.createGain();

    master.gain.value = 0.72;
    compressor.threshold.value = -16;
    compressor.knee.value = 18;
    compressor.ratio.value = 5;
    compressor.attack.value = 0.006;
    compressor.release.value = 0.36;
    dryBus.gain.value = 1;
    wetBus.gain.value = 0.5;
    convolver.buffer = this.createImpulse(context, 2.9, 2.7);

    dryBus.connect(master);
    convolver.connect(wetBus).connect(master);
    master.connect(compressor).connect(context.destination);

    this.context = context;
    this.master = master;
    this.dryBus = dryBus;
    this.convolver = convolver;
    this.wetBus = wetBus;
    this.noiseBuffer = this.createNoise(context, 3.2);
  }

  private loadSamples() {
    if (!this.context || this.sampleBuffers.length || this.sampleLoading) return this.sampleLoading;
    const context = this.context;
    this.sampleLoading = Promise.allSettled(
      RECORDED_BURSTS.map(async (url) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Unable to load ${url}`);
        return context.decodeAudioData(await response.arrayBuffer());
      }),
    ).then((results) => {
      this.sampleBuffers = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    });
    return this.sampleLoading;
  }

  private playRecordedBurst(
    when: number,
    position: Point3,
    intensity: number,
    lowRumble: boolean,
  ) {
    if (!this.context || !this.sampleBuffers.length) return;
    const cannonStart = Math.max(0, this.sampleBuffers.length - 3);
    const poolStart = lowRumble ? cannonStart : 0;
    const poolSize = lowRumble ? this.sampleBuffers.length - cannonStart : Math.max(1, cannonStart);
    const buffer = this.sampleBuffers[poolStart + (this.sampleIndex % poolSize)];
    this.sampleIndex += 1;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const distance = this.listenerPosition.distanceTo(new THREE.Vector3(position.x, position.y, position.z));
    source.buffer = buffer;
    source.playbackRate.value = THREE.MathUtils.clamp(0.94 + Math.random() * 0.11, 0.9, 1.08);
    filter.type = "lowpass";
    filter.frequency.value = THREE.MathUtils.lerp(8400, 2600, THREE.MathUtils.clamp(distance / 70, 0, 1));
    filter.Q.value = 0.48;
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.19 * intensity, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + Math.min(buffer.duration / source.playbackRate.value, 3.4));
    source.connect(filter).connect(gain);
    this.spatialize(gain, position, 0.92, lowRumble ? 0.62 : 0.42);
    source.start(when);
  }

  private createNoise(context: AudioContext, seconds: number) {
    const length = Math.ceil(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      let previous = 0;
      for (let index = 0; index < data.length; index += 1) {
        const white = Math.random() * 2 - 1;
        previous = previous * 0.22 + white * 0.78;
        data[index] = previous;
      }
    }
    return buffer;
  }

  private createImpulse(context: AudioContext, seconds: number, decay: number) {
    const length = Math.ceil(context.sampleRate * seconds);
    const impulse = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let index = 0; index < length; index += 1) {
        const envelope = Math.pow(1 - index / length, decay);
        const early = index < context.sampleRate * 0.08 ? 0.45 : 1;
        data[index] = (Math.random() * 2 - 1) * envelope * early;
      }
    }
    return impulse;
  }

  private spatialize(source: AudioNode, position: Point3, dry: number, wet: number) {
    if (!this.context || !this.dryBus || !this.convolver) return;
    const panner = this.context.createPanner();
    const dryGain = this.context.createGain();
    const wetGain = this.context.createGain();
    panner.panningModel = "HRTF";
    panner.distanceModel = "inverse";
    panner.refDistance = 4.5;
    panner.maxDistance = 90;
    panner.rolloffFactor = 0.55;
    panner.coneInnerAngle = 360;
    panner.positionX.value = position.x;
    panner.positionY.value = position.y;
    panner.positionZ.value = position.z;
    dryGain.gain.value = dry;
    wetGain.gain.value = wet;
    source.connect(panner);
    panner.connect(dryGain).connect(this.dryBus);
    panner.connect(wetGain).connect(this.convolver);
  }

  private noiseShot(
    when: number,
    duration: number,
    position: Point3,
    filterShape: FilterShape,
    startFrequency: number,
    endFrequency: number,
    level: number,
    wet: number,
    q: number,
  ) {
    if (!this.context || !this.noiseBuffer) return;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.noiseBuffer;
    filter.type = filterShape;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(startFrequency, when);
    filter.frequency.exponentialRampToValueAtTime(Math.max(24, endFrequency), when + duration);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), when + Math.min(0.018, duration * 0.12));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    source.connect(filter).connect(gain);
    this.spatialize(gain, position, 1, wet);
    const maxOffset = Math.max(0, this.noiseBuffer.duration - duration - 0.01);
    source.start(when, Math.random() * maxOffset, duration);
    source.stop(when + duration + 0.01);
  }

  private tone(
    when: number,
    duration: number,
    position: Point3,
    shape: OscillatorType,
    startFrequency: number,
    endFrequency: number,
    level: number,
    wet: number,
  ) {
    if (!this.context) return;
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    oscillator.type = shape;
    oscillator.frequency.setValueAtTime(startFrequency, when);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(18, endFrequency), when + duration);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0002, level), when + Math.min(0.025, duration * 0.12));
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    oscillator.connect(gain);
    this.spatialize(gain, position, 1, wet);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.01);
  }

  private crackle(
    when: number,
    position: Point3,
    level: number,
    pitch: number,
    wet: number,
  ) {
    this.noiseShot(
      when,
      0.035 + Math.random() * 0.055,
      position,
      "highpass",
      pitch + Math.random() * 1800,
      900 + Math.random() * 700,
      level,
      wet,
      0.8,
    );
  }

  private playDissipationTail(
    now: number,
    dissipation: FireworkDissipation,
    intensity: number,
    position: Point3,
  ) {
    if (dissipation === "soft") {
      this.noiseShot(now + 0.18, 1.45, position, "bandpass", 1250, 260, 0.028 * intensity, 0.62, 0.75);
      return;
    }
    const count = dissipation === "embers" ? 13 : dissipation === "glitter" ? 10 : 6;
    const spacing = dissipation === "strobe" ? 0.13 : dissipation === "embers" ? 0.17 : 0.1;
    const pitch = dissipation === "embers" ? 1350 : dissipation === "glitter" ? 4200 : 2600;
    const level = dissipation === "strobe" ? 0.034 : dissipation === "glitter" ? 0.018 : 0.014;
    for (let index = 0; index < count; index += 1) {
      const jitter = dissipation === "strobe" ? 0 : Math.random() * spacing;
      this.crackle(
        now + 0.16 + index * spacing + jitter,
        this.offset(position, (Math.random() - 0.5) * 2.6),
        level * intensity,
        pitch,
        dissipation === "embers" ? 0.45 : 0.28,
      );
    }
  }

  private offset(position: Point3, x: number): Point3 {
    return { x: position.x + x, y: position.y, z: position.z };
  }
}
