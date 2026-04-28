import { Player } from "@remotion/player";
import { DEMO_DURATION_IN_FRAMES, DEMO_FPS, DEMO_HEIGHT, DEMO_WIDTH } from "./demoConfig";
import { NoteforgeDemo } from "./NoteforgeDemo";

export function DemoPlayer() {
  return (
    <Player
      allowFullscreen
      autoPlay
      clickToPlay
      component={NoteforgeDemo}
      compositionHeight={DEMO_HEIGHT}
      compositionWidth={DEMO_WIDTH}
      controls
      durationInFrames={DEMO_DURATION_IN_FRAMES}
      fps={DEMO_FPS}
      initiallyMuted
      loop
      showVolumeControls={false}
      style={{
        aspectRatio: `${DEMO_WIDTH} / ${DEMO_HEIGHT}`,
        width: "100%",
      }}
    />
  );
}
