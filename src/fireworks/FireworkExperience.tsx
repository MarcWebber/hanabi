"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  FireworkScene,
  type FireworkPattern,
  type PaletteName,
  type PatternPoint,
} from "./FireworkScene";

const PATTERNS: Array<{ id: FireworkPattern; name: string; note: string; mark: string }> = [
  { id: "peony", name: "星河牡丹", note: "层层绽放", mark: "✺" },
  { id: "chrysanthemum", name: "极光千轮", note: "细密长尾", mark: "✹" },
  { id: "heart", name: "心动时刻", note: "爱心定格", mark: "♥" },
  { id: "saturn", name: "环游星球", note: "双环焰火", mark: "◎" },
  { id: "willow", name: "金色垂柳", note: "坠入湖面", mark: "⌇" },
  { id: "star", name: "摘一颗星", note: "星形留影", mark: "★" },
];

const PALETTES: Array<{ id: PaletteName; name: string; colors: string[] }> = [
  { id: "love", name: "心动玫瑰", colors: ["#ff4d9d", "#ff9aca", "#fff4f8"] },
  { id: "aurora", name: "薄荷极光", colors: ["#36f1ca", "#6aa8ff", "#c379ff"] },
  { id: "gold", name: "鎏金月色", colors: ["#ffad2f", "#ffe7a7", "#fff9dc"] },
  { id: "dream", name: "银河幻梦", colors: ["#705cff", "#26d6ff", "#ff4ddd"] },
];

type StudioMode = "text" | "pattern" | "draw";

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
  context.lineWidth = 16;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  const points = Array.from({ length: 160 }, (_, index) => {
    const t = (index / 159) * Math.PI * 2;
    return {
      x: canvas.width / 2 + Math.pow(Math.sin(t), 3) * 104,
      y:
        canvas.height / 2 -
        ((13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) /
          16) *
          94,
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
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const isDrawingRef = useRef(false);
  const lastDrawPointRef = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);
  const [studioOpen, setStudioOpen] = useState(true);
  const [mode, setMode] = useState<StudioMode>("text");
  const [message, setMessage] = useState("今晚也很喜欢你");
  const [pattern, setPattern] = useState<FireworkPattern>("heart");
  const [palette, setPalette] = useState<PaletteName>("love");
  const [sound, setSound] = useState(false);
  const [autoPlay, setAutoPlay] = useState(true);
  const [status, setStatus] = useState("烟火正在为你们升空");

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const scene = new FireworkScene(viewport, () => setReady(true));
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = drawingCanvasRef.current;
    if (canvas) drawStarterHeart(canvas);
  }, []);

  const announce = useCallback((nextStatus: string) => {
    setStatus(nextStatus);
    window.setTimeout(() => setStatus("点击夜空，也能亲手放一束烟花"), 2400);
  }, []);

  const launchText = useCallback(
    (finale = false) => {
      const cleanMessage = message.trim().slice(0, 14) || "我喜欢你";
      const points = sampleText(cleanMessage);
      if (finale) {
        sceneRef.current?.launchFinale(points, palette);
        announce(`整片夜空，正在写下「${cleanMessage}」`);
      } else {
        sceneRef.current?.launch({
          pattern: "text",
          palette,
          points,
          x: 0,
          y: 14.5,
          z: -22,
        });
        announce(`「${cleanMessage}」已经飞向夜空`);
      }
    },
    [announce, message, palette],
  );

  const launchSelectedPattern = useCallback(() => {
    sceneRef.current?.launch({ pattern, palette });
    const selected = PATTERNS.find((item) => item.id === pattern);
    announce(`${selected?.name ?? "烟花"}，为你们绽放`);
  }, [announce, palette, pattern]);

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
    });
    announce("你画下的形状，正在变成烟花");
  }, [announce, palette]);

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
    context.lineWidth = 15;
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
      className={`firework-shell ${ready ? "is-ready" : ""}`}
      data-testid="firework-night"
    >
      <div
        ref={viewportRef}
        className="firework-viewport"
        onPointerDown={handleSkyPointerDown}
        onPointerUp={handleSkyPointerUp}
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
          <button type="button" className={sound ? "is-active" : ""} onClick={toggleSound}>
            <span aria-hidden="true">{sound ? "♪" : "♩"}</span>
            {sound ? "有声" : "静音"}
          </button>
          <button type="button" className={autoPlay ? "is-active" : ""} onClick={toggleAutoPlay}>
            <span aria-hidden="true">∞</span>
            {autoPlay ? "自动" : "手动"}
          </button>
          <button type="button" onClick={toggleFullscreen}>
            <span aria-hidden="true">⌗</span>
            沉浸
          </button>
        </div>
      </header>

      <div className="seat-status" aria-label="双人观景状态">
        <span className="seat-avatars" aria-hidden="true"><i /> <i /></span>
        <span><strong>两个人，已入座</strong><small>LAKESIDE SEAT · 02</small></span>
      </div>

      <div className="sky-hint">
        <span aria-hidden="true">＋</span>
        点击夜空放一束烟花 · 拖动可以环顾四周
      </div>

      <section className={`firework-studio ${studioOpen ? "is-open" : ""}`} aria-label="烟花创作台">
        <button
          type="button"
          className="studio-handle"
          onClick={() => setStudioOpen((current) => !current)}
          aria-expanded={studioOpen}
        >
          <span><i aria-hidden="true">✦</i> 烟花创作台</span>
          <strong>{studioOpen ? "收起" : "为她写一束烟花"}</strong>
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
              <span>01</span> 写一句话
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "pattern"}
              className={mode === "pattern" ? "is-selected" : ""}
              onClick={() => setMode("pattern")}
            >
              <span>02</span> 选一束光
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "draw"}
              className={mode === "draw" ? "is-selected" : ""}
              onClick={() => setMode("draw")}
            >
              <span>03</span> 画个图案
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
                <span>在这里画下任何形状</span>
                <small>线条会变成悬停在夜空里的粒子</small>
              </div>
              <div className="drawing-board">
                <canvas
                  ref={drawingCanvasRef}
                  width={520}
                  height={220}
                  aria-label="手绘烟花图案画布"
                  onPointerDown={startDrawing}
                  onPointerMove={continueDrawing}
                  onPointerUp={stopDrawing}
                  onPointerCancel={stopDrawing}
                  onPointerLeave={stopDrawing}
                />
                <button type="button" onClick={clearDrawing}>清空重画</button>
              </div>
            </div>
          )}

          <div className="studio-footer">
            <div className="palette-picker" aria-label="烟花配色">
              {PALETTES.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={palette === item.id ? "is-selected" : ""}
                  aria-label={item.name}
                  title={item.name}
                  onClick={() => setPalette(item.id)}
                >
                  {item.colors.map((color) => <i key={color} style={{ background: color }} />)}
                </button>
              ))}
            </div>
            <button type="button" className="launch-button" onClick={launchCurrent}>
              <span>点亮夜空</span><i aria-hidden="true">↗</i>
            </button>
          </div>

          {mode === "text" && (
            <button type="button" className="finale-button" onClick={() => launchText(true)}>
              <span aria-hidden="true">✦</span>
              用这句话，放一场完整烟花秀
              <i aria-hidden="true">7 秒</i>
            </button>
          )}
        </div>
      </section>

      <p className="live-status" aria-live="polite">{status}</p>

      <footer className="scene-footer">
        <p><span>REALTIME THREE.JS</span><span>PROCEDURAL FIREWORKS</span><span>TWO SEATS</span></p>
        <p>为两个刚好遇见的人 · MADE UNDER THE STARS</p>
      </footer>
    </main>
  );
}
