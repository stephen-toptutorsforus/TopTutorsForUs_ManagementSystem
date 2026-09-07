"use client";

/**
 * The mobile header.
 *
 * Below the breakpoint the sidebar used to unfold above the page — the whole
 * navigation, every group, before a word of the actual screen. On a phone that
 * was most of the first scroll. Here the navigation becomes a drawer and this
 * bar is what is left in its place: where you are, who you are, and a way in.
 *
 * Hidden above the breakpoint, where the sidebar is a column and none of this
 * is needed.
 *
 * A client component for the same reason the sidebar is one: the title follows
 * navigation, and the layout that renders it does not re-run when the route
 * changes.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

import { titleFor, type Navigation } from "@/lib/navigation";

import { DRAWER_ID } from "./drawer";

/**
 * `RM` for Rowan Mercer.
 *
 * Taken from the display name rather than the name parts, because that is what
 * the shell is given. Decorative — the name is already in the drawer, so this
 * is `aria-hidden` where it is used and never the only place somebody is named.
 */
function initialsOf(displayName: string): string {
  const words = displayName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = words[0]!.slice(0, 1);
  const last = words.length > 1 ? words[words.length - 1]!.slice(0, 1) : "";
  return (first + last).toUpperCase();
}

export function TopBar({
  nav,
  displayName,
  organizationName,
}: {
  nav: Navigation;
  displayName: string;
  organizationName: string;
}) {
  const path = usePathname();
  // A route with no navigation entry of its own — a session detail, say — takes
  // the name of the section it belongs to. Falling back to the tenant's name
  // beats an empty bar or a hard-coded product name.
  const title = titleFor(nav, path) ?? organizationName;

  return (
    <header className="topbar">
      <Link className="topbar-home" href="/" aria-label="TopTutorsForUs home">
        <span className="brand-mark" aria-hidden="true">
          T
        </span>
      </Link>

      <p className="topbar-title">{title}</p>

      <span className="avatar topbar-avatar" title={displayName} aria-hidden="true">
        {initialsOf(displayName)}
      </span>

      {/* A link to the drawer, not a button: `:target` opens it, so it works
          with scripting off. The same reason the People modals are links. */}
      <a className="topbar-menu" href={`#${DRAWER_ID}`}>
        <span className="glyph" aria-hidden="true">
          ☰
        </span>
        <span className="visually-hidden">Open navigation</span>
      </a>
    </header>
  );
}
