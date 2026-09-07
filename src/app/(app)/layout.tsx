/**
 * The application shell.
 *
 * Ported from `app/templates/base.html`. Everything inside this route group is
 * behind sign-in: an unauthenticated visitor is redirected rather than shown an
 * empty frame, because a shell with no navigation in it looks like a broken
 * page rather than like a closed door.
 */

import { redirect } from "next/navigation";

import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { navigation } from "@/lib/navigation";
import { csrfToken, currentOrganization, currentPrincipal } from "@/lib/web/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const principal = await currentPrincipal();
  if (principal === null) redirect("/sign-in");

  const organization = await currentOrganization(principal);
  const nav = navigation(principal);

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to main content
      </a>
      <div className="shell">
        {/* Below the breakpoint the sidebar is a drawer and this is the header
            left in its place. Above it, this renders nothing. Both are given
            the same navigation, so the header's title cannot name a page the
            sidebar does not offer. */}
        <TopBar
          nav={nav}
          displayName={principal.displayName}
          organizationName={organization.name}
        />
        {/* The navigation is filtered by permission here, on the server. Which
            row is *current* is decided in the browser: a layout does not
            re-render per navigation, so marking it here would freeze the
            highlight on whichever page happened to be loaded first. */}
        <Sidebar
          nav={nav}
          displayName={principal.displayName}
          primaryRole={principal.primaryRole}
          organizationName={organization.name}
          csrfToken={await csrfToken()}
        />
        <main className="main" id="main">
          {children}
        </main>
      </div>
    </>
  );
}
