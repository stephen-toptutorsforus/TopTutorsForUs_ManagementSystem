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
 *
 * Node only, and behind a dynamic import. `register` is compiled for the edge
 * runtime as well, where there is no `process.exit` — and there is nothing to
 * gate there in any case: the secret is used by `node:crypto` on the Node side,
 * and an edge worker refusing to start would take the middleware down while
 * leaving the server that actually signs cookies running. The check belongs
 * where it can be acted on.
 *
 * Outside production it does nothing. The placeholder key is *for* development,
 * and a warning nobody can act on is a warning people learn to scroll past.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { gate } = await import("@/lib/startupGate");
  gate();
}
