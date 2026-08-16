"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FireworkScene,
} from "./FireworkScene";
import {
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
  type WorldPreset,
} from "./types";

const PATTERNS: Array<{ id: FireworkPattern; name: string; note: string; mark: string }> = [
  { id: "peony", name: "星河牡丹", note: "层层绽放", mark: "✺" },
  { id: "chrysanthemum", name: "极光千轮", note: "细密长尾", mark: "✹" },
  { id: "heart", name: "心动时刻", note: "爱心定格", mark: "♥" },
  { id: "saturn", name: "环游星球", note: "双环焰火", mark: "◎" },
  { id: "willow", name: "金色垂柳", note: "坠入湖面", mark: "⌇" },
  { id: "star", name: "摘一颗星", note: "星形留影", mark: "★" },
  { id: "spiral", name: "三旋星涡", note: "旋臂展开", mark: "◌" },
  { id: "butterfly", name: "流光蝶翼", note: "双翼定格", mark: "⋈" },
  { id: "palm", name: "鎏金棕榈", note: "长枝垂落", mark: "Ψ" },
  { id: "crown", name: "星光王冠", note: "冠冕成形", mark: "♕" },
  { id: "double-ring", name: "双轨星环", note: "交错双环", mark: "⊚" },
  { id: "meteor", name: "九曜流星", note: "长轨疾驰", mark: "彡" },
];

const PALETTES: Array<{ id: PaletteName; name: string; colors: string[] }> = [
  { id: "love", name: "心动玫瑰", colors: ["#ff4d9d", "#ff9aca", "#fff4f8"] },
  { id: "aurora", name: "薄荷极光", colors: ["#36f1ca", "#6aa8ff", "#c379ff"] },
  { id: "gold", name: "鎏金月色", colors: ["#ffad2f", "#ffe7a7", "#fff9dc"] },
  { id: "dream", name: "银河幻梦", colors: ["#705cff", "#26d6ff", "#ff4ddd"] },
];

type StudioMode = "text" | "pattern" | "draw" | "effect" | "show";

type NumericTuningKey = "power" | "spread" | "lifetime" | "trail";

