/**
 * Authorization: the permission catalogue, the floor rule, and per-object policy.
 *
 * Ported case for case from `tests/test_authorization.py`. The database-backed
 * half — principal loading and tenant scoping — lives in
 * `tests/db/authorization.test.ts`, because this suite must run on a machine
 * with no Postgres.
 *
 * The tests that matter most here are the negative ones. A system that grants
 * the right things but also grants one wrong thing is not partially correct.
 */

import { describe, expect, it } from "vitest";

import { Role, SessionStatus } from "@/generated/prisma/enums";
import { Forbidden } from "@/lib/errors";
import type { SettingsReader } from "@/lib/organization";
import {
  ALL_PERMISSIONS,
  Permission as P,
  codeDefault,
  resolve,
} from "@/lib/policies/permissions";
import { Principal } from "@/lib/policies/principal";
import {
  type SessionLike,
  availableActions,
  canCancel,
  canCorrectActualTimes,
  canEdit,
  canEditSeries,
  canMarkAttendance,
  canView,
} from "@/lib/policies/sessions";

const NY = "America/New_York";

/** A principal built directly, for policy tests that need no database. */
function principalWith(
  roles: Role[],
  { orgId = 1n, userId = 1n }: { orgId?: bigint; userId?: bigint } = {},
): Principal {
  const roleSet = new Set(roles);
  return new Principal({
    userId,
    userRef: "usr_test",
    organizationId: orgId,
    organizationRef: "org_test",
    displayName: "Test Person",
    roles: roleSet,
    permissions: resolve(roleSet),
    regionIds: new Set(),
    timezone: NY,
  });
}

function aSession(
  overrides: Partial<SessionLike> & { start?: Date } = {},
): SessionLike {
  const { start, ...rest } = overrides;
  const scheduledStart = start ?? new Date(Date.now() + 7 * 86_400_000);
  return {
    organizationId: 1n,
    instructorId: 9n,
    status: SessionStatus.SCHEDULED,
    scheduledStart,
    seriesId: null,
    ...rest,
  };
}

/** An organization row carrying only what a policy reads off it. */
function anOrganization(settings: Record<string, unknown> = {}) {
  return { settings, features: {} };
}

// --- The catalogue ---------------------------------------------------------

describe("the catalogue", () => {
  it("grants an administrator every permission", () => {
    expect(codeDefault([Role.ADMIN])).toEqual(new Set(ALL_PERMISSIONS));
  });

  it.each([
    [Role.REGIONAL_ADMIN, P.ORG_CONFIGURE],
    [Role.REGIONAL_ADMIN, P.SESSION_DELETE],
    [Role.REGIONAL_ADMIN, P.SESSION_OVERRIDE_CONFLICT],
    [Role.INSTRUCTOR, P.SESSION_VIEW_ANY],
    [Role.INSTRUCTOR, P.SESSION_EDIT_ANY],
    [Role.INSTRUCTOR, P.ATTENDANCE_MARK_ANY],
    [Role.INSTRUCTOR, P.AUDIT_VIEW],
    [Role.INSTRUCTOR, P.EXPORT_SESSIONS],
    [Role.INSTRUCTOR, P.USER_MANAGE],
    [Role.STUDENT, P.SESSION_VIEW_ANY],
    [Role.STUDENT, P.ATTENDANCE_MARK_OWN],
    [Role.STUDENT, P.USER_VIEW],
    [Role.PARENT, P.SESSION_EDIT_ANY],
    [Role.PARENT, P.AUDIT_VIEW],
    [Role.PAYER, P.SESSION_BOOK],
  ])("bounds %s away from %s", (role, forbidden) => {
    expect(codeDefault([role]).has(forbidden)).toBe(false);
  });

  it("grants the union when a person holds two roles", () => {
    const both = codeDefault([Role.PARENT, Role.INSTRUCTOR]);

    expect(both.has(P.AVAILABILITY_EDIT_OWN)).toBe(true); // from the instructor role
    expect(both.has(P.SESSION_BOOK)).toBe(true);
    // Neither role grants it, so the union must not.
    expect(both.has(P.SESSION_VIEW_ANY)).toBe(false);
  });
});

// --- The floor rule --------------------------------------------------------

/**
 * Stands in for an organization's settings reader.
 *
 * Deliberately answers only what it was given, with no fallback to the shipped
 * defaults. A real organization resolves every unconfigured key to its default,
 * and mixing that in here would test the defaults rather than the rule.
 */
