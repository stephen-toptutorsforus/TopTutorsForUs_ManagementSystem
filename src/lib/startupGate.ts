/**
 * Refuse to serve when the configuration is not fit to serve with.
 *
 * Split out of `instrumentation.ts` so that `process.exit` is reached only
 * through a dynamic import that the edge bundle never takes. `register()` is
 * compiled for both runtimes, and the edge runtime has no `process.exit` —
 * Turbopack says so at build time, which is a warning that would sit in every
 * build output from now on, teaching everybody to read past warnings.
 */

import { startupChecks } from "@/lib/config";

export function gate(): void {
  const problems = startupChecks();
  if (problems.length === 0) return;

  console.error("refusing to start:");
  for (const problem of problems) console.error(`  - ${problem}`);
  // Not a thrown error: Next catches what `register` throws, logs it, and goes
  // on to serve traffic — which is the outcome this exists to prevent.
  process.exit(1);
}
