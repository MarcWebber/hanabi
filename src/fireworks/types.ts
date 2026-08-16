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

export type FireworkLaunchStyle = "classic" | "comet" | "spiral" | "twin";

export type FireworkDissipation = "soft" | "glitter" | "embers" | "strobe";

export type FireworkTuning = {
  power: number;
  spread: number;
  lifetime: number;
  trail: number;
  launchStyle: FireworkLaunchStyle;
  dissipation: FireworkDissipation;
};

export const DEFAULT_FIREWORK_TUNING: FireworkTuning = {
  power: 1,
  spread: 1,
  lifetime: 1,
  trail: 1,
  launchStyle: "classic",
  dissipation: "soft",
};

export type FireworkShowCue = {
  pattern: Exclude<FireworkPattern, "text" | "custom">;
  palette: PaletteName;
  delay: number;
  tuning?: FireworkTuning;
  colors?: string[];
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
  aperture: 4,
  shutterSeconds: 1 / 60,
  iso: 320,
  focusDistance: 24,
  bloom: 0.24,
  filter: "cinema",
};

export type PatternPoint = {
  x: number;
  y: number;
};

export type LaunchOptions = {
  pattern: FireworkPattern;
  palette?: PaletteName;
  colors?: string[];
  tuning?: Partial<FireworkTuning>;
  points?: PatternPoint[];
  label?: string;
  x?: number;
  y?: number;
  z?: number;
  silent?: boolean;
};
