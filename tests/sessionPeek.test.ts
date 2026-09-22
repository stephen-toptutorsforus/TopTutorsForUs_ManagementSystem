/**
 * What the calendar's modal is told about a session.
 *
 * The interesting case is the one that was wrong. The modal used to draw its
 * buttons from two page-wide booleans — "may this person edit sessions", "may
 * they cancel sessions" — so an administrator was offered "Cancel session" on a
 * completed one. The permission was right and the answer was wrong: status
 * gates action, and only a per-session question can say so.
 *
 * `availableActions` is already tested exhaustively in `authorization.test.ts`.
 * What these cases pin is the *wiring* — that the answer reaches the modal per
 * session rather than being decided once — because that is the join that broke.
 */

import { describe, expect, it } from "vitest";

import { DeliveryType, Role, SessionStatus } from "@/generated/prisma/enums";
import { resolve } from "@/lib/policies/permissions";
import { Principal } from "@/lib/policies/principal";
import { availableActions } from "@/lib/policies/sessions";
import type { SessionRow } from "@/lib/services/sessionQuery";
import { peekOf } from "@/lib/web/sessionPeek";

const NY = "America/New_York";

function anAdmin(): Principal {
  const roles = new Set([Role.ADMIN]);
  return new Principal({
    userId: 1n,
    userRef: "usr_test",
    organizationId: 1n,
    organizationRef: "org_test",
    displayName: "Test Person",
    roles,
    permissions: resolve(roles),
    regionIds: new Set(),
    timezone: NY,
  });
}

const anOrganization = () => ({ settings: {}, features: {} });

/**
 * A calendar row, carrying the fields `peekOf` and the policies read and no
 * others. Cast rather than built whole: the Prisma model has some forty
 * columns, and a fixture that listed them all would obscure which handful this
 * behaviour actually depends on.
 */
function aRow(
  overrides: {
    status?: SessionStatus;
    seriesId?: bigint | null;
    seriesPosition?: string | null;
    meetingUrl?: string | null;
    classroomConfig?: unknown;
  } = {},
): SessionRow {
  const start = new Date(Date.now() + 7 * 86_400_000);
  return {
    session: {
      ref: "ses_test",
      title: "Algebra",
      description: null,
      organizationId: 1n,
      instructorId: 9n,
      status: overrides.status ?? SessionStatus.SCHEDULED,
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + 3_600_000),
      timezone: NY,
      deliveryType: DeliveryType.EXTERNAL_LINK,
      meetingUrl: overrides.meetingUrl ?? null,
      classroomConfig: overrides.classroomConfig ?? {},
      locationDetail: null,
      seriesId: overrides.seriesId ?? null,
    },
    instructorName: "Rowan Mercer",
    studentNames: ["Teo Vasquez"],
    locationName: null,
    subjectName: null,
    gradeName: null,
    attendanceRate: null,
    seriesPosition: overrides.seriesPosition ?? null,
  } as unknown as SessionRow;
}

/** The calendar's own call, in one place so a test cannot drift from the page. */
function peekAsAdmin(row: SessionRow) {
  const principal = anAdmin();
  return peekOf(row, "Online", availableActions(principal, row.session, anOrganization()), NY);
}

describe("which clock the dialog reads in", () => {
  it("uses the reader's zone, not the one the session was booked in", () => {
    // The dialog opens from a chip on a grid that was laid out in the reader's
    // zone, so it has to agree with the chip it came from — otherwise pressing
    // a block drawn at ten o'clock opens a panel that says nine.
    //
    // The session's own zone is still what the record screens and the API
    // render, and it still rides along in this label's zone abbreviation, so
    // nothing is hidden: a calendar shows your clock, a record shows its own.
    const row = aRow();
    const chicago = peekOf(row, "Online", [], "America/Chicago");
    const newYork = peekOf(row, "Online", [], NY);

    expect(newYork.startLabel).not.toBe(chicago.startLabel);
    expect(chicago.startLabel).toContain("CDT");
    expect(newYork.startLabel).toContain("EDT");
  });
});

describe("what the modal is told it may do", () => {
  it("carries this session's own answer, not the page's", () => {
    const row = aRow();
    const expected = availableActions(anAdmin(), row.session, anOrganization());

    expect(peekAsAdmin(row).actions).toEqual(expected);
  });

  it("offers cancelling and editing a scheduled session", () => {
    const actions = peekAsAdmin(aRow()).actions;

    expect(actions).toContain("cancel");
    expect(actions).toContain("edit");
  });

  it("does not offer cancelling a completed session, to anybody", () => {
    // The regression. An administrator holds every cancel permission there is;
    // the status is what refuses, and the modal has to hear it.
    const actions = peekAsAdmin(aRow({ status: SessionStatus.COMPLETED })).actions;

    expect(actions).not.toContain("cancel");
  });

  it("does not offer editing a cancelled session", () => {
    const actions = peekAsAdmin(aRow({ status: SessionStatus.CANCELLED })).actions;

    expect(actions).not.toContain("edit");
    expect(actions).not.toContain("cancel");
  });

  it("offers the series only where there is one", () => {
    // `edit_series` answers both halves at once — `canEditSeries` refuses a
    // session with no series before it consults the permission — so the modal
    // needs no second test, and must not use `seriesPosition` as one.
    const alone = peekAsAdmin(aRow());
    const inSeries = peekAsAdmin(aRow({ seriesId: 4n, seriesPosition: "2 of 8" }));

    expect(alone.actions).not.toContain("edit_series");
    expect(inSeries.actions).toContain("edit_series");
  });

  it("hands the host start URL only to somebody who may start", () => {
    const row = aRow({
      meetingUrl: "https://meet.example.test/zoom/1",
      classroomConfig: {
        provider: "mock",
        meetingId: "mock-1",
        startUrl: "https://meet.example.test/zoom/1/host",
      },
    });

    expect(peekOf(row, "Online", [], NY, false).hostStartUrl).toBeNull();
    expect(peekOf(row, "Online", [], NY, true).hostStartUrl).toBe(
      "https://meet.example.test/zoom/1/host",
    );
  });

  it("still offers the series when the position has no label", () => {
    // A session can belong to a series and have no index, and then
    // `seriesPosition` is null while the series is entirely real. The old
    // control was gated on that label and disappeared here.
    const unlabelled = peekAsAdmin(aRow({ seriesId: 4n, seriesPosition: null }));

    expect(unlabelled.actions).toContain("edit_series");
    expect(unlabelled.seriesPosition).toBeNull();
  });
});
