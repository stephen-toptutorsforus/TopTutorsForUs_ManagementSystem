"use client";

/**
 * The application shell's sidebar.
 *
 * Ported from the navigation macros in `app/templates/base.html`. Landmarks are
 * real elements — `nav`, not a div with a role — so the page is navigable by
 * rotor and by keyboard without extra scaffolding.
 *
 * A client component for one reason: `aria-current` has to follow navigation,
 * and the layout that renders this does not re-run when the route changes.
 * Which rows *exist* is still decided on the server, by permission.
 */

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

import type { Navigation, RenderedEntry, RenderedItem, RenderedPending } from "@/lib/navigation";
import { CSRF_FIELD } from "@/lib/names";

import { DRAWER_ID } from "./drawer";
import { SignOutButton } from "./SignOutButton";

/** A row inside an expanded group: a link, or an inert row for unbuilt work. */
function NavRow({ entry, path }: { entry: RenderedItem | RenderedPending; path: string }) {
  if (entry.kind === "item") {
    return (
      <Link href={entry.href} aria-current={entry.href === path ? "page" : undefined}>
        <span className="nav-label">{entry.label}</span>
      </Link>
    );
  }
  return (
    <p className="nav-pending" aria-disabled="true">
      <span className="nav-label">{entry.label}</span>
      <span className="tag">{entry.note}</span>
    </p>
  );
}

function NavEntry({ entry, path }: { entry: RenderedEntry; path: string }) {
  if (entry.kind === "divider") return <hr className="nav-divider" />;

  if (entry.kind === "item") {
    return (
      <Link href={entry.href} aria-current={entry.href === path ? "page" : undefined}>
        <span className="icon" aria-hidden="true">
          {entry.icon}
        </span>
        <span className="nav-label">{entry.label}</span>
      </Link>
    );
  }

  if (entry.kind === "group") {
    // Open the section the viewer is currently inside, so the sidebar always
    // shows where they are — and stay open once a person opens one by hand.
    const inside = entry.items.some((item) => item.kind === "item" && item.href === path);
    return (
      <details className="nav-group" open={inside || undefined}>
        <summary>
          <span className="icon" aria-hidden="true">
            {entry.icon}
          </span>
          <span className="nav-label">{entry.label}</span>
          <span className="nav-chevron" aria-hidden="true">
            ›
          </span>
        </summary>
        {/* Children carry no icons: the indent already says they belong to the
            section above, and a second column of glyphs only adds noise. */}
        <div className="nav-children">
          {entry.items.map((item, index) => (
            <NavRow key={`${item.label}-${index}`} entry={item} path={path} />
          ))}
        </div>
      </details>
    );
  }

  // Not a link: the section exists in the product's shape but not yet in the
  // build, and a link that goes nowhere is worse than an honest label.
  return (
    <p className="nav-pending" aria-disabled="true">
      <span className="icon" aria-hidden="true">
        {entry.icon}
      </span>
      <span className="nav-label">{entry.label}</span>
      <span className="tag">{entry.note}</span>
    </p>
  );
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function Sidebar({
  nav,
  displayName,
  primaryRole,
  organizationName,
  csrfToken,
}: {
  nav: Navigation;
  displayName: string;
  primaryRole: string;
  organizationName: string;
  csrfToken: string;
}) {
  const path = usePathname();

  useEffect(() => {
    const shell = document.querySelector(".shell");
    if (shell === null) return;

    // `:target` is how the drawer opens, and with a full page load it also
    // closes itself: the next page's URL has no fragment. Client-side routing
    // does not give it that — Chromium keeps the element matching `:target`
    // after a pushState to a fragmentless URL, so the drawer stayed open over
    // the page just navigated to. This says closed explicitly, and the
    // stylesheet gives the attribute precedence over `:target`.
    //
    // Only ever an addition. With scripting off the attribute is never set,
    // `:target` alone governs, and the full page load closes the drawer as it
    // always did.
    shell.setAttribute("data-nav", "closed");

    const reopen = () => {
      if (window.location.hash === `#${DRAWER_ID}`) shell.removeAttribute("data-nav");
    };
    window.addEventListener("hashchange", reopen);
    return () => window.removeEventListener("hashchange", reopen);
  }, [path]);

  return (
    <>
      {/* Below the breakpoint this is a drawer, opened by the header's link to
          `#primary-nav` and closed by clearing the fragment. `:target` rather
          than a scripted panel, for the reason the People modals give: a
          control that needs JavaScript to open is, without it, a navigation
          nobody can reach. Above the breakpoint the id does nothing and this is
          simply the first column. */}
      <nav className="sidebar" id={DRAWER_ID} aria-label="Primary">
        {/* Only ever visible while the drawer is open; on a wide screen there is
            nothing to close. Anchored to `#` because that is what clears the
            fragment `:target` is matching. */}
        <a className="drawer-close" href="#">
          <span className="glyph" aria-hidden="true">
            ✕
          </span>
          <span className="visually-hidden">Close navigation</span>
        </a>

        {/* The wordmark carries the product name, so the image is the accessible
            name of this link and the square mark is only the collapsed-rail
            stand-in. The tenant's own name stays beneath it: with two tenants
            open side by side, the logo alone would make the two sidebars
            identical. */}
        <Link className="brand" href="/">
          <Image
            className="brand-logo"
            src="/img/logo.png"
            alt="TopTutorsForUs"
            width={1688}
            height={381}
            priority
          />
          <span className="brand-mark" aria-hidden="true">
            T
          </span>
          <span className="brand-tagline">{organizationName}</span>
        </Link>

        <div className="nav">
          {nav.main.map((entry, index) => (
            <NavEntry key={index} entry={entry} path={path} />
          ))}
        </div>

        <div className="sidebar-footer">
          <div className="nav">
            {nav.footer.map((entry, index) => (
              <NavEntry key={index} entry={entry} path={path} />
            ))}
          </div>

          <p className="whoami">
            <strong>{displayName}</strong>
            <span className="whoami-role">{titleCase(primaryRole)}</span>
          </p>
          <SignOutButton csrfField={CSRF_FIELD} csrfToken={csrfToken} />
        </div>
      </nav>

      {/* Dismisses the drawer by tapping beside it. A sibling *after* the
          sidebar so the stylesheet can select it from `:target`, and inert
          above the breakpoint where nothing is covering anything. */}
      <a className="drawer-backdrop" href="#" tabIndex={-1} aria-hidden="true" />
    </>
  );
}
