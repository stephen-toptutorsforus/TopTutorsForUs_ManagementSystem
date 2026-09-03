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
  { kind: "divider" },
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
      {
        kind: "item",
        label: "Availability",
        href: "/availability",
        icon: "◷",
        permissions: [P.AVAILABILITY_VIEW_OWN, P.AVAILABILITY_VIEW_ANY],
      },
      {
        kind: "item",
        label: "Audit trail",
        href: "/audit",
        icon: "◫",
        permissions: [P.AUDIT_VIEW],
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
      { kind: "item", label: "Subscription", href: "", icon: "◎", pending: "Phase 4" },
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
