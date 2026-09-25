/**
 * What each role is offered in the sidebar.
 *
 * `navigation.ts` had no test at all, which is how its own first rule —
 * "nothing is offered that cannot be opened" — came to be broken by the Series
 * entry without anybody noticing, and how Availability and the audit trail sat
 * for months inside a section about neither.
 *
 * The case worth writing a file for is `unless`. One route is worth two
 * entries here — an instructor looking at their own hours and a coordinator
 * looking at everybody's want different words for the same page — and a
 * permission list alone cannot separate them, because `ADMIN` is granted every
 * permission in the catalogue. A gate that only says "who may" therefore shows
 * an administrator both labels, pointing at one page. That is the assertion
 * below that fails first if the exclusion is ever dropped.
 */

import { describe, expect, it } from "vitest";

import { Role } from "@/generated/prisma/enums";
import { type Navigation, type RenderedEntry, navigation, titleFor } from "@/lib/navigation";
import { DEFAULT_SETTINGS, type SettingsReader, settingsReader } from "@/lib/organization";
import { resolve } from "@/lib/policies/permissions";
import { Principal } from "@/lib/policies/principal";

function principalWith(roles: Role[], reader?: SettingsReader): Principal {
  const roleSet = new Set(roles);
  return new Principal({
    userId: 1n,
    userRef: "usr_test",
    organizationId: 1n,
    organizationRef: "org_test",
    displayName: "Test Person",
    roles: roleSet,
    permissions: resolve(roleSet, reader),
    regionIds: new Set(),
    timezone: "America/New_York",
  });
}

const navFor = (...roles: Role[]): Navigation => navigation(principalWith(roles));
const shipped = settingsReader({ settings: DEFAULT_SETTINGS });

/** Every openable label, group children included, in the order they render. */
function labels(nav: Navigation): string[] {
  const found: string[] = [];
  const walk = (entry: RenderedEntry): void => {
    if (entry.kind === "group") entry.items.forEach(walk);
    else if (entry.kind === "item") found.push(entry.label);
  };
  [...nav.main, ...nav.footer].forEach(walk);
  return found;
}

/** The children of one section, which is what "is it filed here" means. */
function section(nav: Navigation, label: string): string[] {
  for (const entry of nav.main) {
    if (entry.kind === "group" && entry.label === label) {
      return entry.items.filter((item) => item.kind === "item").map((item) => item.label);
    }
  }
  return [];
}

