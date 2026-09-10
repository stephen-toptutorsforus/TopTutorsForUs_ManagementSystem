"use client";

/**
 * The frame, and the one piece of state it holds: whether the mobile
 * navigation is showing.
 *
 * The drawer used to be `:target` — the header linked to `#primary-nav` and the
 * stylesheet matched it. Two things made that untenable. It put a fragment on
 * every address somebody opened the menu from, and it did not survive
 * client-side routing: Chromium keeps an element matching `:target` after a
 * pushState to a fragmentless URL, so the drawer stayed open over the page it
 * had just navigated to. The fix for that was a `data-nav="closed"` attribute
 * written by an effect and given precedence in the stylesheet — a workaround
 * for a workaround, and the clearest sign the mechanism was wrong.
 *
 * One `useState` replaces both. The server layout still loads the principal,
 * the organization, the navigation and the token; this takes them as plain
 * values and renders the same three boxes.
 *
 * **Without JavaScript the drawer does not open.** That would strand a phone —
 * the sidebar is the only route to any other page — so the layout ships a
 * `<noscript>` stylesheet that lays the navigation out as a static block
 * instead. No drawer, every link reachable.
 */

import { useCallback, useState } from "react";

import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import type { Navigation } from "@/lib/navigation";

export function AppShell({
  nav,
  displayName,
  primaryRole,
  organizationName,
  csrfToken,
  children,
}: {
  nav: Navigation;
  displayName: string;
  primaryRole: string;
  organizationName: string;
  csrfToken: string;
  children: React.ReactNode;
}) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  // Stable, because the sidebar closes itself on a route change and an effect
  // that depended on a new function each render would close it again the
  // instant it opened.
  const close = useCallback(() => setNavigationOpen(false), []);

  return (
    <div className="shell">
      {/* Below the breakpoint the sidebar is a drawer and this is the header
          left in its place. Above it, this renders nothing. Both are given the
          same navigation, so the header's title cannot name a page the sidebar
          does not offer. */}
      <TopBar
        nav={nav}
        displayName={displayName}
        organizationName={organizationName}
        navigationOpen={navigationOpen}
        onOpenNavigation={() => setNavigationOpen(true)}
      />
      {/* The navigation is filtered by permission on the server and arrives
          here already narrowed. Which row is *current* is decided in the
          browser: a layout does not re-render per navigation, so marking it on
          the server would freeze the highlight on whichever page happened to be
          loaded first. */}
      <Sidebar
        nav={nav}
        displayName={displayName}
        primaryRole={primaryRole}
        organizationName={organizationName}
        csrfToken={csrfToken}
        open={navigationOpen}
        onClose={close}
      />
      {/* The children are server-rendered and pass straight through. Being
          inside a client component does not make them one. */}
      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}
