/**
 * Run the production build.
 *
 * `next start` does not serve a `output: "standalone"` build — Next says so
 * itself, in a warning printed after it has already claimed to be ready — and
 * `package.json` pointed `npm start` at it for the life of the project.
 *
 * The second half is worse and quieter. `.next/standalone/` holds `server.js`,
 * a `package.json` and a trimmed `node_modules`, and **nothing else**: not the
 * built client chunks under `.next/static`, not `public/`. Run it as it comes
 * out of the build and every page renders, every stylesheet 404s, and no script
 * loads — an application that answers 200 and does nothing. Measured, not
 * inferred: `/no-script.css` returned 404 from a freshly built standalone
 * server.
 *
 * Copying those two directories in is a documented deployment step that this
 * repository had nowhere written down. It is written down here, in the thing
 * that runs, so it cannot be the step somebody forgets — and in Node rather
 * than shell, because a `cp -r` in an npm script is a script that works on the
 * machine it was written on.
 */

import { cp, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/** Put the pieces the build leaves behind next to the server that needs them. */
export async function assemble() {
  if (!(await exists(path.join(standalone, "server.js")))) {
    throw new Error("no standalone build — run `npm run build` first");
  }
  await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), {
    recursive: true,
  });
  if (await exists(path.join(root, "public"))) {
    await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("serve.mjs")) {
  await assemble();
  if (process.argv.includes("--assemble-only")) {
    console.info("standalone bundle assembled");
  } else {
    // Inherit stdio so the server's own output is the output of `npm start`,
    // and forward the exit code so a supervisor sees what actually happened.
    const child = spawn(process.execPath, [path.join(standalone, "server.js")], {
      stdio: "inherit",
      env: process.env,
    });
    child.on("exit", (code) => process.exit(code ?? 0));
  }
}