describe("what the sidebar offers", () => {
  it("shows an administrator one availability entry, not two", () => {
    // The `unless` case. An administrator holds `AVAILABILITY_EDIT_OWN` as well
    // as `EDIT_ANY` — they hold everything — so without the exclusion this is
    // the same page listed twice under two names.
    const shown = labels(navFor(Role.ADMIN));
    expect(shown).toContain("Instructor Availability");
    expect(shown).not.toContain("My Availability");
    expect(shown.filter((label) => label.toLowerCase().includes("availability"))).toHaveLength(1);
  });

  it("shows an instructor their own hours, at the top", () => {
    const nav = navFor(Role.INSTRUCTOR);
    expect(labels(nav)).toContain("My Availability");
    expect(labels(nav)).not.toContain("Instructor Availability");
    // Top level rather than inside a section: an instructor's own hours are a
    // daily destination, and a destination behind an expander is one press
    // further away every time.
    const top = nav.main.filter((entry) => entry.kind === "item").map((entry) => entry.label);
    expect(top).toContain("My Availability");
  });

  it("gives a regional administrator the roster view and the audit trail", () => {
    const shown = labels(navFor(Role.REGIONAL_ADMIN));
    expect(shown).toContain("Instructor Availability");
    expect(shown).toContain("Audit trail");
    // They hold `AVAILABILITY_EDIT_ANY` and not `EDIT_OWN`, which is the
    // asymmetry a gate written the other way round would get wrong.
    expect(shown).not.toContain("My Availability");
  });

  it("lets a student book and keeps a parent out of it", () => {
    // The code grant includes both. The shipped who_can_book list is what
    // takes Booking away from a parent.
    expect(labels(navigation(principalWith([Role.STUDENT], shipped)))).toContain("Booking");
    expect(labels(navigation(principalWith([Role.PARENT], shipped)))).not.toContain("Booking");
  });

  it("offers a student and a parent neither", () => {
    // They hold `AVAILABILITY_VIEW_ANY` so that they can read an instructor's
    // hours while booking, and the booking form is where they do it. A sidebar
    // entry called either of these names would describe somebody else's job.
    for (const role of [Role.STUDENT, Role.PARENT]) {
      const shown = labels(navFor(role));
      expect(shown.filter((label) => label.toLowerCase().includes("availability")), role).toEqual(
        [],
      );
    }
  });

  it("keeps Session Management to the two things it is about", () => {
    expect(section(navFor(Role.ADMIN), "Session Management")).toEqual(["Sessions", "Series"]);
  });

  it("files Schools with the rest of the place vocabulary", () => {
    expect(section(navFor(Role.ADMIN), "People & Organization")).toContain("Schools");
    expect(section(navFor(Role.ADMIN), "People & Organization")).toContain("Locations");
    expect(labels(navFor(Role.STUDENT))).not.toContain("Schools");
  });

  it("files the audit trail under Administration, and shows it to nobody else", () => {
    expect(section(navFor(Role.ADMIN), "Administration")).toEqual([
      "Audit trail",
      "Import",
      "Reminders",
      "Inbox",
    ]);
    for (const role of [Role.INSTRUCTOR, Role.STUDENT, Role.PARENT, Role.PAYER]) {
      expect(labels(navFor(role)), role).not.toContain("Audit trail");
    }
  });

  it("offers an import to administrators and to nobody else at all", () => {
    // Including a regional administrator, who holds the widest grant of any
    // role that is listed permission by permission — `DATA_IMPORT` reaches
    // `ADMIN` only because `ADMIN` is granted the whole catalogue, so this is
    // the assertion that nothing quietly widened it.
    expect(labels(navFor(Role.ADMIN))).toContain("Import");
    for (const role of [
      Role.REGIONAL_ADMIN,
      Role.INSTRUCTOR,
      Role.STUDENT,
      Role.PARENT,
      Role.PAYER,
    ]) {
      expect(labels(navFor(role)), role).not.toContain("Import");
    }
    expect(section(navFor(Role.REGIONAL_ADMIN), "Administration")).toEqual([
      "Audit trail",
      "Inbox",
    ]);
  });

  it("drops a section with nothing openable in it", () => {
    // A payer sees no Administration expander at all rather than an empty one.
    const nav = navFor(Role.PAYER);
    expect(nav.main.some((entry) => entry.kind === "group" && entry.label === "Administration")).toBe(
      false,
    );
  });

  it("offers nothing at all to somebody who is not signed in", () => {
    expect(navigation(null)).toEqual({ main: [], footer: [] });
  });
});

describe("what the mobile header calls the page", () => {
  it("names the availability page whatever that role reaches it by", () => {
    // Two entries share `/availability`, and `titleFor` breaks a tie by
    // declaration order rather than by who can open it — so if both were ever
    // visible at once this would silently return the wrong one. `unless` is
    // what keeps exactly one of them in play per viewer.
    expect(titleFor(navFor(Role.ADMIN), "/availability")).toBe("Instructor Availability");
    expect(titleFor(navFor(Role.INSTRUCTOR), "/availability")).toBe("My Availability");
    expect(titleFor(navFor(Role.STUDENT), "/availability")).toBeNull();
  });

  it("gives a detail route the name of the section it belongs to", () => {
    const nav = navFor(Role.ADMIN);
    expect(titleFor(nav, "/sessions/ses_abc")).toBe("Sessions");
    expect(titleFor(nav, "/series/ser_abc")).toBe("Series");
    expect(titleFor(nav, "/")).toBe("Insights");
  });
});
