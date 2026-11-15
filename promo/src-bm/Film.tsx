import {
  AbsoluteFill,
  Audio,
  Sequence,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  Easing,
} from 'remotion';
import { Cam } from './Cam';
import { C, Caption, Counter, Flash, MONO, SANS, TitleCard } from './Bits';

/**
 * BoardMaster — product film, 1920x1080 @ 30fps.
 *
 * Energy shape: brand open (low) -> three feature blocks alternating with
 * title-card breathing beats (mid/high) -> outro assembled to the film's peak.
 * Both wordmark moments hold a full second after they land.
 *
 * Every product frame is a real screenshot of the running app, captured by
 * scratchpad/capture-bm.mjs against localhost with the real deterministic
 * engine. Nothing in this film is a mock-up, and no number on screen was typed
 * by hand — which is the same claim the product itself makes.
 */

const T = 'textures/bm';

export const SHOTS = {
  open: { from: 0, dur: 150 },
  card1: { from: 150, dur: 58 },
  bench: { from: 208, dur: 232 },
  card2: { from: 440, dur: 58 },
  code: { from: 498, dur: 196 },
  card3: { from: 694, dur: 58 },
  proof: { from: 752, dur: 170 },
  card4: { from: 922, dur: 58 },
  pcb: { from: 980, dur: 118 },
  outro: { from: 1098, dur: 150 },
};
export const BM_TOTAL = SHOTS.outro.from + SHOTS.outro.dur; // 1248 frames = 41.6s

/** Warm-white flashes straddling the hard cuts between blocks. */
const FLASH_AT = [SHOTS.bench.from, SHOTS.code.from, SHOTS.proof.from, SHOTS.pcb.from];

/**
 * Sound design, pinned to absolute frames.
 *
 * Cinematic vocabulary only — whoosh / impact / riser / sparkle / transition.
 * The outro keeps the fixed riser -> impact -> sparkle cadence. Sources and
 * licences are listed in public/audio/ATTRIBUTION.md, inherited unchanged from
 * the video-shotcraft template.
 */
const SFX: Array<{ from: number; src: string; volume: number; dur?: number }> = [
  { from: 8, src: 'transition-soft.mp3', volume: 0.5 },      // wordmark draws on
  { from: 86, src: 'whoosh-big.mp3', volume: 0.42 },          // push into the bench
  { from: 150, src: 'transition-snap.mp3', volume: 0.4 },     // card 1
  { from: 208, src: 'whoosh-fast.mp3', volume: 0.5 },         // cut to the bench
  { from: 286, src: 'pop.mp3', volume: 0.62 },                // the LEDs ignite
  { from: 352, src: 'click-camera.mp3', volume: 0.4 },        // knob turns down
  { from: 396, src: 'click-camera.mp3', volume: 0.4 },        // knob turns up
  { from: 440, src: 'transition-snap.mp3', volume: 0.4 },     // card 2
  { from: 498, src: 'whoosh-fast.mp3', volume: 0.5 },         // cut to code
  { from: 540, src: 'keyboard.mp3', volume: 0.34, dur: 44 },  // typing the sketch
  { from: 628, src: 'impact-cine.mp3', volume: 0.34 },        // the error lands
  { from: 694, src: 'transition-snap.mp3', volume: 0.4 },     // card 3
  { from: 752, src: 'swoosh-quick.mp3', volume: 0.44 },       // push onto the maths
  { from: 858, src: 'sparkle.mp3', volume: 0.3 },             // derivation resolves
  { from: 922, src: 'transition-snap.mp3', volume: 0.4 },     // card 4
  { from: 980, src: 'whoosh-fast.mp3', volume: 0.46 },        // cut to the PCB
  { from: 1098, src: 'riser-cine.mp3', volume: 0.42 },        // outro: riser
  { from: 1152, src: 'impact-cine.mp3', volume: 0.6 },        //         impact
  { from: 1162, src: 'sparkle.mp3', volume: 0.42 },           //         sparkle
];

/* ------------------------------ brand open ------------------------------ */

