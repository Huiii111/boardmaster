/**
 * BoardMaster — retarget the Figma design-system file to the shipped light theme.
 *
 * WHY THIS FILE EXISTS
 * The Figma MCP server caps tool calls on the Starter plan, and this write hit
 * that cap. Rather than leave the Figma file documenting a theme the product no
 * longer ships, the same operation is provided here as a plugin script you run
 * once from inside Figma, where no MCP quota applies.
 *
 * HOW TO RUN
 *   1. Open the BoardMaster design-system file in the Figma desktop app.
 *   2. Menu > Plugins > Development > New Plugin… > "Figma design" > name it
 *      anything, save it somewhere.
 *   3. Replace the generated code.js with this file's contents.
 *   4. Menu > Plugins > Development > run your plugin.
 *   5. It prints a report to the plugin console saying exactly which variables
 *      it updated and which it could not match.
 *
 * WHAT IT DOES
 *   - renames the document to "BoardMaster — Design System"
 *   - rewrites every colour variable it can match to the light-theme value
 *   - sets each variable's WEB code syntax to the real CSS custom property, so
 *     Figma's inspector shows `var(--accent-cyan)` — the same token the code
 *     actually reads
 *
 * The hex values below are copied verbatim from src/app/globals.css. If you
 * change a token in the CSS, change it here too; that pairing is the whole
 * point of the file.
 */

const NEXT = {
  'surface/void': '#e7ecf2',
  'surface/base': '#f2f5f9',
  'surface/raised': '#ffffff',
  'surface/panel': '#ffffff',
  'surface/inset': '#f1f4f8',
  'surface/hover': '#e9eef5',
  'surface/active': '#dbe4ef',

  'border/subtle': '#e6eaf0',
  'border/default': '#d2dae4',
  'border/strong': '#adbbcb',

  'text/primary': '#10181f',
  'text/secondary': '#3a4654',
  'text/tertiary': '#5a6877',
  'text/disabled': '#708092',

  'accent/electric': '#0d6fd1',
  'accent/electric-bright': '#0a5cb0',
  'accent/cyan': '#0b7a6d',
  'accent/cyan-bright': '#086257',

  'signal/ok': '#0b7a52',
  'signal/warn': '#96580a',
  'signal/error': '#ca2b2b',
  'signal/info': '#1a5fcc',

  // Physical materials are properties of the parts, not of the theme, so they
  // are unchanged by the dark -> light switch and are listed here only so the
  // script can confirm it still recognises them.
  'material/breadboard': '#e8e6df',
  'material/copper': '#c88b45',
  'material/led-red': '#e8352a',
  'material/resistor-body': '#cdb086',
};

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
};

/** `accent/cyan-bright` -> `--accent-cyan-bright` */
const cssVarFor = (name) => '--' + name.split('/').join('-');

const normalise = (s) => s.toLowerCase().replace(/\s+/g, '').replace(/_/g, '-');

(async () => {
  figma.root.name = 'BoardMaster — Design System';

  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const variables = await figma.variables.getLocalVariablesAsync();

  const wanted = new Map();
  for (const [name, hex] of Object.entries(NEXT)) wanted.set(normalise(name), hex);

  const updated = [];
  const unmatched = [];

  for (const variable of variables) {
    if (variable.resolvedType !== 'COLOR') continue;

    const hex = wanted.get(normalise(variable.name));
    if (!hex) {
      unmatched.push(variable.name);
      continue;
    }

    const collection = collections.find((c) => c.id === variable.variableCollectionId);
    if (!collection) continue;

    // The file is single-mode, but writing every mode keeps this correct if a
    // light/dark mode pair is added later.
    for (const mode of collection.modes) {
      variable.setValueForMode(mode.modeId, hexToRgb(hex));
    }

    try {
      variable.setVariableCodeSyntax('WEB', `var(${cssVarFor(variable.name)})`);
    } catch (err) {
      // Code syntax is a nicety; a failure here should not abort the retarget.
    }

    updated.push(`${variable.name} -> ${hex}`);
  }

  console.log(`BoardMaster token retarget`);
  console.log(`  updated   : ${updated.length}`);
  updated.forEach((line) => console.log(`    ${line}`));
  if (unmatched.length) {
    console.log(`  unmatched : ${unmatched.length} (left untouched)`);
    unmatched.forEach((name) => console.log(`    ${name}`));
  }

  figma.notify(`BoardMaster: ${updated.length} variables retargeted, ${unmatched.length} untouched`);
  figma.closePlugin();
})();
