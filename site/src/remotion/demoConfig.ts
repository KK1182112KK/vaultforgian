export const DEMO_FPS = 30;
export const DEMO_SECONDS = 98;
export const DEMO_DURATION_IN_FRAMES = DEMO_SECONDS * DEMO_FPS;
export const DEMO_WIDTH = 1920;
export const DEMO_HEIGHT = 1080;
export const DEMO_RECORDING_FILE = "demo/obsidian-noteforge-demo.mp4";
export const DEMO_RECORDING_PUBLIC_PATH = `/${DEMO_RECORDING_FILE}`;

export type DemoChapter = {
  label: string;
  start: number;
  end: number;
  caption: string;
  highlight: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
};

export const DEMO_CHAPTERS: readonly DemoChapter[] = [
  {
    label: "Ask",
    start: 0,
    end: 14,
    caption: "A short, natural request starts a new Pythagorean Theorem study note.",
    highlight: { left: 80, top: 128, width: 1760, height: 824 },
  },
  {
    label: "Draft",
    start: 14,
    end: 36,
    caption: "Codex drafts the beginner note around one simple 3-4-5 triangle example.",
    highlight: { left: 540, top: 134, width: 1300, height: 560 },
  },
  {
    label: "Patch",
    start: 36,
    end: 64,
    caption: "The new note is proposed as a visible file change before it touches the vault.",
    highlight: { left: 540, top: 390, width: 1300, height: 570 },
  },
  {
    label: "Approve",
    start: 64,
    end: 80,
    caption: "The student approves the write from the plugin surface.",
    highlight: { left: 1120, top: 650, width: 700, height: 280 },
  },
  {
    label: "New note",
    start: 80,
    end: DEMO_SECONDS,
    caption: "The finished study note lives in Obsidian after approval.",
    highlight: { left: 80, top: 128, width: 1760, height: 824 },
  },
];
