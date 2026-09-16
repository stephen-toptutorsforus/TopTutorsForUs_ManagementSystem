/**
 * The application shell.
 *
 * Ported from `app/templates/base.html`. Everything inside this route group is
 * behind sign-in: an unauthenticated visitor is redirected rather than shown an
 * empty frame, because a shell with no navigation in it looks like a broken
 * page rather than like a closed door.
 */

import { redirect } from "next/navigation";

import { AppShell } from "@/components/AppShell";
import { navigation } from "@/lib/navigation";
import { csrfToken, currentOrganization, currentPrincipal } from "@/lib/web/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await currentPrincipal();
  if (principal === null) redirect("/sign-in");

  const organization = await currentOrganization(principal);
  const nav = navigation(principal);

  return (
    <>
      {/* A real anchor to a real element, and the one fragment left in the
          application. It is what a fragment is for: a place in the document. */}
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      {/* The drawer opens from React state, so with no script there is no way
          to open it — and below the breakpoint the sidebar is the only route to
          any other page. This lays the navigation out as a static block
          instead: no drawer, no button, every link reachable. It is a
          `<noscript>`, so a hydrated page never sees a line of it. */}
      {/* Linked, not inlined: an inline `<style>` is what `style-src 'self'`
          refuses, and this was the only thing in the codebase that broke when
          the policy the stylesheet had always claimed was actually sent. The
          rules are in `public/no-script.css`. Still inside the `<noscript>`, so
          a browser with scripting on never fetches it. */}
      <noscript>
        {/* The lint rule wants CSS imported so the build can bundle it, and
            bundling is exactly what must not happen: these rules apply only
            when scripting is off, and an import would ship them to everybody
            and apply them to nobody. A `<link>` inside `<noscript>` is the one
            thing that loads on that condition and no other. */}
        {/* eslint-disable-next-line @next/next/no-css-tags */}
        <link rel="stylesheet" href="/no-script.css" />
      </noscript>
      <AppShell
        nav={nav}
        displayName={principal.displayName}
        primaryRole={principal.primaryRole}
        organizationName={organization.name}
        csrfToken={await csrfToken()}
      >
        {children}
      </AppShell>
    </>
  );
}
