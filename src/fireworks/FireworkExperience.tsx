"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { FireworkScene } from "./FireworkScene";
import {
  calculateExposureStops,
  DEFAULT_CAMERA_SETTINGS,
  DEFAULT_FIREWORK_TUNING,
  type CameraFilter,
  type CameraSettings,
  type EnvironmentPreset,
  type FireworkDissipation,
  type FireworkLaunchStyle,
  type FireworkPattern,
  type FireworkShowCue,
  type FireworkTuning,
  type PaletteName,
  type PatternPoint,
} from "./types";

const PATTERNS: Array<{ id: FireworkPattern; name: string; note: string; mark: string }> = [
  { id: "peony", name: "牡丹", note: "球形多层", mark: "✺" },
  { id: "chrysanthemum", name: "菊型", note: "细丝长尾", mark: "✹" },
  { id: "heart", name: "爱心", note: "轮廓成形", mark: "♥" },
  { id: "saturn", name: "土星环", note: "中心与外环", mark: "◎" },
  { id: "willow", name: "垂柳", note: "慢速下坠", mark: "⌇" },
  { id: "star", name: "五角星", note: "清晰轮廓", mark: "★" },
  { id: "spiral", name: "螺旋", note: "三臂旋开", mark: "◌" },
  { id: "butterfly", name: "蝴蝶", note: "左右对称", mark: "⋈" },
  { id: "palm", name: "棕榈", note: "长枝分叉", mark: "Ψ" },
  { id: "crown", name: "皇冠", note: "上扬尖顶", mark: "♕" },
  { id: "double-ring", name: "双环", note: "两圈交错", mark: "⊚" },
  { id: "meteor", name: "流星", note: "高速长轨", mark: "彡" },
];

const PALETTES: Array<{ id: PaletteName; name: string; colors: string[] }> = [
  { id: "love", name: "玫红", colors: ["#ff4d9d", "#ff9aca", "#fff4f8"] },
  { id: "aurora", name: "极光", colors: ["#36f1ca", "#6aa8ff", "#c379ff"] },
  { id: "gold", name: "暖金", colors: ["#ffad2f", "#ffe7a7", "#fff9dc"] },
  { id: "dream", name: "蓝紫", colors: ["#705cff", "#26d6ff", "#ff4ddd"] },
];

type StudioMode = "text" | "pattern" | "draw" | "effect" | "show";

type NumericTuningKey = "power" | "spread" | "lifetime" | "trail";

const LAUNCH_STYLES: Array<{ id: FireworkLaunchStyle; name: string; note: string; mark: string }> = [
  { id: "classic", name: "直线", note: "标准速度", mark: "↑" },
  { id: "comet", name: "彗星", note: "长尾慢升", mark: "↗" },
  { id: "spiral", name: "螺旋", note: "盘旋上升", mark: "↻" },
  { id: "twin", name: "双发", note: "两束同步", mark: "⇈" },
];

const DISSIPATIONS: Array<{ id: FireworkDissipation; name: string; note: string }> = [
  { id: "soft", name: "柔雾", note: "均匀淡出" },
  { id: "glitter", name: "碎钻", note: "高频闪烁" },
  { id: "embers", name: "余烬", note: "缓慢坠落" },
  { id: "strobe", name: "频闪", note: "节奏明灭" },
];

const TUNING_CONTROLS: Array<{
  id: NumericTuningKey;
  name: string;
  note: string;
  min: number;
  max: number;
}> = [
  { id: "power", name: "爆炸强度", note: "速度与冲击感", min: 0.55, max: 1.7 },
  { id: "spread", name: "散开程度", note: "图案覆盖范围", min: 0.5, max: 1.75 },
  { id: "lifetime", name: "停留时间", note: "留在夜空多久", min: 0.5, max: 1.8 },
  { id: "trail", name: "拖尾长度", note: "粒子轨迹密度", min: 0.35, max: 1.9 },
];

type ShowCue = FireworkShowCue & { id: number };

const ENVIRONMENTS: Array<{
  id: EnvironmentPreset;
  name: string;
  note: string;
  mark: string;
}> = [
  { id: "moon-castle", name: "月港", note: "冷色月光", mark: "☾" },
  { id: "rose-garden", name: "蔷薇露台", note: "暖色灯光", mark: "✿" },
  { id: "cloud-observatory", name: "观星台", note: "青蓝夜空", mark: "◌" },
];

const DEFAULT_SHOW: ShowCue[] = [
  { id: 1, pattern: "peony", palette: "aurora", delay: 0.4 },
  { id: 2, pattern: "spiral", palette: "dream", delay: 0.8 },
  { id: 3, pattern: "heart", palette: "love", delay: 0.9 },
  { id: 4, pattern: "willow", palette: "gold", delay: 1.1 },
  { id: 5, pattern: "butterfly", palette: "love", delay: 0.8 },
];

const SHOW_DELAYS = [0.4, 0.7, 1, 1.4, 2];

const APERTURE_OPTIONS = [1.2, 1.4, 1.8, 2, 2.8, 4, 5.6, 8, 11, 16];
const SHUTTER_OPTIONS = [8, 4, 2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 15, 1 / 30, 1 / 60, 1 / 125, 1 / 250, 1 / 500, 1 / 1000];
const ISO_OPTIONS = [100, 200, 320, 400, 800, 1600, 3200, 6400, 12800, 25600];

const FILTERS: Array<{ id: CameraFilter; name: string }> = [
  { id: "neutral", name: "自然" },
  { id: "cinema", name: "电影" },
  { id: "rose", name: "玫瑰" },
  { id: "moonlight", name: "冷月" },
];

function formatShutter(seconds: number) {
  if (seconds >= 1) return `${Number.isInteger(seconds) ? seconds.toFixed(0) : seconds.toFixed(1)} s`;
  return `1/${Math.round(1 / seconds)} s`;
}

function formatExposureStops(stops: number) {
  if (Math.abs(stops) < 0.05) return "±0.0 EV";
  return `${stops > 0 ? "+" : ""}${stops.toFixed(1)} EV`;
}