const LAUNCH_STYLES: Array<{ id: FireworkLaunchStyle; name: string; note: string; mark: string }> = [
  { id: "classic", name: "经典升空", note: "干净直线", mark: "↑" },
  { id: "comet", name: "彗星长尾", note: "长轨慢升", mark: "↗" },
  { id: "spiral", name: "螺旋升空", note: "盘旋入夜", mark: "↻" },
  { id: "twin", name: "双星齐发", note: "双束呼应", mark: "⇈" },
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

const WORLDS: Array<{
  id: WorldPreset;
  name: string;
  note: string;
  mark: string;
}> = [
  { id: "magic-city", name: "星月王城", note: "红瓦、风车与魔法教堂", mark: "♜" },
  { id: "cloud-citadel", name: "云海浮城", note: "浮岛、空桥与巡游飞艇", mark: "☁" },
  { id: "snow-belltower", name: "雪夜钟楼", note: "积雪古镇与暖窗钟声", mark: "❄" },
  { id: "enchanted-ruins", name: "精灵森林", note: "古树、月门与荧光遗迹", mark: "♧" },
  { id: "moonlit-harbor", name: "月湾灯塔港", note: "灯塔、帆船与海港灯火", mark: "♢" },
];

const ENVIRONMENTS: Array<{
  id: EnvironmentPreset;
  name: string;
  note: string;
  mark: string;
}> = [
  { id: "moon-castle", name: "星月浮灯", note: "蓝调月夜", mark: "☾" },
  { id: "rose-garden", name: "蔷薇庆典", note: "暖粉花瓣", mark: "✿" },
  { id: "cloud-observatory", name: "秘法星潮", note: "青蓝星环", mark: "◌" },
];

const DEFAULT_SHOW: ShowCue[] = [
  { id: 1, pattern: "peony", palette: "aurora", delay: 0.4 },
  { id: 2, pattern: "spiral", palette: "dream", delay: 0.8 },
  { id: 3, pattern: "heart", palette: "love", delay: 0.9 },
  { id: 4, pattern: "willow", palette: "gold", delay: 1.1 },
  { id: 5, pattern: "butterfly", palette: "love", delay: 0.8 },
];

const SHOW_DELAYS = [0.4, 0.7, 1, 1.4, 2];

const SHUTTER_OPTIONS = [1 / 15, 1 / 30, 1 / 60, 1 / 125, 1 / 250, 1 / 500];
const ISO_OPTIONS = [100, 200, 320, 400, 800, 1600];

const CAMERA_PRESETS: Array<{ name: string; note: string; settings: CameraSettings }> = [
  {
    name: "夜景清透",
    note: "颜色分明",
    settings: { ...DEFAULT_CAMERA_SETTINGS, focalLength: 28, aperture: 4, iso: 320, bloom: 0.3, filter: "neutral" },
  },
  {
    name: "电影柔光",
    note: "柔和景深",
    settings: { ...DEFAULT_CAMERA_SETTINGS, focalLength: 35, aperture: 2, iso: 400, bloom: 0.46, filter: "cinema" },
  },
  {
    name: "玫瑰胶片",
    note: "暖粉肤色",
    settings: { ...DEFAULT_CAMERA_SETTINGS, focalLength: 50, aperture: 1.8, iso: 320, bloom: 0.38, filter: "rose" },
  },
  {
    name: "冷月长焦",
    note: "压缩远景",
    settings: { ...DEFAULT_CAMERA_SETTINGS, focalLength: 70, aperture: 4.5, iso: 800, bloom: 0.24, filter: "moonlight" },
  },
];

const FILTERS: Array<{ id: CameraFilter; name: string }> = [
  { id: "neutral", name: "自然" },
  { id: "cinema", name: "电影" },
  { id: "rose", name: "玫瑰" },
  { id: "moonlight", name: "冷月" },
];

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
  const [ready, setReady] = useState(false);
  const [studioOpen, setStudioOpen] = useState(true);
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
  const [cameraSettings, setCameraSettings] = useState<CameraSettings>({ ...DEFAULT_CAMERA_SETTINGS });
  const [world, setWorld] = useState<WorldPreset>("magic-city");
  const [environment, setEnvironment] = useState<EnvironmentPreset>("moon-castle");
  const [activePopover, setActivePopover] = useState<"scene" | "music" | null>(null);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicVolume, setMusicVolume] = useState(0.34);
  const [musicName, setMusicName] = useState("降 E 大调夜曲");
  const [showCues, setShowCues] = useState<ShowCue[]>(DEFAULT_SHOW);
  const [status, setStatus] = useState("烟火正在为你们升空");

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scene = new FireworkScene(viewport, () => setReady(true));
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
      if (uploadedMusicUrlRef.current) URL.revokeObjectURL(uploadedMusicUrlRef.current);
    };
  }, []);

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
    sceneRef.current?.setWorld(world);
  }, [world]);

  useEffect(() => {
    sceneRef.current?.setEnvironment(environment);
  }, [environment]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = musicVolume;
  }, [musicVolume]);

  const announce = useCallback((nextStatus: string) => {
    setStatus(nextStatus);
    window.setTimeout(() => setStatus("点击夜空，也能亲手放一束烟花"), 2400);
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
      setPhotoMode(active);
      setPhotoPaused(active);
      sceneRef.current?.setPaused(active);
      announce(active ? "摄像模式已开启，时间停在这一帧" : "已经回到实时烟花夜");
    },
    [announce],
  );

  const togglePhotoMode = useCallback(() => {
    setPhotoModeActive(!photoMode);
  }, [photoMode, setPhotoModeActive]);

  const togglePhotoPause = useCallback(() => {
    const next = !photoPaused;
    setPhotoPaused(next);
    sceneRef.current?.setPaused(next);
    announce(next ? "画面已暂停，可以慢慢调参数" : "烟花重新开始流动");
  }, [announce, photoPaused]);

  const resetCamera = useCallback(() => {
    sceneRef.current?.resetView();
    announce("视角已回到双人座位");
  }, [announce]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        setPhotoModeActive(!photoMode);
        return;
      }
      if (!photoMode) return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, select, textarea")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePhotoPause();
      } else if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        resetCamera();
      } else if (event.key === "Escape") {
        setPhotoModeActive(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [photoMode, resetCamera, setPhotoModeActive, togglePhotoPause]);

  const launchText = useCallback(
    (finale = false) => {
      const cleanMessage = message.trim().slice(0, 14) || "我喜欢你";
      const points = sampleText(cleanMessage);
      if (finale) {
        sceneRef.current?.launchFinale(points, palette, effectOptions());
        announce(`整片夜空，正在写下「${cleanMessage}」`);
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
        announce(`「${cleanMessage}」已经飞向夜空`);
      }
    },
    [announce, effectOptions, message, palette],
  );

  const launchSelectedPattern = useCallback(() => {
    sceneRef.current?.launch({ pattern, palette, ...effectOptions() });
    const selected = PATTERNS.find((item) => item.id === pattern);
    announce(`${selected?.name ?? "烟花"}，为你们绽放`);
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
    announce("你画下的形状，正在变成烟花");
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
    announce(next ? "声音已开启，今晚更有临场感" : "已切回安静观赏");
  };

  const toggleAutoPlay = () => {
    const next = !autoPlay;
    setAutoPlay(next);
    sceneRef.current?.setAutoPlay(next);
    announce(next ? "烟花会继续自动绽放" : "夜空交给你亲手点亮");
  };

  const chooseEnvironment = (next: EnvironmentPreset, name: string) => {
    setEnvironment(next);
    sceneRef.current?.setEnvironment(next);
    announce(`夜色已经换成${name}`);
  };

  const chooseWorld = (next: WorldPreset, name: string) => {
    setWorld(next);
    sceneRef.current?.setWorld(next);
    announce(`已经来到${name}`);
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

  const useBuiltInMusic = async () => {
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

  const useLocalMusic = async (file?: File) => {
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
    announce(`属于你们的 ${showCues.length} 幕烟花秀开始了`);
  };

  const updateCameraSettings = (patch: Partial<CameraSettings>) => {
    setCameraSettings((current) => ({ ...current, ...patch }));
  };

  const applyCameraPreset = (settings: CameraSettings, name: string) => {
    setCameraSettings({ ...settings });
    announce(`已切换到「${name}」镜头预设`);
  };

  const capturePhoto = () => {
    const image = sceneRef.current?.captureFrame();
    if (!image) return;
    const link = document.createElement("a");
    link.href = image;
    link.download = `our-firework-night-${Date.now()}.png`;
    link.click();
    announce("这一帧已经保存下来");
  };

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
    announce("这一束，落在你点中的位置");
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
      className={`firework-shell ${ready ? "is-ready" : ""} ${photoMode ? "is-photo-mode" : ""}`}
      data-testid="firework-night"
    >
      <div
        ref={viewportRef}
        className="firework-viewport"
        onPointerDown={handleSkyPointerDown}
        onPointerUp={handleSkyPointerUp}
      />
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
        <span />
        <p>正在点亮今晚的星星</p>
      </div>

      <header className="topbar">
        <div className="brand-lockup">
          <p className="eyebrow"><span>✦</span> OUR LITTLE UNIVERSE · 2026</p>
          <h1>只属于我们的烟火</h1>
          <p className="subtitle">坐近一点，今晚的星光会记得我们。</p>
        </div>

        <div className="utility-actions" aria-label="观景设置">
          <button
            type="button"
            className={activePopover === "scene" ? "is-active" : ""}
            onClick={() => setActivePopover((current) => (current === "scene" ? null : "scene"))}
          >
            <span aria-hidden="true">♜</span>
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
            连放
          </button>
          <button type="button" className={photoMode ? "is-active" : ""} onClick={togglePhotoMode}>
            <span aria-hidden="true">◉</span>
            摄像
          </button>
          <button type="button" onClick={toggleFullscreen}>
            <span aria-hidden="true">⌗</span>
            沉浸
          </button>
        </div>
      </header>

      <section className={`experience-popover scene-popover ${activePopover === "scene" ? "is-open" : ""}`} aria-label="场景选择">
        <header>
          <div><small>此刻所在</small><strong>{WORLDS.find((item) => item.id === world)?.name}</strong></div>
          <button type="button" onClick={() => setActivePopover(null)} aria-label="关闭">×</button>
        </header>
        <div className="scene-section-title"><span>观景地点</span><small>5 个实时地图</small></div>
        <div className="world-options">
          {WORLDS.map((item) => (
            <button
              type="button"
              key={item.id}
              className={world === item.id ? "is-selected" : ""}
              onClick={() => chooseWorld(item.id, item.name)}
            >
              <i aria-hidden="true">{item.mark}</i>
              <span><strong>{item.name}</strong><small>{item.note}</small></span>
            </button>
          ))}
        </div>
        <div className="scene-section-title"><span>节庆氛围</span><small>可叠加到任意地图</small></div>
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
          <div><small>正在播放</small><strong>{musicName}</strong></div>
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
          <button type="button" onClick={() => void useBuiltInMusic()}>肖邦夜曲</button>
          <label>
            选择本地音乐
            <input type="file" accept="audio/*" onChange={(event) => void useLocalMusic(event.target.files?.[0])} />
          </label>
        </div>
      </section>

      <div className="photo-mode-indicator" aria-hidden={!photoMode}>
        <span className={photoPaused ? "is-paused" : ""} />
        <strong>摄像模式</strong>
        <small>{photoPaused ? "画面暂停" : "实时"}</small>
      </div>

      <section className={`camera-console ${photoMode ? "is-open" : ""}`} aria-label="专业摄像参数">
        <header className="camera-console-header">
          <div>
            <p>PRO CAMERA / 眼睛视角</p>
            <h2>专业摄像台</h2>
          </div>
          <button type="button" onClick={() => setPhotoModeActive(false)} aria-label="退出摄像模式">×</button>
        </header>

        <div className="camera-readout" aria-label="当前曝光参数">
          <span><small>LENS</small><strong>{cameraSettings.focalLength.toFixed(0)}<i>mm</i></strong></span>
          <span><small>IRIS</small><strong>ƒ/{cameraSettings.aperture.toFixed(1)}</strong></span>
          <span><small>SHUTTER</small><strong>1/{Math.round(1 / cameraSettings.shutterSeconds)}</strong></span>
          <span><small>SENSOR</small><strong>ISO {cameraSettings.iso}</strong></span>
        </div>

        <div className="camera-presets" aria-label="摄像预设">
          {CAMERA_PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.name}
              onClick={() => applyCameraPreset(preset.settings, preset.name)}
            >
              <strong>{preset.name}</strong><small>{preset.note}</small>
            </button>
          ))}
        </div>

        <div className="camera-controls">
          <label>
            <span><strong>焦段</strong><small>FOCAL LENGTH</small></span>
            <output>{cameraSettings.focalLength.toFixed(0)} mm</output>
            <input
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
              type="range"
              min="1.4"
              max="16"
              step="0.1"
              value={cameraSettings.aperture}
              onChange={(event) => updateCameraSettings({ aperture: Number(event.target.value) })}
            />
          </label>
          <label>
            <span><strong>快门</strong><small>SHUTTER SPEED</small></span>
            <output>1/{Math.round(1 / cameraSettings.shutterSeconds)} s</output>
            <input
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
              type="range"
              min="6"
              max="70"
              step="1"
              value={cameraSettings.focusDistance}
              onChange={(event) => updateCameraSettings({ focusDistance: Number(event.target.value) })}
            />
          </label>
          <label>
            <span><strong>镜头辉光</strong><small>HALATION</small></span>
            <output>{Math.round(cameraSettings.bloom * 100)}%</output>
            <input
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
          <span>FILTER / 滤镜</span>
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
          <button type="button" onClick={togglePhotoPause}>
            <span aria-hidden="true">{photoPaused ? "▶" : "Ⅱ"}</span>
            {photoPaused ? "继续播放" : "暂停画面"}
          </button>
          <button type="button" onClick={resetCamera}>
            <span aria-hidden="true">⌖</span> 重置视角
          </button>
          <button type="button" className="capture-button" onClick={capturePhoto}>
            <span aria-hidden="true">●</span> 保存照片
          </button>
        </div>

        <p className="camera-shortcuts">
          <span><kbd>⌘ P</kbd> 进入 / 退出</span>
          <span><kbd>SPACE</kbd> 暂停 / 播放</span>
          <span><kbd>R</kbd> 视角归位</span>
        </p>
      </section>

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
          <span><i aria-hidden="true">✦</i> 烟花工坊</span>
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
              烟花组
            </button>
          </div>

          {mode === "text" && (
            <div className="text-composer" role="tabpanel">
              <label htmlFor="firework-message">想让夜空替你说什么？</label>
              <div className="message-field">
                <input
                  id="firework-message"
                  value={message}
                  maxLength={14}
                  onChange={(event) => setMessage(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") launchText(false);
                  }}
                  placeholder="输入只属于她的话"
                />
                <span>{message.length}/14</span>
              </div>
              <div className="quick-messages" aria-label="快捷文案">
                {["我喜欢你", "永远在一起", "今晚只看你"].map((item) => (
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
                <span>自由画板</span>
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
                  <strong>烟花动力学</strong>
                  <span>这些参数会应用到手动烟花，也会随新加入的烟花组保存</span>
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
                  <span><b>自定义三色焰心</b><small>关闭时沿用主题配色</small></span>
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
                  <span>烟花 · 当前效果会随这一幕保存</span>
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
                <span>{mode === "effect" ? "试放当前效果" : "点亮夜空"}</span><i aria-hidden="true">↗</i>
              </button>
            </div>
          ) : (
            <div className="show-footer">
              <button type="button" className="clear-show-button" onClick={() => setShowCues([])}>清空</button>
              <button type="button" className="launch-button" onClick={playShow} disabled={!showCues.length}>
                <span>播放烟花组</span><i aria-hidden="true">▶</i>
              </button>
            </div>
          )}

          {mode === "text" && (
            <button type="button" className="finale-button" onClick={() => launchText(true)}>
              <span aria-hidden="true">✦</span>
              用这句话，放一场完整烟花秀
              <i aria-hidden="true">7 秒</i>
            </button>
          )}
        </div>
      </section>

      <p className="sr-only" aria-live="polite">{status}</p>
    </main>
  );
}
