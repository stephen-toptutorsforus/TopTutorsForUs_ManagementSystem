/**
 * The startup gate.
 *
 * `startupChecks()` has existed since the port and was called from nowhere. Its
 * own module comment said an unconfigured deployment "fails an explicit startup
 * check rather than quietly running with a known key" — and nothing ran it, so
 * a production deploy with `SECRET_KEY` left at the shipped placeholder would
 * have started, served, and signed session cookies with a key that is in this
 * repository. Anyone holding it can mint a cookie for any user id in any tenant;
 * `readSession` asks only whether the signature verifies.
 *
 * Next calls `register()` once per server process, before any request is
 * handled, which is the only moment where refusing is cheaper than serving.
 * `process.exit(1)` rather than a thrown error: a throw here is caught and
 * logged by the framework, and the process goes on to serve traffic, which is
 * exactly the outcome the check exists to prevent.
 *
 * Outside production it prints nothing. The placeholder key is *for* development
 * and a warning nobody can act on is a warning people learn to scroll past.
 */

import { startupChecks } from "@/lib/config";

export function register(): void {
  const problems = startupChecks();
  if (problems.length === 0) return;

  console.error("refusing to start:");
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
