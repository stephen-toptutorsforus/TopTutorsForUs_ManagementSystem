/**
 * Dump every route's server-rendered markup, for diffing across a refactor.
 *
 * A refactor that only moves markup into components should change no markup at
 * all. This makes that checkable instead of arguable: snapshot before,
 * snapshot after, diff. Anything that shows up in the diff is either a bug or a
 * decision somebody should have to defend.
 *
 *     node tools/snapshot-html.mjs <out-dir> [base-url]
 *
 * Development only. It signs in as seeded accounts and writes their pages to
 * disk, so it belongs nowhere near real data.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = process.argv[2];
const BASE = process.argv[3] ?? "http://127.0.0.1:3000";
if (!OUT) {
  console.error("usage: node tools/snapshot-html.mjs <out-dir> [base-url]");
  process.exit(1);
}

const ACCOUNTS = {
  admin: "rowan.mercer@example.test",
  student: "teo.vasquez@example.test",
};

const ROUTES = [
  "/", "/calendar", "/calendar?view=week", "/calendar?view=day", "/calendar?view=list",
  "/sessions", "/sessions?status=scheduled", "/sessions/new", "/series",
  "/availability", "/people", "/people?role=student", "/groups", "/locations",
  "/audit", "/help",
];

function cookieFor(email) {
  const out = execFileSync("npx", ["tsx", "scripts/mint-session.ts", email], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  return out.trim().split(/\r?\n/).pop();
}

/**
 * The application's own markup, without the framework's.
 *
 * Next's script tags and inline flight data carry build ids and chunk hashes
 * that differ between two builds of identical source, so comparing whole
 * documents would report a difference on every run and prove nothing.
 */
function appMarkup(html) {
  const body = html.slice(html.indexOf("<body"), html.lastIndexOf("</body>"));
  return body
    .replace(/<script[\s\S]*?<\/script>/g, "")
    // Never write a CSRF token to disk. It is freshly signed per request, so it
    // would differ on every run and make the diff useless even if it were
    // harmless to keep — and it is not.
    .replace(/(name="csrf_token" value=")[^"]*/g, "$1<redacted>")
    // Next's server-action ids are hashes of the module the action lives in, so
    // moving an action between files changes them without changing the page.
    .replace(/(name="\$ACTION_[A-Z_]+" value=")[^"]*/g, "$1<build-id>")
    .replace(/(name="\$ACTION_ID_)[^"]*/g, "$1<build-id>")
    .replace(/<template[\s\S]*?<\/template>/g, "")
    // React's own comments — the empty ones that separate adjacent text nodes
    // for hydration, and the `$`/`/$` suspense markers. They are bookkeeping,
    // not content: where React puts them depends on how the modules happened to
    // be chunked, so moving a component between files moves them. JSX comments
    // never reach the output, so nothing here is the application's own.
    .replace(/<!--(?:\s*|\/?\$[^>]*)-->/g, "")
    .replace(/\s+/g, " ")
    // One tag per line. Collapsed onto a few very long lines a diff reports
    // "this line changed" and leaves you to find where — which for a refactor
    // whose whole claim is "nothing changed" is no use at all.
    .replace(/>\s*</g, ">\n<")
    .trim();
}

mkdirSync(OUT, { recursive: true });

for (const [who, email] of Object.entries(ACCOUNTS)) {
  const cookie = `toptutorsforus_session=${cookieFor(email)}`;
  for (const route of ROUTES) {
    const response = await fetch(BASE + route, { headers: { cookie }, redirect: "manual" });
    const name = `${who}${route.replace(/[/?=&]/g, "_") || "_root"}.html`;
    const text = response.status === 200 ? appMarkup(await response.text()) : "";
    writeFileSync(path.join(OUT, name), `HTTP ${response.status}\n${text}\n`);
  }
  console.log(`  ${who}: ${ROUTES.length} routes`);
}
console.log(`written to ${OUT}`);