function sampleText(text: string): PatternPoint[] {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 280;
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  let fontSize = 172;
  const fontFamily = '"PingFang SC", "Songti SC", "Microsoft YaHei", sans-serif';
  context.font = `900 ${fontSize}px ${fontFamily}`;
  while (context.measureText(text).width > 840 && fontSize > 64) {
    fontSize -= 4;
    context.font = `900 ${fontSize}px ${fontFamily}`;
  }
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.lineJoin = "round";
  context.strokeStyle = "rgba(255,255,255,.95)";
  context.fillStyle = "white";
  context.lineWidth = Math.max(2, fontSize * 0.018);
  context.strokeText(text, canvas.width / 2, canvas.height / 2 + 4);
  context.fillText(text, canvas.width / 2, canvas.height / 2 + 4);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const points: PatternPoint[] = [];
  const step = fontSize > 120 ? 5 : 4;
  for (let y = 0; y < canvas.height; y += step) {
    for (let x = 0; x < canvas.width; x += step) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 110) {
        points.push({
          x: ((x - canvas.width / 2) / canvas.width) * 2,
          y: ((canvas.height / 2 - y) / canvas.width) * 2,
        });
      }
    }
  }
  return points;
}

function sampleDrawing(canvas: HTMLCanvasElement): PatternPoint[] {
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const points: PatternPoint[] = [];
  for (let y = 0; y < canvas.height; y += 4) {
    for (let x = 0; x < canvas.width; x += 4) {
      if (pixels[(y * canvas.width + x) * 4 + 3] > 90) {
        points.push({
          x: ((x - canvas.width / 2) / canvas.width) * 2,
          y: ((canvas.height / 2 - y) / canvas.width) * 2,
        });
      }
    }
  }
  return points;
}

function drawStarterHeart(canvas: HTMLCanvasElement) {
  const context = canvas.getContext("2d")!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = "rgba(255,255,255,.96)";
  context.shadowColor = "#ff63b5";
  context.shadowBlur = 18;
  context.lineWidth = Math.max(16, canvas.width * 0.018);
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  const heartScale = Math.min(canvas.width * 0.23, canvas.height * 0.38);
  const points = Array.from({ length: 160 }, (_, index) => {
    const t = (index / 159) * Math.PI * 2;
    return {
      x: canvas.width / 2 + Math.pow(Math.sin(t), 3) * heartScale,
      y:
        canvas.height / 2 -
        ((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) /
          16) *
          heartScale,
    };
  });
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.stroke();
  context.shadowBlur = 0;
}

