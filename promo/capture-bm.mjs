/**
 * Asset capture for the BoardMaster promo film.
 *
 * video-shotcraft's own capture-template.mjs walks a list of routes. BoardMaster
 * is a single route whose workspace is store state, and several of the shots we
 * want only exist after a sketch has been run, so this drives the store instead
 * of the address bar and waits for the analysis to land before each shot.
 *
 * Produces, into out/:
 *   <name>.png        full viewport at 2x  (3840x2160)
 *   cut-<name>.png    element cutout at 2x
 *   layout.json       every recorded element box in CSS px, same coordinate
 *                     system the Remotion scenes position children in
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9444;
const URL_TARGET = process.env.TARGET_URL || 'http://localhost:3000/';
const OUT = process.argv[2] || './out';
const SCALE = 2;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(join(tmpdir(), 'bmcap-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--no-sandbox',
    '--hide-scrollbars',
    '--force-device-scale-factor=' + SCALE,
    '--font-render-hinting=none',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1920,1080',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

async function target() {
  for (let i = 0; i < 90; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(500);
  }
  throw new Error('chrome did not come up');
}

const t = await target();
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const waiters = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && waiters.has(m.id)) {
    waiters.get(m.id)(m);
    waiters.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const i = ++id;
    waiters.set(i, (m) => (m.error ? rej(new Error(method + ': ' + m.error.message)) : res(m)));
    ws.send(JSON.stringify({ id: i, method, params }));
  });

const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.text);
  return r.result.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1920,
  height: 1080,
  deviceScaleFactor: SCALE,
  mobile: false,
});

await send('Page.navigate', { url: URL_TARGET });
await sleep(9000); // bundle + R3F mount + thumbnail forge

const shot = async (name, clip) => {
  const params = { format: 'png', captureBeyondViewport: false };
  if (clip) params.clip = { ...clip, scale: SCALE };
  const r = await send('Page.captureScreenshot', params);
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('  shot', name, clip ? `(${Math.round(clip.width)}x${Math.round(clip.height)})` : '');
};

/** Box of the first match, in CSS px, or null. */
const boxOf = (selector) =>
  evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  })()`);

const layout = { viewport: { w: 1920, h: 1080 }, scale: SCALE, scenes: {} };

/** Apply store state, wait for it to settle, then shoot. */
async function scene(name, setup, { cutouts = {}, boxes = {}, wait = 2600 } = {}) {
  console.log('scene:', name);
  await evaluate(setup);
  await sleep(wait);
  await shot(name);
  const rec = { boxes: {}, cutouts: {} };
  for (const [k, sel] of Object.entries(boxes)) rec.boxes[k] = await boxOf(sel);
  for (const [k, sel] of Object.entries(cutouts)) {
    const b = await boxOf(sel);
    rec.cutouts[k] = b;
    if (b && b.w > 2 && b.h > 2) {
      await shot(`cut-${name}-${k}`, { x: b.x, y: b.y, width: b.w, height: b.h });
    }
  }
  layout.scenes[name] = rec;
}

const S = 'window.__labStore.getState()';
const PANELS = {
  status: 'aside section:nth-of-type(1)',
  issues: 'aside section:nth-of-type(2)',
};

// 1. the bench as it opens, nothing analysed, LEDs dark
await scene(
  'bench-idle',
  `(()=>{localStorage.clear();sessionStorage.clear();return 1})(); location.reload(); 1`,
  { wait: 11000, boxes: { brief: 'header + div [class*="border-b"]' } },
);

// 2. the same bench after the sketch runs — the hero frame
await scene('bench-live', `(()=>{${S}.runCode();return 1})()`, {
  wait: 3200,
  cutouts: PANELS,
  boxes: { viewport: 'main', sidebar: 'aside' },
});

// 3. knob low, so the PWM LED is visibly dim
await scene(
  'bench-knob-low',
  `(()=>{const s=${S};const rv=s.design.components.find(c=>c.label==='RV1');s.setComponentWiper(rv.id,0.18);${S}.runCode();return 1})()`,
);

// 4. knob high — the dimming comparison
await scene(
  'bench-knob-high',
  `(()=>{const s=${S};const rv=s.design.components.find(c=>c.label==='RV1');s.setComponentWiper(rv.id,1);${S}.runCode();return 1})()`,
);

// 5. button pressed — the indicator LED goes out
await scene(
  'bench-pressed',
  `(()=>{const s=${S};const sw=s.design.components.find(c=>c.label==='SW1');s.setComponentClosed(sw.id,true);${S}.runCode();return 1})()`,
);
await evaluate(
  `(()=>{const s=${S};const sw=s.design.components.find(c=>c.label==='SW1');s.setComponentClosed(sw.id,false);const rv=s.design.components.find(c=>c.label==='RV1');s.setComponentWiper(rv.id,0.5);${S}.runCode();return 1})()`,
);

// 6. the code workspace
await scene('code', `(()=>{${S}.setWorkspace('code');${S}.runCode();return 1})()`, {
  wait: 3400,
  boxes: { editor: 'main', output: 'main' },
});

// 7. a sketch that fails, so the film can show a real error
await scene(
  'code-error',
  `(()=>{${S}.setSketch('void setup(){\\n  pinMode(13, OUTPUT);\\n}\\nvoid loop(){\\n  digitalWrite(14, HIGH);\\n  delay(500)\\n}');${S}.runCode();return 1})()`,
  { wait: 3000 },
);
await evaluate(`(()=>{${S}.undo();${S}.runCode();return 1})()`);

// 8. the PCB workspace with the educational checks run
await scene('pcb', `(()=>{${S}.setWorkspace('pcb');${S}.runPcbChecks();return 1})()`, {
  wait: 3400,
  boxes: { board: 'svg', rail: 'aside' },
});

// 9. back to the bench for the closing frame
await scene('bench-outro', `(()=>{${S}.setWorkspace('circuit');${S}.runCode();return 1})()`, {
  wait: 3200,
});

writeFileSync(join(OUT, 'layout.json'), JSON.stringify(layout, null, 2));
console.log('\nlayout.json written');

const logs = await evaluate('1');
ws.close();
chrome.kill();
console.log('done ->', OUT);
process.exit(0);
