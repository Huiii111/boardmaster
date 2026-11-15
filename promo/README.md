# promo — the BoardMaster product film

The source for the 41.6 s product film. It is **not** part of the Next.js app
and is excluded from its typecheck and build (`tsconfig.json` → `exclude`),
because it depends on Remotion, which the lab itself does not.

## What is here

| | |
| --- | --- |
| `capture-bm.mjs` | Drives a headless Chrome over the running lab and captures every product frame the film uses, at 2x. Nothing in the film is a mock-up. |
| `src-bm/Film.tsx` | The shot timeline, the title cards, the captions and the SFX pin table. |
| `src-bm/Cam.tsx` | The 2.5D page camera. |
| `src-bm/Bits.tsx` | Shared type, motion and the palette, taken from `src/app/globals.css`. |
| `props-nobgm.json` | Renders the SFX-only cut from the same timeline. |

## Rebuilding it

The film is built on [video-shotcraft](https://github.com/Vincentwei1021/video-shotcraft)'s
Remotion template, which supplies the sound-design library and the render
pipeline.

```bash
# 1. get the toolkit and install the template
git clone https://github.com/Vincentwei1021/video-shotcraft.git
cp -r video-shotcraft/template promo-build && cd promo-build && npm install

# 2. drop this film's source in and register it in src/Root.tsx
cp -r ../promo/src-bm src/bm

# 3. capture fresh product frames (the lab must be running on :3000)
node ../promo/capture-bm.mjs public/textures/bm

# 4. render both cuts
npx remotion render src/index.ts BoardMasterPromo out/boardmaster-promo.mp4
npx remotion render src/index.ts BoardMasterPromo out/boardmaster-promo-nobgm.mp4 \
  --props=../promo/props-nobgm.json
```

## Audio

- **Music** — *House Vibez* by Lily J, Mixkit Stock Music Free License
  (royalty-free, commercial use, no attribution required).
- **Sound design** — the 11 cinematic SFX bundled with the video-shotcraft
  template; see its `public/audio/ATTRIBUTION.md` for per-file provenance.

Two cuts are delivered, as the toolkit requires: one with music, one with the
sound design alone.