const Open: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const draw = spring({ frame: frame - 6, fps, config: { damping: 200, mass: 1.1 } });
  const sub = interpolate(frame, [30, 48], [0, 1], { extrapolateRight: 'clamp' });
  // Hold the wordmark a full second, then hand off to the bench.
  const handoff = interpolate(frame, [96, 150], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.bezier(0.4, 0, 0.2, 1),
  });

  return (
    <AbsoluteFill style={{ backgroundColor: C.base }}>
      {/* the bench rises behind the wordmark as it clears */}
      <AbsoluteFill style={{ opacity: handoff }}>
        <Cam
          src={`${T}/bench-idle.png`}
          keys={[
            { frame: 96, cx: 960, cy: 560, zoom: 1.22 },
            { frame: 150, cx: 960, cy: 540, zoom: 1.04 },
          ]}
        />
      </AbsoluteFill>

      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 1 - handoff,
          transform: `scale(${1 + handoff * 0.07})`,
        }}
      >
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 132,
              fontWeight: 700,
              letterSpacing: '-0.035em',
              color: C.ink,
              opacity: draw,
              transform: `translateY(${(1 - draw) * 22}px)`,
            }}
          >
            Board<span style={{ color: C.teal }}>Master</span>
          </div>
          <div
            style={{
              marginTop: 18,
              fontFamily: MONO,
              fontSize: 27,
              letterSpacing: '0.16em',
              textTransform: 'uppercase',
              color: C.ink3,
              opacity: sub,
            }}
          >
            Virtual Electronics Lab
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* ----------------------- block 1: build and run ------------------------ */

const BenchBlock: React.FC = () => {
  const frame = useCurrentFrame();
  // Hard cuts between the captured states; the camera keeps moving across them
  // so the cuts read as the same continuous bench changing, not as new shots.
  const stage =
    frame < 78 ? 'idle' : frame < 144 ? 'live' : frame < 188 ? 'low' : 'high';
  const src =
    stage === 'idle'
      ? 'bench-idle'
      : stage === 'live'
        ? 'bench-live'
        : stage === 'low'
          ? 'bench-knob-low'
          : 'bench-knob-high';

  return (
    <AbsoluteFill>
      <Cam
        src={`${T}/${src}.png`}
        keys={[
          { frame: 0, cx: 960, cy: 540, zoom: 1.04 },
          { frame: 78, cx: 700, cy: 470, zoom: 1.5 },
          { frame: 144, cx: 640, cy: 455, zoom: 1.9 },
          { frame: 232, cx: 760, cy: 470, zoom: 1.62 },
        ]}
      />
      <Sequence from={10} durationInFrames={64}>
        <Caption text="Students build the circuit themselves." durationInFrames={64} />
      </Sequence>
      <Sequence from={84} durationInFrames={56}>
        <Caption text="Run the sketch — and it lights." durationInFrames={56} />
      </Sequence>
      <Sequence from={150} durationInFrames={76}>
        <Caption text="Turn the knob: PWM dims the LED, live." durationInFrames={76} />
      </Sequence>
    </AbsoluteFill>
  );
};

/* -------------------- block 2: the code that drives it -------------------- */

const CodeBlock: React.FC = () => {
  const frame = useCurrentFrame();
  const src = frame < 118 ? 'code' : 'code-error';
  return (
    <AbsoluteFill>
      <Cam
        src={`${T}/${src}.png`}
        keys={[
          { frame: 0, cx: 1120, cy: 540, zoom: 1.06 },
          { frame: 118, cx: 1180, cy: 430, zoom: 1.46 },
          { frame: 196, cx: 1150, cy: 520, zoom: 1.3 },
        ]}
      />
      <Sequence from={10} durationInFrames={96}>
        <Caption
          text="Write real Arduino C++. The pins it drives power the board."
          durationInFrames={96}
        />
      </Sequence>
      <Sequence from={122} durationInFrames={66}>
        <Caption text="Get it wrong and you get a real error, on a real line." durationInFrames={66} />
      </Sequence>
    </AbsoluteFill>
  );
};

/* ---------------- block 3: the numbers are solved, not faked ---------------- */

const ProofBlock: React.FC = () => (
  <AbsoluteFill>
    <Cam
      src={`${T}/bench-live.png`}
      keys={[
        { frame: 0, cx: 1620, cy: 420, zoom: 1.5 },
        { frame: 90, cx: 1700, cy: 760, zoom: 2.05 },
        { frame: 170, cx: 1690, cy: 860, zoom: 2.2 },
      ]}
    />
    <Sequence from={8} durationInFrames={80}>
      <Caption text="Every reading is solved from your netlist." durationInFrames={80} />
    </Sequence>
    <Sequence from={96} durationInFrames={70}>
      <Caption
        text="Including the pin's own 25 Ω — a real pin is not an ideal source."
        durationInFrames={70}
      />
    </Sequence>
  </AbsoluteFill>
);

/* ------------------------- block 4: breadboard to PCB ------------------------- */

