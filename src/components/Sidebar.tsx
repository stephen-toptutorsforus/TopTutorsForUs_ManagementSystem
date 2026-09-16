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

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { Tag, VisuallyHidden } from "@/components/ui";
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
      <Tag>{entry.note}</Tag>
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
      <Tag>{entry.note}</Tag>
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
  open,
  onClose,
}: {
  nav: Navigation;
  displayName: string;
  primaryRole: string;
  organizationName: string;
  csrfToken: string;
  /** Below the breakpoint, whether the drawer is showing. Ignored above it. */
  open: boolean;
  onClose: () => void;
}) {
  const path = usePathname();

  // Closed by arriving somewhere. The route is the dependency and `onClose` is
  // read through a ref, because a handler rebuilt on every render would make
  // this run on every render — closing the drawer as fast as it opened.
  const dismiss = useRef(onClose);
  // Declared before the effect that reads it, so it is up to date by the time
  // that one runs. Assigning during render would be reading a ref mid-render,
  // which React does not promise anything about.
  useEffect(() => {
    dismiss.current = onClose;
  }, [onClose]);
  useEffect(() => {
    dismiss.current();
  }, [path]);

  // Escape closes it, as it closes any overlay.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      {/* Below the breakpoint this is a drawer, and `data-open` is what the
          stylesheet slides. Above the breakpoint the attribute means nothing
          and this is simply the first column. The id is what the header's
          button points `aria-controls` at. */}
      <nav
        className="sidebar"
        id={DRAWER_ID}
        aria-label="Primary"
        data-open={open ? "true" : "false"}
      >
        {/* Only ever visible while the drawer is open; on a wide screen there
            is nothing to close. A button, not a link: it dismisses a panel
            rather than going anywhere. */}
        <button type="button" className="drawer-close" onClick={onClose}>
          <span className="glyph" aria-hidden="true">
            ✕
          </span>
          <VisuallyHidden>Close navigation</VisuallyHidden>
        </button>

        {/* The wordmark carries the product name, so the image is the accessible
            name of this link and the square mark is only the collapsed-rail
            stand-in. The tenant's own name stays beneath it: with two tenants
            open side by side, the logo alone would make the two sidebars
            identical. */}
        <Link className="brand" href="/">
                    {/* A plain `img`, not `next/image`.
              `next/image` writes `style="color:transparent"` onto the tag to
              hide alt text while the file loads, and a style *attribute* is
              exactly what `style-src 'self'` forbids — so every page logged a
              violation for it. A policy that cries wolf on every load is one
              whose reports stop being read, and widening the policy to admit a
              framework's convenience would be paying for that convenience with
              the guarantee.
              Nothing is lost here: a fixed-size local wordmark gains no
              responsive `srcset` worth a second request, and `priority` had
              already turned the lazy loading off. It also takes this off the
              `/_next/image` path, and with it `sharp`. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="brand-logo"
            src="/img/logo.png"
            alt="TopTutorsForUs"
            width={1688}
            height={381}
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
          sidebar so the stylesheet can select it from the sidebar's own state,
          and inert above the breakpoint where nothing is covering anything.
          Hidden from assistive technology, which reaches the same result
          through the close button and Escape. */}
      <button
        type="button"
        className="drawer-backdrop"
        tabIndex={-1}
        aria-hidden="true"
        onClick={onClose}
      />
    </>
  );
}