export function FireworkExperience() {
  const rootRef = useRef<HTMLElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FireworkScene | null>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const uploadedMusicUrlRef = useRef<string | null>(null);
  const drawingInitializedRef = useRef(false);
  const nextCueIdRef = useRef(6);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDrawingRef = useRef(false);
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null);
  const chromeTimerRef = useRef<number | null>(null);
  const musicDuckTimerRef = useRef<number | null>(null);
  const musicVolumeRef = useRef(0.34);
  const shutterAudioRef = useRef<AudioContext | null>(null);
  const isExposingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [chromeVisible, setChromeVisible] = useState(true);
  const [studioOpen, setStudioOpen] = useState(false);
  const [mode, setMode] = useState<StudioMode>("text");
  const [message, setMessage] = useState("今晚也很喜欢你");
  const [pattern, setPattern] = useState<FireworkPattern>("heart");
  const [palette, setPalette] = useState<PaletteName>("love");
  const [tuning, setTuning] = useState<FireworkTuning>({ ...DEFAULT_FIREWORK_TUNING });
  const [customColorsEnabled, setCustomColorsEnabled] = useState(false);
  const [customColors, setCustomColors] = useState<[string, string, string]>([
    "#ff4d9d",
    "#8b6cff",
    "#ffe6a8",
  ]);
  const [sound, setSound] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [photoMode, setPhotoMode] = useState(false);
  const [photoPaused, setPhotoPaused] = useState(false);
  const [isExposing, setIsExposing] = useState(false);
  const [exposureProgress, setExposureProgress] = useState(0);
  const [capturedPhoto, setCapturedPhoto] = useState<string | null>(null);
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>({ ...DEFAULT_CAMERA_SETTINGS });
  const [environment, setEnvironment] = useState<EnvironmentPreset>("moon-castle");
  const [activePopover, setActivePopover] = useState<"atmosphere" | "music" | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.34);
  const [musicName, setMusicName] = useState("降 E 大调夜曲");
  const [showCues, setShowCues] = useState<ShowCue[]>(DEFAULT_SHOW);
  const [showPlaying, setShowPlaying] = useState(false);
  const [showProgress, setShowProgress] = useState(0);
  const [showChapter, setShowChapter] = useState("序幕");
  const [status, setStatus] = useState("系统就绪");
  const exposureStops = calculateExposureStops(cameraSettings);
  const exposureNeedle = Math.min(1, Math.max(0, (exposureStops + 6) / 12));

  const duckMusic = useCallback((intensity: number) => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    const baseVolume = musicVolumeRef.current;
    audio.volume = Math.max(0.05, baseVolume * (0.72 - Math.min(1.7, intensity) * 0.08));
    if (musicDuckTimerRef.current !== null) window.clearTimeout(musicDuckTimerRef.current);
    musicDuckTimerRef.current = window.setTimeout(() => {
      if (audioRef.current) audioRef.current.volume = musicVolumeRef.current;
    }, 520);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    let active = true;
    let mountedScene: FireworkScene | null = null;
    setLoadProgress(0.03);
    void import("./FireworkScene").then(({ FireworkScene: FireworkSceneRuntime }) => {
      if (!active) return;
      mountedScene = new FireworkSceneRuntime(viewport, {
        onReady: () => {
          if (active) setReady(true);
        },
        onLoadProgress: (progress) => {
          if (active) setLoadProgress(progress);
        },
        onImpact: duckMusic,
        onShowProgress: (progress, chapter, isActive) => {
          if (!active) return;
          setShowProgress(progress);
          setShowChapter(chapter);
          setShowPlaying(isActive);
          if (!isActive) setAutoPlay(true);
        },
      });
      sceneRef.current = mountedScene;
    });
    return () => {
      active = false;
      mountedScene?.dispose();
      if (sceneRef.current === mountedScene) sceneRef.current = null;
      if (chromeTimerRef.current !== null) window.clearTimeout(chromeTimerRef.current);
      if (musicDuckTimerRef.current !== null) window.clearTimeout(musicDuckTimerRef.current);
      if (uploadedMusicUrlRef.current) URL.revokeObjectURL(uploadedMusicUrlRef.current);
    };
  }, [duckMusic]);

  useEffect(() => {
    const canvas = drawingCanvasRef.current;
    if (mode === "draw" && canvas && !drawingInitializedRef.current) {
      drawStarterHeart(canvas);
      drawingInitializedRef.current = true;
    }
  }, [mode]);

  useEffect(() => {
    sceneRef.current?.setCameraSettings(cameraSettings);
  }, [cameraSettings]);

  useEffect(() => {
    sceneRef.current?.setEnvironment(environment);
  }, [environment]);

  useEffect(() => {
    musicVolumeRef.current = musicVolume;
    if (audioRef.current) audioRef.current.volume = musicVolume;
  }, [musicVolume]);

  const chromeLocked = studioOpen || photoMode || activePopover !== null;

  const revealChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimerRef.current !== null) window.clearTimeout(chromeTimerRef.current);
    if (!chromeLocked && ready) {
      chromeTimerRef.current = window.setTimeout(() => setChromeVisible(false), 3600);
    }
  }, [chromeLocked, ready]);

  useEffect(() => {
    if (chromeTimerRef.current !== null) window.clearTimeout(chromeTimerRef.current);
    if (!chromeLocked && ready) {
      chromeTimerRef.current = window.setTimeout(() => setChromeVisible(false), 3600);
    }
    return () => {
      if (chromeTimerRef.current !== null) window.clearTimeout(chromeTimerRef.current);
    };
  }, [chromeLocked, ready]);

  const announce = useCallback((nextStatus: string) => {
    setStatus(nextStatus);
    window.setTimeout(() => setStatus("点击天空发射"), 2400);
  }, []);

  const effectOptions = useCallback(
    () => ({
      tuning: { ...tuning },
      colors: customColorsEnabled ? [...customColors] : undefined,
    }),
    [customColors, customColorsEnabled, tuning],
  );

  const setPhotoModeActive = useCallback(
    (active: boolean) => {
      if (isExposing) return;
      setPhotoMode(active);
      setPhotoPaused(false);
      if (!active) setCapturedPhoto(null);
      sceneRef.current?.setPaused(false);
      announce(active ? "摄影模式已开启" : "已返回观赏模式");
    },
    [announce, isExposing],
  );

  const togglePhotoMode = useCallback(() => {
    setPhotoModeActive(!photoMode);
  }, [photoMode, setPhotoModeActive]);

  const togglePhotoPause = useCallback(() => {
    if (isExposing) return;
    const next = !photoPaused;
    setPhotoPaused(next);
    sceneRef.current?.setPaused(next);
    announce(next ? "画面已暂停" : "画面继续播放");
  }, [announce, isExposing, photoPaused]);

  const resetCamera = useCallback(() => {
    sceneRef.current?.resetView();
    announce("视角已复位");
  }, [announce]);

  const launchText = useCallback(
    (finale = false) => {
      const cleanMessage = message.trim().slice(0, 14) || "我喜欢你";
      const points = sampleText(cleanMessage);
      if (finale) {
        sceneRef.current?.launchFinale(points, palette, effectOptions());
        announce(`开始播放文字编排：${cleanMessage}`);
      } else {
        sceneRef.current?.launch({
          pattern: "text",
          palette,
          points,
          x: 0,
          y: 14.5,
          z: -22,
          ...effectOptions(),
        });
        announce(`已发射文字：${cleanMessage}`);
      }
    },
    [announce, effectOptions, message, palette],
  );

  const launchSelectedPattern = useCallback(() => {
    sceneRef.current?.launch({ pattern, palette, ...effectOptions() });
    const selected = PATTERNS.find((item) => item.id === pattern);
    announce(`已发射：${selected?.name ?? "烟花"}`);
  }, [announce, effectOptions, palette, pattern]);

  const launchDrawing = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const points = sampleDrawing(canvas);
    sceneRef.current?.launch({
      pattern: "custom",
      palette,
      points,
      x: 0,
      y: 14.5,
      z: -22,
      ...effectOptions(),
    });
    announce("已发射手绘图案");
  }, [announce, effectOptions, palette]);

  const launchCurrent = () => {
    if (mode === "text") launchText(false);
    else if (mode === "draw") launchDrawing();
    else launchSelectedPattern();
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    sceneRef.current?.setSoundEnabled(next);
    announce(next ? "烟花音效已开启" : "烟花音效已关闭");
  };

  const toggleAutoPlay = () => {
    const next = !autoPlay;
    setAutoPlay(next);
    sceneRef.current?.setAutoPlay(next);
    announce(next ? "自动发射已开启" : "自动发射已关闭");
  };

  const chooseEnvironment = (next: EnvironmentPreset, name: string) => {
    setEnvironment(next);
    sceneRef.current?.setEnvironment(next);
    announce(`场景：${name}`);
  };

  const toggleMusic = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) {
      audio.pause();
      setMusicPlaying(false);
      return;
    }
    try {
      await audio.play();
      setMusicPlaying(true);
    } catch {
      setMusicPlaying(false);
    }
  };

  const playBuiltInMusic = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (uploadedMusicUrlRef.current) {
      URL.revokeObjectURL(uploadedMusicUrlRef.current);
      uploadedMusicUrlRef.current = null;
    }
    audio.src = "/nocturne-op9-no2.mp3";
    audio.load();
    setMusicName("降 E 大调夜曲");
    try {
      await audio.play();
      setMusicPlaying(true);
    } catch {
      setMusicPlaying(false);
    }
  };

  const playLocalMusic = async (file?: File) => {
    const audio = audioRef.current;
    if (!audio || !file) return;
    if (uploadedMusicUrlRef.current) URL.revokeObjectURL(uploadedMusicUrlRef.current);
    const url = URL.createObjectURL(file);
    uploadedMusicUrlRef.current = url;
    audio.src = url;
    audio.load();
    setMusicName(file.name.replace(/\.[^.]+$/, ""));
    try {
      await audio.play();
      setMusicPlaying(true);
    } catch {
      setMusicPlaying(false);
    }
  };

  const toggleCinematicShow = async () => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (showPlaying) {
      scene.stopCinematicShow(true);
      setShowPlaying(false);
      setAutoPlay(true);
      announce("演出已结束");
      return;
    }

    setStudioOpen(false);
    setActivePopover(null);
    setAutoPlay(false);
    setSound(true);
    setPhotoMode(false);
    setPhotoPaused(false);
    scene.setPaused(false);
    scene.setSoundEnabled(true);
    const audio = audioRef.current;
    if (audio?.paused) {
      try {
        await audio.play();
      } catch {
        setMusicPlaying(false);
      }
    }
    const cleanMessage = message.trim().slice(0, 14) || "今晚也很喜欢你";
    scene.playCinematicShow(sampleText(cleanMessage), palette);
    setShowPlaying(true);
    setShowProgress(0);
    setShowChapter("序幕");
    announce("演出开始");
  };

  const addShowCue = () => {
    if (showCues.length >= 12) return;
    setShowCues((current) => [
      ...current,
      {
        id: nextCueIdRef.current++,
        pattern: pattern as FireworkShowCue["pattern"],
        palette,
        delay: 0.8,
        tuning: { ...tuning },
        colors: customColorsEnabled ? [...customColors] : undefined,
      },
    ]);
  };

  const updateShowCue = (id: number, patch: Partial<FireworkShowCue>) => {
    setShowCues((current) => current.map((cue) => (cue.id === id ? { ...cue, ...patch } : cue)));
  };

  const removeShowCue = (id: number) => {
    setShowCues((current) => current.filter((cue) => cue.id !== id));
  };

  const moveShowCue = (index: number, direction: -1 | 1) => {
    setShowCues((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const playShow = () => {
    if (!showCues.length) return;
    setAutoPlay(false);
    sceneRef.current?.launchSequence(showCues);
    announce(`开始播放 ${showCues.length} 个编排节点`);
  };

  const updateCameraSettings = (patch: Partial<CameraSettings>) => {
    setCameraSettings((current) => ({ ...current, ...patch }));
  };

  const playShutterClick = useCallback((closing = false) => {
    const context = shutterAudioRef.current ?? new AudioContext();
    shutterAudioRef.current = context;
    if (context.state === "suspended") void context.resume();
    const duration = closing ? 0.038 : 0.028;
    const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * duration), context.sampleRate);
    const samples = buffer.getChannelData(0);
    for (let index = 0; index < samples.length; index += 1) {
      const envelope = Math.exp(-index / (context.sampleRate * (closing ? 0.011 : 0.007)));
      samples[index] = (Math.random() * 2 - 1) * envelope;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const start = context.currentTime + 0.004;
    filter.type = "bandpass";
    filter.frequency.setValueAtTime(closing ? 720 : 1180, start);
    filter.Q.setValueAtTime(closing ? 0.78 : 1.1, start);
    gain.gain.setValueAtTime(closing ? 0.075 : 0.09, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.buffer = buffer;
    source.connect(filter).connect(gain).connect(context.destination);
    source.start(start);
  }, []);

  useEffect(() => () => {
    const context = shutterAudioRef.current;
    if (context && context.state !== "closed") void context.close();
  }, []);

  const capturePhoto = useCallback(async () => {
    const scene = sceneRef.current;
    if (!scene || isExposingRef.current) return;
    isExposingRef.current = true;
    setCapturedPhoto(null);
    setExposureProgress(0);
    setIsExposing(true);
    playShutterClick(false);
    announce(`快门开启 · ${formatShutter(cameraSettings.shutterSeconds)}`);
    try {
      const image = await scene.captureExposure(setExposureProgress);
      if (!image) return;
      playShutterClick(true);
      setCapturedPhoto(image);
      setPhotoPaused(true);
      scene.setPaused(true);
      announce("曝光完成");
    } finally {
      isExposingRef.current = false;
      setIsExposing(false);
      setExposureProgress(1);
    }
  }, [announce, cameraSettings.shutterSeconds, playShutterClick]);

  const saveCapturedPhoto = () => {
    if (!capturedPhoto) return;
    const link = document.createElement("a");
    link.href = capturedPhoto;
    link.download = `hanabi-${cameraSettings.iso}-f${cameraSettings.aperture}-${Date.now()}.png`;
    link.click();
    announce("照片已保存");
  };

  const closePhotoReview = () => {
    setCapturedPhoto(null);
    setPhotoPaused(false);
    sceneRef.current?.setPaused(false);
    announce("回到取景器");
  };

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPhotoModeActive(!photoMode);
        return;
      }
      if (!photoMode) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea, button")) return;
      if (!event.repeat && (event.code === "Enter" || event.key.toLowerCase() === "s")) {
        event.preventDefault();
        if (!capturedPhoto) void capturePhoto();
      } else if (event.code === "Space") {
        event.preventDefault();
        togglePhotoPause();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetCamera();
      } else if (event.key === "Escape") {
        if (capturedPhoto) {
          setCapturedPhoto(null);
          setPhotoPaused(false);
          sceneRef.current?.setPaused(false);
          return;
        }
        setPhotoModeActive(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [capturePhoto, capturedPhoto, photoMode, resetCamera, setPhotoModeActive, togglePhotoPause]);

  const handleSkyPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    dragStartRef.current = { x: event.clientX, y: event.clientY };
  };

  const handleSkyPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = dragStartRef.current;
    dragStartRef.current = null;
    if (!start || event.target !== viewportRef.current?.querySelector("canvas")) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) return;
    const clickPattern = mode === "pattern" ? pattern : "peony";
    sceneRef.current?.launchAt(event.clientX, event.clientY, {
      pattern: clickPattern,
      palette,
      ...effectOptions(),
    });
    announce("已在指定位置发射");
  };

  const drawingPosition = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const startDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    isDrawingRef.current = true;
    lastDrawPointRef.current = drawingPosition(event);
  };

  const continueDrawing = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current || !lastDrawPointRef.current) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d")!;
    const current = drawingPosition(event);
    context.strokeStyle = "rgba(255,255,255,.98)";
    context.shadowColor = "#ff58b0";
    context.shadowBlur = 15;
    context.lineWidth = 22;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    context.moveTo(lastDrawPointRef.current.x, lastDrawPointRef.current.y);
    context.lineTo(current.x, current.y);
    context.stroke();
    context.shadowBlur = 0;
    lastDrawPointRef.current = current;
  };

  const stopDrawing = () => {
    isDrawingRef.current = false;
    lastDrawPointRef.current = null;
  };

  const clearDrawing = () => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) void rootRef.current?.requestFullscreen();
    else void document.exitFullscreen();
  };

  return (
    <main
      ref={rootRef}
      className={`firework-shell ${ready ? "is-ready" : ""} ${photoMode ? "is-photo-mode" : ""} ${chromeVisible ? "" : "is-chrome-idle"}`}
      data-testid="firework-night"
      onPointerMove={revealChrome}
      onPointerDownCapture={revealChrome}
    >
      <div
        ref={viewportRef}
        className="firework-viewport"
        onPointerDown={handleSkyPointerDown}
        onPointerUp={handleSkyPointerUp}
      />
      {/* Instrumental background music has no spoken or lyrical content. */}
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        ref={audioRef}
        src="/nocturne-op9-no2.mp3"
        preload="metadata"
        loop
        onPlay={() => setMusicPlaying(true)}
        onPause={() => setMusicPlaying(false)}
      />
      <div className="color-wash" aria-hidden="true" />
      <div className="cinema-grain" aria-hidden="true" />
      <div className="vignette" aria-hidden="true" />

      <div className="loading-curtain" aria-hidden="true">
        <div className="loading-mark">花</div>
        <p>花火正在点亮夜空</p>
        <div className="loading-progress"><i style={{ width: `${Math.round(loadProgress * 100)}%` }} /></div>
        <small>{Math.round(loadProgress * 100)}%</small>
      </div>

      <header className="topbar">
        <div className="window-controls" aria-hidden="true"><i /><i /><i /></div>
        <div className="brand-lockup">
          <span className="app-icon" aria-hidden="true">花</span>
          <div>
            <h1>花火</h1>
            <p className="subtitle">{ENVIRONMENTS.find((item) => item.id === environment)?.name}</p>
          </div>
        </div>

        <div className="scene-live-status"><i /> 实时</div>

        <nav className="utility-actions" aria-label="场景工具">
          <button
            type="button"
            className={activePopover === "atmosphere" ? "is-active" : ""}
            onClick={() => setActivePopover((current) => (current === "atmosphere" ? null : "atmosphere"))}
          >
            <span aria-hidden="true">☾</span>
            场景
          </button>
          <button
            type="button"
            className={musicPlaying || activePopover === "music" ? "is-active" : ""}
            onClick={() => setActivePopover((current) => (current === "music" ? null : "music"))}
          >
            <span aria-hidden="true">{musicPlaying ? "♫" : "♪"}</span>
            音乐
          </button>
          <button type="button" className={sound ? "is-active" : ""} onClick={toggleSound}>
            <span aria-hidden="true">{sound ? "♪" : "♩"}</span>
            音效
          </button>
          <button type="button" className={autoPlay ? "is-active" : ""} onClick={toggleAutoPlay}>
            <span aria-hidden="true">∞</span>
            自动
          </button>
          <button type="button" className={showPlaying ? "is-active show-action" : "show-action"} onClick={() => void toggleCinematicShow()}>
            <span aria-hidden="true">▶</span>
            {showPlaying ? "结束" : "演出"}
          </button>
          <button type="button" className={photoMode ? "is-active" : ""} onClick={togglePhotoMode}>
            <span aria-hidden="true">◉</span>
            摄影
          </button>
          <button type="button" onClick={toggleFullscreen}>
            <span aria-hidden="true">⌗</span>
            全屏
          </button>
        </nav>
      </header>

      <section className={`show-now-playing ${showPlaying ? "is-open" : ""}`} aria-live="polite">
        <div>
          <small>花火</small>
          <strong>{showChapter}</strong>
        </div>
        <i><b style={{ width: `${showProgress * 100}%` }} /></i>
        <button type="button" onClick={() => void toggleCinematicShow()} aria-label="结束演出">■</button>
      </section>

      <section className={`experience-popover scene-popover ${activePopover === "atmosphere" ? "is-open" : ""}`} aria-label="夜色氛围">
        <header>
          <div><small>SCENE</small><strong>{ENVIRONMENTS.find((item) => item.id === environment)?.name}</strong></div>
          <button type="button" onClick={() => setActivePopover(null)} aria-label="关闭">×</button>
        </header>
        <div className="scene-section-title"><span>环境预设</span><small>天空、湖面与主光源</small></div>
        <div className="atmosphere-options">
          {ENVIRONMENTS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={environment === item.id ? "is-selected" : ""}
              onClick={() => chooseEnvironment(item.id, item.name)}
            >
              <i aria-hidden="true">{item.mark}</i>
              <span><strong>{item.name}</strong><small>{item.note}</small></span>
            </button>
          ))}
        </div>
      </section>

      <section className={`experience-popover music-popover ${activePopover === "music" ? "is-open" : ""}`} aria-label="背景音乐">
        <header>
          <div><small>MUSIC</small><strong>{musicName}</strong></div>
          <button type="button" onClick={() => setActivePopover(null)} aria-label="关闭">×</button>
        </header>
        <div className="music-player">
          <button type="button" className="music-play" onClick={toggleMusic} aria-label={musicPlaying ? "暂停音乐" : "播放音乐"}>
            {musicPlaying ? "Ⅱ" : "▶"}
          </button>
          <div className={musicPlaying ? "music-wave is-playing" : "music-wave"} aria-hidden="true">
            {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
          </div>
        </div>
        <label className="music-volume">
          <span>音量</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={musicVolume}
            onChange={(event) => setMusicVolume(Number(event.target.value))}
          />
          <output>{Math.round(musicVolume * 100)}</output>
        </label>
        <div className="music-sources">
          <button type="button" onClick={() => void playBuiltInMusic()}>肖邦夜曲</button>
          <label>
            选择本地音乐
            <input type="file" accept="audio/*" onChange={(event) => void playLocalMusic(event.target.files?.[0])} />
          </label>
        </div>
      </section>

      <div className="photo-mode-indicator" aria-hidden={!photoMode}>
        <span className={isExposing ? "is-exposing" : photoPaused ? "is-paused" : ""} />
        <strong>{isExposing ? "曝光中" : "摄影模式"}</strong>
        <small>{isExposing ? `${Math.round(exposureProgress * 100)}%` : photoPaused ? "照片回放" : "实时取景"}</small>
      </div>

      <section
        className={`camera-console ${photoMode ? "is-open" : ""} ${isExposing ? "is-exposing" : ""}`}
        aria-label="专业摄像参数"
        aria-busy={isExposing}
      >
        <header className="camera-console-header">
          <div>
            <p>CAMERA</p>
            <h2>摄影参数</h2>
          </div>
          <button type="button" disabled={isExposing} onClick={() => setPhotoModeActive(false)} aria-label="退出摄像模式">×</button>
        </header>

        <div className="camera-readout" aria-label="当前曝光参数">
          <span><small>LENS</small><strong>{cameraSettings.focalLength.toFixed(0)}<i>mm</i></strong></span>
          <span><small>IRIS</small><strong>ƒ/{cameraSettings.aperture.toFixed(1)}</strong></span>
          <span><small>SHUTTER</small><strong>{formatShutter(cameraSettings.shutterSeconds)}</strong></span>
          <span><small>SENSOR</small><strong>ISO {cameraSettings.iso}</strong></span>
        </div>

        <div className="exposure-meter" aria-label={`测光结果 ${formatExposureStops(exposureStops)}`}>
          <span>METER</span>
          <div aria-hidden="true">
            <i style={{ "--meter-position": `${exposureNeedle * 100}%` } as CSSProperties} />
            <b />
          </div>
          <output className={Math.abs(exposureStops) > 3 ? "is-clipped" : ""}>
            {formatExposureStops(exposureStops)}
          </output>
        </div>

        <div className="camera-controls">
          <label>
            <span><strong>焦段</strong><small>FOCAL LENGTH</small></span>
            <output>{cameraSettings.focalLength.toFixed(0)} mm</output>
            <input
              aria-label="焦段"
              type="range"
              min="18"
              max="85"
              step="1"
              value={cameraSettings.focalLength}
              onChange={(event) => updateCameraSettings({ focalLength: Number(event.target.value) })}
            />
          </label>
          <label>
            <span><strong>光圈</strong><small>APERTURE</small></span>
            <output>ƒ/{cameraSettings.aperture.toFixed(1)}</output>
            <input
              aria-label="光圈"
              type="range"
              min="0"
              max={APERTURE_OPTIONS.length - 1}
              step="1"
              value={APERTURE_OPTIONS.findIndex((value) => value === cameraSettings.aperture)}
              onChange={(event) => updateCameraSettings({ aperture: APERTURE_OPTIONS[Number(event.target.value)] })}
            />
          </label>
          <label>
            <span><strong>快门</strong><small>SHUTTER SPEED</small></span>
            <output>{formatShutter(cameraSettings.shutterSeconds)}</output>
            <input
              aria-label="快门速度"
              type="range"
              min="0"
              max={SHUTTER_OPTIONS.length - 1}
              step="1"
              value={SHUTTER_OPTIONS.findIndex((value) => value === cameraSettings.shutterSeconds)}
              onChange={(event) => updateCameraSettings({ shutterSeconds: SHUTTER_OPTIONS[Number(event.target.value)] })}
            />
          </label>
          <label>
            <span><strong>感光度</strong><small>SENSOR ISO</small></span>
            <output>ISO {cameraSettings.iso}</output>
            <input
              aria-label="感光度 ISO"
              type="range"
              min="0"
              max={ISO_OPTIONS.length - 1}
              step="1"
              value={ISO_OPTIONS.findIndex((value) => value === cameraSettings.iso)}
              onChange={(event) => updateCameraSettings({ iso: ISO_OPTIONS[Number(event.target.value)] })}
            />
          </label>
          <label>
            <span><strong>对焦距离</strong><small>FOCUS</small></span>
            <output>{cameraSettings.focusDistance.toFixed(0)} m</output>
            <input
              aria-label="对焦距离"
              type="range"
              min="6"
              max="90"
              step="1"
              value={cameraSettings.focusDistance}
              onChange={(event) => updateCameraSettings({ focusDistance: Number(event.target.value) })}
            />
          </label>
          <label>
            <span><strong>镜头辉光</strong><small>HALATION</small></span>
            <output>{Math.round(cameraSettings.bloom * 100)}%</output>
            <input
              aria-label="镜头辉光"
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={cameraSettings.bloom}
              onChange={(event) => updateCameraSettings({ bloom: Number(event.target.value) })}
            />
          </label>
        </div>

        <div className="filter-strip">
          <span>滤镜</span>
          <div>
            {FILTERS.map((filter) => (
              <button
                type="button"
                key={filter.id}
                className={cameraSettings.filter === filter.id ? "is-selected" : ""}
                onClick={() => updateCameraSettings({ filter: filter.id })}
              >
                {filter.name}
              </button>
            ))}
          </div>
        </div>

        <div className="camera-actions">
          <button type="button" disabled={isExposing} onClick={togglePhotoPause}>
            <span aria-hidden="true">{photoPaused ? "▶" : "Ⅱ"}</span>
            {photoPaused ? "继续播放" : "暂停画面"}
          </button>
          <button type="button" disabled={isExposing} onClick={resetCamera}>
            <span aria-hidden="true">⌖</span> 重置视角
          </button>
          <button type="button" disabled={isExposing} className="capture-button" onClick={() => void capturePhoto()}>
            <span aria-hidden="true">{isExposing ? "◌" : "●"}</span>
            {isExposing ? "曝光中" : "释放快门"}
          </button>
        </div>

        <p className="camera-shortcuts">
          <span><kbd>⌘ P</kbd> 进入 / 退出</span>
          <span><kbd>ENTER</kbd> 或 <kbd>S</kbd> 快门</span>
          <span><kbd>SPACE</kbd> 暂停 / 播放</span>
          <span><kbd>R</kbd> 视角归位</span>
        </p>
      </section>

      <div
        className={`exposure-curtain ${isExposing ? "is-active" : ""}`}
        aria-hidden={!isExposing}
        style={{
          "--exposure-progress": `${exposureProgress * 100}%`,
          "--shutter-close-delay": `${Math.max(cameraSettings.shutterSeconds, 0.09)}s`,
        } as CSSProperties}
      >
        <div className="exposure-shutter-readout">
          <span><i /> EXP</span>
          <strong>{formatShutter(cameraSettings.shutterSeconds)}</strong>
          <small>保持相机稳定</small>
          <b><i /></b>
        </div>
      </div>

      {capturedPhoto && (
        <section className="photo-review" aria-label="照片回放">
          {/* A data URL from the live WebGL canvas cannot use the image optimizer. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={capturedPhoto} alt="刚刚完成曝光的花火照片" />
          <header>
            <div>
              <small>CAPTURED</small>
              <strong>{cameraSettings.focalLength.toFixed(0)} mm · ƒ/{cameraSettings.aperture.toFixed(1)} · {formatShutter(cameraSettings.shutterSeconds)} · ISO {cameraSettings.iso}</strong>
            </div>
            <button type="button" onClick={closePhotoReview} aria-label="关闭照片回放">×</button>
          </header>
          <footer>
            <button type="button" onClick={closePhotoReview}>返回取景</button>
            <button type="button" className="save-capture" onClick={saveCapturedPhoto}>保存照片</button>
          </footer>
        </section>
      )}

      <section
        className={`firework-studio ${studioOpen ? "is-open" : ""} ${mode === "draw" || mode === "effect" || mode === "show" ? "is-expanded" : ""}`}
        aria-label="烟花创作台"
      >
        <button
          type="button"
          className="studio-handle"
          onClick={() => setStudioOpen((current) => !current)}
          aria-expanded={studioOpen}
        >
          <span><i aria-hidden="true">花</i> 烟火编辑器</span>
          <b aria-hidden="true">{studioOpen ? "⌄" : "⌃"}</b>
        </button>

        <div className="studio-body">
          <div className="studio-tabs" role="tablist" aria-label="烟花类型">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "text"}
              className={mode === "text" ? "is-selected" : ""}
              onClick={() => setMode("text")}
            >
              文字
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "pattern"}
              className={mode === "pattern" ? "is-selected" : ""}
              onClick={() => setMode("pattern")}
            >
              单束
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "draw"}
              className={mode === "draw" ? "is-selected" : ""}
              onClick={() => setMode("draw")}
            >
              画板
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "effect"}
              className={mode === "effect" ? "is-selected" : ""}
              onClick={() => setMode("effect")}
            >
              效果
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "show"}
              className={mode === "show" ? "is-selected" : ""}
              onClick={() => setMode("show")}
            >
              编排
            </button>
          </div>

          {mode === "text" && (
            <div className="text-composer" role="tabpanel">
              <label htmlFor="firework-message">显示文字</label>
              <div className="message-field">
                <input
                  id="firework-message"
                  value={message}
                  maxLength={14}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") launchText(false);
                  }}
                  placeholder="输入文字"
                />
                <span>{message.length}/14</span>
              </div>
              <div className="quick-messages" aria-label="快捷文案">
                {["我喜欢你", "生日快乐", "永远在一起"].map((item) => (
                  <button type="button" key={item} onClick={() => setMessage(item)}>{item}</button>
                ))}
              </div>
            </div>
          )}

          {mode === "pattern" && (
            <div className="pattern-grid" role="tabpanel">
              {PATTERNS.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={pattern === item.id ? "is-selected" : ""}
                  onClick={() => setPattern(item.id)}
                >
                  <i aria-hidden="true">{item.mark}</i>
                  <span><strong>{item.name}</strong><small>{item.note}</small></span>
                </button>
              ))}
            </div>
          )}

          {mode === "draw" && (
            <div className="drawing-panel" role="tabpanel">
              <div className="drawing-copy">
                <span>手绘图案</span>
                <button type="button" onClick={clearDrawing}>清空</button>
              </div>
              <div className="drawing-board">
                <canvas
                  ref={drawingCanvasRef}
                  width={960}
                  height={560}
                  aria-label="手绘烟花图案画布"
                  onPointerDown={startDrawing}
                  onPointerMove={continueDrawing}
                  onPointerUp={stopDrawing}
                  onPointerCancel={stopDrawing}
                  onPointerLeave={stopDrawing}
                />
              </div>
            </div>
          )}

          {mode === "effect" && (
            <div className="effect-panel" role="tabpanel">
              <header className="effect-panel-header">
                <div>
                  <strong>发射与爆炸</strong>
                  <span>当前参数会写入新编排节点</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setTuning({ ...DEFAULT_FIREWORK_TUNING });
                    setCustomColorsEnabled(false);
                  }}
                >
                  复位
                </button>
              </header>

              <div className="effect-choice-columns">
                <section>
                  <h3>升空轨迹</h3>
                  <div className="launch-style-grid">
                    {LAUNCH_STYLES.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={tuning.launchStyle === item.id ? "is-selected" : ""}
                        onClick={() => setTuning((current) => ({ ...current, launchStyle: item.id }))}
                      >
                        <i aria-hidden="true">{item.mark}</i>
                        <span><b>{item.name}</b><small>{item.note}</small></span>
                      </button>
                    ))}
                  </div>
                </section>

                <section>
                  <h3>消散方式</h3>
                  <div className="dissipation-grid">
                    {DISSIPATIONS.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={tuning.dissipation === item.id ? "is-selected" : ""}
                        onClick={() => setTuning((current) => ({ ...current, dissipation: item.id }))}
                      >
                        <span>{item.name}</span>
                        <small>{item.note}</small>
                      </button>
                    ))}
                  </div>
                </section>
              </div>

              <div className="effect-sliders">
                {TUNING_CONTROLS.map((control) => (
                  <label key={control.id}>
                    <span><b>{control.name}</b><small>{control.note}</small></span>
                    <output>{Math.round(tuning[control.id] * 100)}%</output>
                    <input
                      type="range"
                      min={control.min}
                      max={control.max}
                      step={0.05}
                      value={tuning[control.id]}
                      onChange={(event) => setTuning((current) => ({
                        ...current,
                        [control.id]: Number(event.target.value),
                      }))}
                    />
                  </label>
                ))}
              </div>

              <div className={`custom-color-panel ${customColorsEnabled ? "is-active" : ""}`}>
                <button
                  type="button"
                  className="custom-color-toggle"
                  aria-pressed={customColorsEnabled}
                  onClick={() => setCustomColorsEnabled((current) => !current)}
                >
                  <span><b>自定义颜色</b><small>最多三色</small></span>
                  <i aria-hidden="true" />
                </button>
                <div className="custom-color-inputs" aria-hidden={!customColorsEnabled}>
                  {customColors.map((color, index) => (
                    <label key={`${index}-${color}`} style={{ "--custom-color": color } as CSSProperties}>
                      <input
                        type="color"
                        value={color}
                        disabled={!customColorsEnabled}
                        aria-label={`自定义烟花颜色 ${index + 1}`}
                        onChange={(event) => setCustomColors((current) => current.map((item, colorIndex) => (
                          colorIndex === index ? event.target.value : item
                        )) as [string, string, string])}
                      />
                      <span>{color.toUpperCase()}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {mode === "show" && (
            <div className="show-composer" role="tabpanel">
              <div className="show-add-row">
                <label>
                  <span>新增节点</span>
                  <select value={pattern} onChange={(event) => setPattern(event.target.value as FireworkPattern)}>
                    {PATTERNS.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                  </select>
                </label>
                <div className="show-palette" aria-label="新烟花配色">
                  {PALETTES.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={palette === item.id ? "is-selected" : ""}
                      onClick={() => {
                        setPalette(item.id);
                        setCustomColorsEnabled(false);
                      }}
                      aria-label={item.name}
                      style={{ background: `linear-gradient(135deg, ${item.colors.join(",")})` }}
                    />
                  ))}
                </div>
                <button type="button" className="add-cue-button" onClick={addShowCue} disabled={showCues.length >= 12}>＋ 加入</button>
              </div>

              <ol className="show-cue-list">
                {showCues.map((cue, index) => {
                  const selectedPattern = PATTERNS.find((item) => item.id === cue.pattern);
                  const selectedPalette = PALETTES.find((item) => item.id === cue.palette);
                  return (
                    <li key={cue.id}>
                      <b>{String(index + 1).padStart(2, "0")}</b>
                      <i aria-hidden="true">{selectedPattern?.mark}</i>
                      <select
                        aria-label={`第 ${index + 1} 束烟花`}
                        value={cue.pattern}
                        onChange={(event) => updateShowCue(cue.id, { pattern: event.target.value as FireworkShowCue["pattern"] })}
                      >
                        {PATTERNS.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                      </select>
                      <select
                        aria-label={`第 ${index + 1} 束配色`}
                        className="cue-palette-select"
                        value={cue.palette}
                        onChange={(event) => updateShowCue(cue.id, { palette: event.target.value as PaletteName })}
                        style={{ borderColor: selectedPalette?.colors[0] }}
                      >
                        {PALETTES.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
                      </select>
                      <select
                        aria-label={`第 ${index + 1} 束间隔`}
                        value={cue.delay}
                        onChange={(event) => updateShowCue(cue.id, { delay: Number(event.target.value) })}
                      >
                        {SHOW_DELAYS.map((delay) => <option value={delay} key={delay}>{delay.toFixed(1)}s</option>)}
                      </select>
                      <span className="cue-order-actions">
                        <button
                          type="button"
                          onClick={() => updateShowCue(cue.id, {
                            tuning: { ...tuning },
                            colors: customColorsEnabled ? [...customColors] : undefined,
                          })}
                          aria-label="应用当前效果"
                          title="应用当前效果"
                        >
                          ✦
                        </button>
                        <button type="button" onClick={() => moveShowCue(index, -1)} disabled={index === 0} aria-label="上移">↑</button>
                        <button type="button" onClick={() => moveShowCue(index, 1)} disabled={index === showCues.length - 1} aria-label="下移">↓</button>
                        <button type="button" onClick={() => removeShowCue(cue.id)} aria-label="移除">×</button>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </div>
          )}

          {mode !== "show" ? (
            <div className="studio-footer">
              <div className={`palette-picker ${customColorsEnabled ? "is-muted" : ""}`} aria-label="烟花配色">
                {PALETTES.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={palette === item.id ? "is-selected" : ""}
                    aria-label={item.name}
                    title={item.name}
                    onClick={() => {
                      setPalette(item.id);
                      setCustomColorsEnabled(false);
                    }}
                  >
                    {item.colors.map((color) => <i key={color} style={{ background: color }} />)}
                  </button>
                ))}
              </div>
              <button type="button" className="launch-button" onClick={launchCurrent}>
                <span>{mode === "effect" ? "试放" : "发射"}</span><i aria-hidden="true">↗</i>
              </button>
            </div>
          ) : (
            <div className="show-footer">
              <button type="button" className="clear-show-button" onClick={() => setShowCues([])}>清空</button>
              <button type="button" className="launch-button" onClick={playShow} disabled={!showCues.length}>
                <span>播放编排</span><i aria-hidden="true">▶</i>
              </button>
            </div>
          )}

          {mode === "text" && (
            <button type="button" className="finale-button" onClick={() => launchText(true)}>
              <span aria-hidden="true">✦</span>
              播放文字编排
              <i aria-hidden="true">7 s</i>
            </button>
          )}
        </div>
      </section>

      <p className="sr-only" aria-live="polite">{status}</p>
    </main>
  );
}
