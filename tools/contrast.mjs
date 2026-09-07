/**
 * Measure the palette against WCAG, in both colour schemes.
 *
 * The brand tokens are used as text, as backgrounds behind text, and as
 * borders, and each of those wants a different ratio. A palette change that is
 * fine for one can fail another silently — the page still renders, it is just
 * unreadable for some people — so the pairs that matter are declared here and
 * checked rather than judged by eye.
 *
 *     node tools/contrast.mjs
 *
 * Exits non-zero if any declared pair falls below its threshold.
 */

import { readFileSync } from "node:fs";

const CSS = new URL("../src/app/toptutorsforus.css", import.meta.url);

/** WCAG 2.1 relative luminance. */
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const channel = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/**
 * Token values for each scheme.
 *
 * Light is whatever bare `:root` declares; dark is that with the
 * `prefers-color-scheme: dark` block applied over it, which is exactly how a
 * browser resolves them.
 */
function palettes() {
  const css = readFileSync(CSS, "utf-8");
  const darkAt = css.indexOf("@media (prefers-color-scheme: dark)");
  const read = (text) => {
    const found = {};
    for (const [, name, value] of text.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
      found[name] = value.toLowerCase();
    }
    return found;
  };
  const light = read(css.slice(0, darkAt));
  return { light, dark: { ...light, ...read(css.slice(darkAt, darkAt + 1400)) } };
}

/**
 * Every pair a brand token takes part in, and what each one has to clear.
 *
 * 4.5 for normal text, 3.0 for a border or an outline — the thing whose job is
 * to be seen rather than read.
 */
const PAIRS = [
  ["link", "--brand-600", "--paper", 4.5],
  ["link:hover", "--brand-700", "--paper", 4.5],
  ["btn-primary label", "--on-brand", "--brand-600", 4.5],
  ["btn-primary:hover label", "--on-brand", "--brand-700", 4.5],
  ["skip-link label", "--on-brand", "--brand-700", 4.5],
  ["active nav row", "--brand-700", "--brand-100", 4.5],
  ["selected choice", "--brand-700", "--brand-100", 4.5],
  ["calendar event on hover", "--ink-900", "--brand-100", 4.5],
  ["focus outline", "--brand-500", "--paper", 3.0],
  ["open filter menu border", "--brand-600", "--paper", 3.0],
  ["body text", "--ink-900", "--paper", 4.5],
  ["muted text", "--ink-500", "--paper", 4.5],
];

const { light, dark } = palettes();
let failed = 0;

for (const [scheme, tokens] of [
  ["light", light],
  ["dark", dark],
]) {
  console.log(`\n  ${scheme}`);
  for (const [what, fg, bg, floor] of PAIRS) {
    const a = tokens[fg];
    const b = tokens[bg];
    if (!a || !b) {
      console.log(`    ??  ${what}: ${!a ? fg : bg} is not defined`);
      failed += 1;
      continue;
    }
    const ratio = contrast(a, b);
    const ok = ratio >= floor;
    if (!ok) failed += 1;
    console.log(
      `    ${ok ? "ok " : "FAIL"} ${ratio.toFixed(2).padStart(5)}:1 ` +
        `(needs ${floor.toFixed(1)})  ${what}  ${a} on ${b}`,
    );
  }
}

console.log(
  failed === 0 ? "\n  every declared pair clears its threshold\n" : `\n  ${failed} failing\n`,
);
process.exit(failed === 0 ? 0 : 1);
