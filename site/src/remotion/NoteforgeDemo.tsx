import { Video } from "@remotion/media";
import { AbsoluteFill, Easing, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { DEMO_CHAPTERS, DEMO_RECORDING_FILE } from "./demoConfig";

const clamp = {
  extrapolateLeft: "clamp" as const,
  extrapolateRight: "clamp" as const,
};

function findActiveChapter(second: number) {
  return DEMO_CHAPTERS.find((chapter) => second >= chapter.start && second < chapter.end) ?? DEMO_CHAPTERS[DEMO_CHAPTERS.length - 1];
}

function eased(frame: number, start: number, duration: number) {
  return interpolate(frame, [start, start + duration], [0, 1], {
    ...clamp,
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
}

export function NoteforgeDemo() {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();
  const second = frame / fps;
  const chapter = findActiveChapter(second);
  const chapterStartFrame = chapter.start * fps;
  const chapterEndFrame = chapter.end * fps;
  const chapterEnter = eased(frame, chapterStartFrame, 16);
  const chapterExit = interpolate(frame, [chapterEndFrame - 14, chapterEndFrame], [1, 0], clamp);
  const overlayOpacity = Math.min(chapterEnter, chapterExit);
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], clamp);
  const highlightScale = interpolate(overlayOpacity, [0, 1], [0.985, 1], clamp);

  return (
    <AbsoluteFill
      style={{
        background: "#0b1020",
        color: "#ffffff",
        fontFamily: "Aptos, Segoe UI, Inter, sans-serif",
        overflow: "hidden",
      }}
    >
      <Video
        muted
        src={staticFile(DEMO_RECORDING_FILE)}
        style={{
          background: "#070817",
          height: "100%",
          objectFit: "contain",
          width: "100%",
        }}
      />

      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(7, 13, 28, 0.76) 0%, rgba(7, 13, 28, 0.12) 28%, rgba(7, 13, 28, 0.1) 62%, rgba(7, 13, 28, 0.82) 100%)",
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          alignItems: "center",
          display: "flex",
          gap: 16,
          left: 70,
          position: "absolute",
          right: 70,
          top: 56,
        }}
      >
        {DEMO_CHAPTERS.map((item) => {
          const active = item.label === chapter.label;
          const complete = second >= item.end;
          return (
            <div
              key={item.label}
              style={{
                background: active ? "#ffffff" : complete ? "rgba(119, 255, 205, 0.2)" : "rgba(255, 255, 255, 0.12)",
                border: `2px solid ${active ? "#ffffff" : complete ? "rgba(119, 255, 205, 0.52)" : "rgba(255, 255, 255, 0.18)"}`,
                borderRadius: 999,
                color: active ? "#111a2f" : complete ? "#b8ffe9" : "rgba(255, 255, 255, 0.72)",
                fontSize: 22,
                fontWeight: 900,
                padding: "14px 22px",
              }}
            >
              {item.label}
            </div>
          );
        })}
      </div>

      <div
        style={{
          border: "5px solid rgba(119, 255, 205, 0.94)",
          borderRadius: 26,
          boxShadow: "0 0 0 9999px rgba(7, 13, 28, 0.24), 0 0 42px rgba(119, 255, 205, 0.44)",
          height: chapter.highlight.height,
          left: chapter.highlight.left,
          opacity: overlayOpacity,
          position: "absolute",
          top: chapter.highlight.top,
          transform: `scale(${highlightScale})`,
          transformOrigin: "center",
          width: chapter.highlight.width,
        }}
      />

      <div
        style={{
          background: "rgba(10, 17, 35, 0.86)",
          border: "2px solid rgba(255, 255, 255, 0.16)",
          borderRadius: 30,
          bottom: 78,
          boxShadow: "0 24px 70px rgba(0, 0, 0, 0.28)",
          left: 70,
          opacity: overlayOpacity,
          padding: "26px 32px",
          position: "absolute",
          right: 70,
          transform: `translateY(${interpolate(overlayOpacity, [0, 1], [22, 0], clamp)}px)`,
        }}
      >
        <div style={{ color: "#77ffcd", fontSize: 24, fontWeight: 900, letterSpacing: 2, textTransform: "uppercase" }}>
          Live Obsidian demo / {chapter.label}
        </div>
        <div style={{ fontSize: 42, fontWeight: 900, lineHeight: 1.18, marginTop: 10 }}>{chapter.caption}</div>
      </div>

      <div
        style={{
          background: "rgba(255,255,255,0.16)",
          borderRadius: 999,
          bottom: 36,
          height: 10,
          left: 70,
          overflow: "hidden",
          position: "absolute",
          right: 70,
        }}
      >
        <div
          style={{
            background: "linear-gradient(90deg, #77ffcd, #a080ff, #ffd166)",
            height: "100%",
            width: `${progress * 100}%`,
          }}
        />
      </div>
    </AbsoluteFill>
  );
}
