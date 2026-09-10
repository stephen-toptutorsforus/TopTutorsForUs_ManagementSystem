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
      <noscript>
        <style>{NO_SCRIPT_NAV}</style>
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

/** Below the breakpoint only: above it the sidebar is already a column. */
const NO_SCRIPT_NAV = `
@media (max-width: 720px) {
  .sidebar {
    position: static;
    width: auto; height: auto;
    transform: none; visibility: visible;
    border-right: 0; border-bottom: 1px solid var(--ink-200);
  }
  .topbar-menu, .drawer-close, .drawer-backdrop { display: none; }
}
`;
