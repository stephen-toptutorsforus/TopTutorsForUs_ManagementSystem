/**
 * The sidebar.
 *
 * Ported from the navigation half of `app/web/rendering.py`. Declared as data
 * rather than assembled with nested conditionals, so what a role sees is
 * readable in one place. Two rules it follows:
 *
 * 1. **Nothing is offered that cannot be opened.** An item appears only if the
 *    viewer holds its permission and the route exists.
 * 2. **A section for unbuilt work is shown, but not as a link.** The product's
 *    shape is worth communicating; a dead link is not. Those rows are inert and
 *    say which phase they belong to, so nobody clicks hopefully.
 */

import { Permission } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";

interface NavItemSpec {
  kind: "item";
  label: string;
  href: string;
  icon: string;
  /** Any one of these is enough; empty means always. */
  permissions?: readonly Permission[];
  /**
   * Any one of these hides the entry, whatever `permissions` says.
   *
   * For the case where one route is worth two different entries — "My
   * availability" for somebody looking at their own hours, "Instructor
   * availability" for somebody looking at everybody's. A permission list alone
   * cannot separate them, because `ADMIN` is granted *every* permission, so an
   * administrator would match both and be shown the same page twice under two
   * names. It is also what keeps `titleFor` deterministic: two entries sharing
   * an `href` have equal length, and the tie-break below takes whichever was
   * declared first rather than whichever this person can actually open.
   */
  unless?: readonly Permission[];
  /** Set when the entry belongs to a phase that is not built. Renders inert. */
  pending?: string;
}

interface NavGroupSpec {
  kind: "group";
  label: string;
  icon: string;
  items?: readonly NavItemSpec[];
  pending?: string;
}

/** A rule between groups of entries. Purely visual, and marked as such. */
interface NavDividerSpec {
  kind: "divider";
}

type NavSpec = NavItemSpec | NavGroupSpec | NavDividerSpec;

const P = Permission;

const NAV_MAIN: readonly NavSpec[] = [
  { kind: "item", label: "Insights", href: "/", icon: "◈" },
  {
    kind: "item",
    label: "Calendar",
    href: "/calendar",
    icon: "▤",
    permissions: [P.SESSION_VIEW_ANY, P.SESSION_VIEW_OWN],
  },
  {
    kind: "item",
    label: "Booking",
    href: "/sessions/new",
    icon: "＋",
    permissions: [P.SESSION_BOOK],
  },
  // An instructor's own hours are a daily destination rather than a record to
  // look up, so they sit beside Calendar and Booking. The same route appears
  // under People & Organization for whoever manages everybody's — see `unless`.
  {
    kind: "item",
    label: "My Availability",
    href: "/availability",
    icon: "◷",
    permissions: [P.AVAILABILITY_EDIT_OWN],
    unless: [P.AVAILABILITY_EDIT_ANY],
  },
  { kind: "divider" },
  // Two entries, because a session and a series are the two things this
  // section is about. Availability and the audit trail were here as well and
  // are neither: when an instructor works is a fact about the instructor, and
  // who changed what is a compliance record rather than an operational list.
  {
    kind: "group",
    label: "Session Management",
    icon: "≡",
    items: [
      {
        kind: "item",
        label: "Sessions",
        href: "/sessions",
        icon: "≡",
        permissions: [P.SESSION_VIEW_ANY, P.SESSION_VIEW_OWN],
      },
      {
        kind: "item",
        label: "Series",
        href: "/series",
        icon: "⟳",
        permissions: [P.SESSION_VIEW_ANY, P.SESSION_VIEW_OWN],
      },
    ],
  },
  {
    kind: "group",
    label: "People & Organization",
    icon: "◍",
    items: [
      { kind: "item", label: "People", href: "/people", icon: "◍", permissions: [P.USER_VIEW] },
      {
        kind: "item",
        label: "Groups",
        href: "/groups",
        icon: "◍",
        permissions: [P.STRUCTURE_VIEW],
      },
      {
        kind: "item",
        label: "Locations",
        href: "/locations",
        icon: "⌂",
        permissions: [P.STRUCTURE_VIEW],
      },
      // Availability belongs to the person being scheduled, so for anybody who
      // may edit everybody's it is filed with the people rather than with the
      // sessions.
      {
        kind: "item",
        label: "Instructor Availability",
        href: "/availability",
        icon: "◷",
        permissions: [P.AVAILABILITY_EDIT_ANY],
      },
      { kind: "item", label: "Subscription", href: "", icon: "◎", pending: "Phase 4" },
    ],
  },
  {
    kind: "group",
    label: "Administration",
    icon: "◫",
    items: [
      {
        kind: "item",
        label: "Audit trail",
        href: "/audit",
        icon: "◫",
        permissions: [P.AUDIT_VIEW],
      },
    ],
  },
];

