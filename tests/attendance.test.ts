/**
 * The attendance rate.
 *
 * Ported from the pure case in `tests/test_booking.py`. The rule worth pinning
 * is that an excused absence leaves the denominator — which is the whole reason
 * the state exists, since an authorised absence should not read as a failure to
 * attend.
 */

import { describe, expect, it } from "vitest";

import { AttendanceStatus, ParticipantRole } from "@/generated/prisma/enums";
import type { Participant } from "@/lib/services/sessionOps";
import {
  actualDurationMinutes,
  attendanceRate,
  scheduledDurationMinutes,
} from "@/lib/services/sessionOps";

function participant(
  attendance: AttendanceStatus,
  role: ParticipantRole = ParticipantRole.STUDENT,
): Participant {
  return {
    id: 1n,
    organizationId: 1n,
    sessionId: 1n,
    userId: 1n,
    role,
    attendance,
    joinedAt: null,
    leftAt: null,
    attendedMinutes: null,
    markedById: null,
    markedAt: null,
    markedSource: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("attendanceRate", () => {
  const bothPresent = [
    participant(AttendanceStatus.PRESENT),
    participant(AttendanceStatus.PRESENT),
  ];

  it("is one when everybody expected attended", () => {
    expect(attendanceRate(bothPresent)).toBe(1);
  });

  it("leaves an excused absence out of the denominator", () => {
    expect(attendanceRate([...bothPresent, participant(AttendanceStatus.EXCUSED)])).toBe(1);
  });

  it("counts an unexplained absence against the rate", () => {
    expect(attendanceRate([...bothPresent, participant(AttendanceStatus.ABSENT)])).toBeCloseTo(
      2 / 3,
    );
  });

  it("ignores unmarked participants — nobody has judged them yet", () => {
    expect(attendanceRate([...bothPresent, participant(AttendanceStatus.UNMARKED)])).toBe(1);
  });

  it("ignores the instructor", () => {
    expect(
      attendanceRate([
        ...bothPresent,
        participant(AttendanceStatus.ABSENT, ParticipantRole.INSTRUCTOR),
      ]),
    ).toBe(1);
  });

  it("is null when nobody has been judged at all", () => {
    expect(attendanceRate([participant(AttendanceStatus.UNMARKED)])).toBeNull();
    expect(attendanceRate([])).toBeNull();
  });

  it("counts late and left-early as having been there", () => {
    expect(
      attendanceRate([
        participant(AttendanceStatus.LATE),
        participant(AttendanceStatus.LEFT_EARLY),
        participant(AttendanceStatus.INCOMPLETE),
      ]),
    ).toBe(1);
  });
});

describe("durations", () => {
  const at = (iso: string) => new Date(iso);

  it("reads the scheduled length off the schedule", () => {
    expect(
      scheduledDurationMinutes({
        scheduledStart: at("2026-04-06T20:00:00Z"),
        scheduledEnd: at("2026-04-06T21:00:00Z"),
      }),
    ).toBe(60);
  });

  it("says nothing rather than guessing when a session has not run", () => {
    // "We do not know" and "it ran exactly as booked" are different facts, and
    // a report that conflates them is wrong in the direction that flatters.
    expect(actualDurationMinutes({ actualStart: null, actualEnd: null })).toBeNull();
    expect(
      actualDurationMinutes({ actualStart: at("2026-04-06T20:00:00Z"), actualEnd: null }),
    ).toBeNull();
  });

  it("reports the actual length once both ends are known", () => {
    expect(
      actualDurationMinutes({
        actualStart: at("2026-04-06T20:05:00Z"),
        actualEnd: at("2026-04-06T20:50:00Z"),
      }),
    ).toBe(45);
  });
});