function fakeOrg(values: Record<string, unknown>): SettingsReader {
  return { setting: (path, fallback) => values[path.join(".")] ?? fallback };
}

describe("the floor rule", () => {
  it("lets configuration remove a permission", () => {
    const org = fakeOrg({ "booking.who_can_book": ["admin"] });

    expect(resolve([Role.INSTRUCTOR], org).has(P.SESSION_BOOK)).toBe(false);
    expect(resolve([Role.ADMIN], org).has(P.SESSION_BOOK)).toBe(true);
  });

  it("never lets configuration add a permission the code default withholds", () => {
    // Listing a role in every setting must not widen it.
    const org = fakeOrg({
      "booking.who_can_book": ["student"],
      "booking.who_can_create_historical": ["student"],
      "booking.who_can_delete": ["student"],
      "booking.conflict_override_roles": ["student"],
      "booking.who_can_edit": ["student"],
      "booking.who_can_cancel": ["student"],
    });
    const effective = resolve([Role.STUDENT], org);
    const ceiling = codeDefault([Role.STUDENT]);

    for (const permission of effective) expect(ceiling.has(permission)).toBe(true);
    expect(effective.has(P.SESSION_DELETE)).toBe(false);
    expect(effective.has(P.SESSION_OVERRIDE_CONFLICT)).toBe(false);
    expect(effective.has(P.SESSION_BOOK_HISTORICAL)).toBe(false);
  });

  it("gives an unconfigured tenant the code defaults", () => {
    expect(resolve([Role.INSTRUCTOR], null)).toEqual(codeDefault([Role.INSTRUCTOR]));
  });

  it("lets cancellation be withdrawn from instructors by configuration", () => {
    const org = fakeOrg({ "booking.who_can_cancel": ["admin", "regional_admin"] });

    expect(resolve([Role.INSTRUCTOR], org).has(P.SESSION_CANCEL_OWN)).toBe(false);
  });
});

// --- Per-object policy -----------------------------------------------------