const NAV_FOOTER: readonly NavSpec[] = [
  { kind: "group", label: "Configuration", icon: "⚙", pending: "Phase 2" },
  { kind: "item", label: "Help Center", href: "/help", icon: "?" },
];

// --- What a render produces --------------------------------------------------

export interface RenderedItem {
  kind: "item";
  label: string;
  href: string;
  icon: string;
  current: boolean;
}

export interface RenderedPending {
  kind: "pending";
  label: string;
  icon: string;
  note: string;
}

export interface RenderedGroup {
  kind: "group";
  label: string;
  icon: string;
  items: (RenderedItem | RenderedPending)[];
  /** Open the section the viewer is currently inside. */
  open: boolean;
}

export interface RenderedDivider {
  kind: "divider";
}

export type RenderedEntry =
  | RenderedItem
  | RenderedPending
  | RenderedGroup
  | RenderedDivider;

export interface Navigation {
  main: RenderedEntry[];
  footer: RenderedEntry[];
}

/** Whether this person can open the item at all. */
function visible(item: NavItemSpec, principal: Principal): boolean {
  if (item.unless && item.unless.length > 0 && principal.hasAny(...item.unless)) return false;
  if (!item.permissions || item.permissions.length === 0) return true;
  return principal.hasAny(...item.permissions);
}

function renderItem(
  item: NavItemSpec,
  principal: Principal,
  currentPath: string,
): RenderedItem | RenderedPending | null {
  if (item.pending) {
    return { kind: "pending", label: item.label, icon: item.icon, note: item.pending };
  }
  if (!visible(item, principal)) return null;
  return {
    kind: "item",
    label: item.label,
    href: item.href,
    icon: item.icon,
    current: currentPath === item.href,
  };
}

function renderNav(
  entries: readonly NavSpec[],
  principal: Principal,
  currentPath: string,
): RenderedEntry[] {
  const rendered: RenderedEntry[] = [];

  for (const entry of entries) {
    if (entry.kind === "divider") {
      rendered.push({ kind: "divider" });
      continue;
    }

    if (entry.kind === "item") {
      const item = renderItem(entry, principal, currentPath);
      if (item) rendered.push(item);
      continue;
    }

    if (entry.pending) {
      rendered.push({
        kind: "pending",
        label: entry.label,
        icon: entry.icon,
        note: entry.pending,
      });
      continue;
    }

    const items = (entry.items ?? [])
      .map((item) => renderItem(item, principal, currentPath))
      .filter((item): item is RenderedItem | RenderedPending => item !== null);

    // A section with nothing openable in it is not shown at all — an expander
    // holding only unavailable rows is a worse answer than no expander.
    if (!items.some((item) => item.kind === "item")) continue;

    rendered.push({
      kind: "group",
      label: entry.label,
      icon: entry.icon,
      items,
      open: items.some((item) => item.kind === "item" && item.current),
    });
  }

  return rendered;
}

/** The sidebar for this person: main sections and footer sections. */
export function navigation(
  principal: Principal | null,
  currentPath = "",
): Navigation {
  if (principal === null) return { main: [], footer: [] };
  return {
    main: renderNav(NAV_MAIN, principal, currentPath),
    footer: renderNav(NAV_FOOTER, principal, currentPath),
  };
}

/**
 * What to call the page at this path.
 *
 * The mobile header needs a title, and the navigation already holds one for
 * every route that has an entry — a separate registry would be a second list
 * to keep in step with this one, and it would drift.
 *
 * Longest matching prefix, so a detail route takes the name of the section it
 * belongs to: `/sessions/ses_x` reads "Sessions". `/` is matched exactly, since
 * as a prefix it matches everything.
 */
export function titleFor(nav: Navigation, path: string): string | null {
  let best: string | null = null;
  let longest = -1;

  const consider = (entry: RenderedEntry): void => {
    if (entry.kind === "group") {
      entry.items.forEach(consider);
      return;
    }
    if (entry.kind !== "item") return;

    const matches =
      entry.href === "/" ? path === "/" : path === entry.href || path.startsWith(`${entry.href}/`);
    if (matches && entry.href.length > longest) {
      longest = entry.href.length;
      best = entry.label;
    }
  };

  [...nav.main, ...nav.footer].forEach(consider);
  return best;
}