const PcbBlock: React.FC = () => (
  <AbsoluteFill>
    <Cam
      src={`${T}/pcb.png`}
      keys={[
        { frame: 0, cx: 960, cy: 540, zoom: 1.04 },
        { frame: 118, cx: 860, cy: 520, zoom: 1.34 },
      ]}
    />
    <Sequence from={8} durationInFrames={100}>
      <Caption text="Then lay it out — and let the checker find the fault." durationInFrames={100} />
    </Sequence>
  </AbsoluteFill>
);

/* --------------------------------- outro --------------------------------- */

const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const defocus = interpolate(frame, [0, 26], [0, 1], { extrapolateRight: 'clamp' });
  const land = spring({ frame: frame - 48, fps, config: { damping: 190, mass: 1.2 } });
  const tag = interpolate(frame, [74, 92], [0, 1], { extrapolateRight: 'clamp' });
  const link = interpolate(frame, [92, 110], [0, 1], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ backgroundColor: C.base }}>
      <AbsoluteFill style={{ opacity: 1 - defocus * 0.82 }}>
        <Cam
          src={`${T}/bench-outro.png`}
          blur={defocus * 9}
          keys={[
            { frame: 0, cx: 900, cy: 500, zoom: 1.5 },
            { frame: 150, cx: 960, cy: 520, zoom: 1.24 },
          ]}
        />
      </AbsoluteFill>
      <AbsoluteFill style={{ backgroundColor: C.base, opacity: defocus * 0.72 }} />

      <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div
            style={{
              fontFamily: SANS,
              fontSize: 142,
              fontWeight: 700,
              letterSpacing: '-0.035em',
              color: C.ink,
              opacity: land,
              transform: `translateY(${(1 - land) * -34}px) scale(${0.96 + land * 0.04})`,
            }}
          >
            Board<span style={{ color: C.teal }}>Master</span>
          </div>
          <div
            style={{
              marginTop: 22,
              fontFamily: SANS,
              fontSize: 36,
              fontWeight: 500,
              color: C.ink2,
              opacity: tag,
            }}
          >
            Build the circuit. Write the code. See why it works.
          </div>
          <div
            style={{
              marginTop: 30,
              fontFamily: MONO,
              fontSize: 23,
              color: C.ink3,
              opacity: link,
            }}
          >
            <Counter to={201} /> tests · deterministic engine · github.com/Huiii111/boardmaster
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/* --------------------------------- film --------------------------------- */

export const BmFilm: React.FC<{ bgm?: boolean }> = ({ bgm = true }) => (
  <AbsoluteFill style={{ backgroundColor: C.base }}>
    <Sequence from={SHOTS.open.from} durationInFrames={SHOTS.open.dur}>
      <Open />
    </Sequence>
    <Sequence from={SHOTS.card1.from} durationInFrames={SHOTS.card1.dur}>
      <TitleCard text="Nobody learns circuits by *watching*." />
    </Sequence>
    <Sequence from={SHOTS.bench.from} durationInFrames={SHOTS.bench.dur}>
      <BenchBlock />
    </Sequence>
    <Sequence from={SHOTS.card2.from} durationInFrames={SHOTS.card2.dur}>
      <TitleCard text="Your *code* drives the bench." />
    </Sequence>
    <Sequence from={SHOTS.code.from} durationInFrames={SHOTS.code.dur}>
      <CodeBlock />
    </Sequence>
    <Sequence from={SHOTS.card3.from} durationInFrames={SHOTS.card3.dur}>
      <TitleCard text="Every number is *solved*, never assumed." sub="I = (V − Vf) / R" />
    </Sequence>
    <Sequence from={SHOTS.proof.from} durationInFrames={SHOTS.proof.dur}>
      <ProofBlock />
    </Sequence>
    <Sequence from={SHOTS.card4.from} durationInFrames={SHOTS.card4.dur}>
      <TitleCard text="From breadboard to *PCB*." />
    </Sequence>
    <Sequence from={SHOTS.pcb.from} durationInFrames={SHOTS.pcb.dur}>
      <PcbBlock />
    </Sequence>
    <Sequence from={SHOTS.outro.from} durationInFrames={SHOTS.outro.dur}>
      <Outro />
    </Sequence>

    {FLASH_AT.map((f) => (
      <Sequence key={f} from={f - 5} durationInFrames={10}>
        <Flash />
      </Sequence>
    ))}

    {SFX.map((s, i) => (
      <Sequence key={i} from={s.from} durationInFrames={s.dur ?? 90}>
        <Audio src={staticFile(`audio/${s.src}`)} volume={s.volume} />
      </Sequence>
    ))}

    {bgm ? <Audio src={staticFile('audio/bgm.mp3')} volume={0.17} /> : null}
  </AbsoluteFill>
);