describe("per-object policy", () => {
  it("shows a caller from another tenant no such session", () => {
    const outsider = principalWith([Role.ADMIN], { orgId: 2n });
    const decision = canView(outsider, aSession({ organizationId: 1n }));

    expect(decision.allowed).toBe(false);
    // Must not confirm the record exists.
    expect(decision.reason).toBe("no such session");
  });

  it("shows an instructor only sessions they are on", () => {
    const instructor = principalWith([Role.INSTRUCTOR], { userId: 9n });
    const theirs = aSession({ instructorId: 9n });
    const someoneElses = aSession({ instructorId: 10n });

    expect(canView(instructor, theirs, { participantUserIds: [9n] }).allowed).toBe(true);
    expect(canView(instructor, someoneElses, { participantUserIds: [10n] }).allowed).toBe(
      false,
    );
  });

  it("shows a guardian their child's session", () => {
    const parent = principalWith([Role.PARENT], { userId: 20n });
    const session = aSession({ instructorId: 9n });

    expect(
      canView(parent, session, { participantUserIds: [9n, 31n], guardianOfIds: [31n] })
        .allowed,
    ).toBe(true);
    expect(
      canView(parent, session, { participantUserIds: [9n, 32n], guardianOfIds: [31n] })
        .allowed,
    ).toBe(false);
  });

  it("lets an instructor edit their own session but not another's", () => {
    const instructor = principalWith([Role.INSTRUCTOR], { userId: 9n });

    expect(canEdit(instructor, aSession({ instructorId: 9n })).allowed).toBe(true);
    expect(canEdit(instructor, aSession({ instructorId: 10n })).allowed).toBe(false);
  });

  it("offers no cancellation on a completed session", () => {
    // Status gates the action regardless of permission.
    const admin = principalWith([Role.ADMIN]);
    const org = anOrganization();
    const completed = aSession({ status: SessionStatus.COMPLETED });

    const decision = canCancel(admin, completed, org);
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("completed");
    expect(availableActions(admin, completed, org)).not.toContain("cancel");
  });

  it("still admits attendance and correction on a completed session", () => {
    const admin = principalWith([Role.ADMIN]);
    const org = anOrganization();
    const completed = aSession({ status: SessionStatus.COMPLETED });

    expect(canMarkAttendance(admin, completed).allowed).toBe(true);
    expect(canCorrectActualTimes(admin, completed).allowed).toBe(true);
    expect(availableActions(admin, completed, org)).toContain("correct_actuals");
  });

  it("does not let an instructor correct recorded times", () => {
    const instructor = principalWith([Role.INSTRUCTOR], { userId: 9n });
    const completed = aSession({ instructorId: 9n, status: SessionStatus.COMPLETED });

    expect(canCorrectActualTimes(instructor, completed).allowed).toBe(false);
  });

  it("binds an instructor to the cancellation window but not an administrator", () => {
    const org = anOrganization({ booking: { cancellation_window_hours: 24 } });
    const soon = aSession({ instructorId: 9n, start: new Date(Date.now() + 3 * 3_600_000) });

    expect(
      canCancel(principalWith([Role.INSTRUCTOR], { userId: 9n }), soon, org).allowed,
    ).toBe(false);
    expect(canCancel(principalWith([Role.ADMIN]), soon, org).allowed).toBe(true);
  });

  it("permits a cancellation far enough ahead of the window", () => {
    const org = anOrganization({ booking: { cancellation_window_hours: 24 } });
    const later = aSession({ instructorId: 9n, start: new Date(Date.now() + 5 * 86_400_000) });

    expect(
      canCancel(principalWith([Role.INSTRUCTOR], { userId: 9n }), later, org).allowed,
    ).toBe(true);
  });

  it("separates editing a series from editing a session", () => {
    const instructor = principalWith([Role.INSTRUCTOR], { userId: 9n });
    const session = aSession({ instructorId: 9n, seriesId: 5n });

    // May edit this one occurrence...
    expect(canEdit(instructor, session).allowed).toBe(true);
    // ...but not the whole series.
    expect(canEditSeries(instructor, session).allowed).toBe(false);
    expect(canEditSeries(principalWith([Role.ADMIN]), session).allowed).toBe(true);
  });

  it("has no series to edit on a standalone session", () => {
    const decision = canEditSeries(principalWith([Role.ADMIN]), aSession({ seriesId: null }));

    expect(decision.allowed).toBe(false);
    expect(decision.reason).toContain("not part of a series");
  });

  it("narrows the action list with the role", () => {
    const org = anOrganization();
    const session = aSession({ instructorId: 9n });

    const adminActions = new Set(availableActions(principalWith([Role.ADMIN]), session, org));
    const instructorActions = new Set(
      availableActions(principalWith([Role.INSTRUCTOR], { userId: 9n }), session, org),
    );

    expect(adminActions.has("delete")).toBe(true);
    expect(instructorActions.has("delete")).toBe(false);
    // A proper subset: everything the instructor may do, the admin may too.
    for (const action of instructorActions) expect(adminActions.has(action)).toBe(true);
    expect(instructorActions.size).toBeLessThan(adminActions.size);
  });
});

// --- The refusal itself ----------------------------------------------------

describe("refusals", () => {
  it("names the permission and not the record", () => {
    const student = principalWith([Role.STUDENT]);

    expect(() => student.require(P.AUDIT_VIEW)).toThrow(Forbidden);
    expect(() => student.require(P.AUDIT_VIEW)).toThrow("audit.view");
  });

  it("picks the widest role a person holds as their primary one", () => {
    expect(principalWith([Role.PARENT, Role.INSTRUCTOR]).primaryRole).toBe(Role.INSTRUCTOR);
    expect(principalWith([Role.STUDENT, Role.ADMIN]).primaryRole).toBe(Role.ADMIN);
  });

  it("names reschedule separately from edit", () => {
    // `ACTIONS_BY_STATUS` always said an in-progress session admits `edit` and
    // not `reschedule`. Nothing ever asked: the service checked canEdit, and
    // availableActions never emitted the word, so the page had no flag to gate
    // on either. The rule was written down and never enforced.
    const admin = principalWith([Role.ADMIN]);
    const org = anOrganization();

    const scheduled = aSession({ status: SessionStatus.SCHEDULED });
    const running = aSession({ status: SessionStatus.IN_PROGRESS });

    expect(availableActions(admin, scheduled, org)).toContain("reschedule");

    const offered = availableActions(admin, running, org);
    // Editing an in-progress session is still allowed.
    expect(offered).toContain("edit");
    expect(offered).not.toContain("reschedule");
  });
});
