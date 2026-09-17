"use client";

/**
 * Participants and attendance.
 *
 * Ported from the participants block of `app/templates/sessions/detail.html`.
 * Editable when the viewer may mark attendance, and a read-only table of badges
 * when they may not — the same rows either way, so the page does not change
 * shape depending on who is looking at it.
 */

import { useActionState } from "react";

import { recordAttendance } from "@/app/actions/sessions";
import { AttendanceBadge, Button, ButtonRow, Card, Hint, OptionSelect, TableWrap, WhenTime } from "@/components/ui";
import { AttendanceStatus } from "@/generated/prisma/enums";
import { CSRF_FIELD } from "@/lib/names";
import { attendanceMeta, durationLabel, percent } from "@/lib/presentation";

export interface ParticipantView {
  id: string;
  name: string;
  role: string;
  joinedAt: string | null;
  leftAt: string | null;
  attendedMinutes: number | null;
  attendance: AttendanceStatus;
}

const ATTENDANCE_OPTIONS = Object.values(AttendanceStatus);

export function AttendanceCard({
  sessionRef,
  csrfToken,
  timezone,
  participants,
  hidden = 0,
  attendanceRate,
  editable,
}: {
  sessionRef: string;
  csrfToken: string;
  timezone: string;
  participants: ParticipantView[];
  /**
   * How many participants this reader was not shown.
   *
   * A student or a guardian sees their own row rather than the register, and
   * the rate above is still computed over everybody — so without this the card
   * would show one name beside a rate that plainly came from more than one.
   */
  hidden?: number;
  attendanceRate: number | null;
  editable: boolean;
}) {
  const [state, submit] = useActionState(recordAttendance.bind(null, sessionRef), {});

  const table = (
    <TableWrap caption="Participants on this session">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Role</th>
          <th scope="col">Joined</th>
          <th scope="col">Left</th>
          <th scope="col">Attended</th>
          <th scope="col">Attendance</th>
        </tr>
      </thead>
      <tbody>
        {participants.map((participant) => (
          <tr key={participant.id}>
            <td data-label="Name">{participant.name}</td>
            <td data-label="Role">
              {participant.role.charAt(0) + participant.role.slice(1).toLowerCase()}
            </td>
            <td data-label="Joined">
              <WhenTime
                instant={participant.joinedAt ? new Date(participant.joinedAt) : null}
                zone={timezone}
              />
            </td>
            <td data-label="Left">
              <WhenTime
                instant={participant.leftAt ? new Date(participant.leftAt) : null}
                zone={timezone}
              />
            </td>
            <td data-label="Attended">{durationLabel(participant.attendedMinutes)}</td>
            <td data-label="Attendance">
              {editable ? (
                <>
                  <label className="visually-hidden" htmlFor={`att-${participant.id}`}>
                    Attendance for {participant.name}
                  </label>
                  <OptionSelect
                    id={`att-${participant.id}`}
                    name={`attendance_${participant.id}`}
                    defaultValue={participant.attendance}
                    options={ATTENDANCE_OPTIONS.map((option) => ({
                      value: option.toLowerCase(),
                      label: attendanceMeta(option).label,
                    }))}
                  />
                </>
              ) : (
                <AttendanceBadge status={participant.attendance} />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </TableWrap>
  );

  return (
    <Card>
      <h2>Participants and attendance</h2>
      <p className="subtitle">
        Overall attendance: <strong>{percent(attendanceRate)}</strong>{" "}
        <Hint>Excused absences are not counted against this rate.</Hint>
      </p>
      {hidden > 0 && (
        <p className="subtitle">
          <Hint>
            {hidden === 1
              ? "One other person is on this session."
              : `${hidden} other people are on this session.`}{" "}
            The rate above counts everybody.
          </Hint>
        </p>
      )}

      {state.error && (
        <p className="notice notice-bad" role="alert">
          <span aria-hidden="true">!</span> <span>{state.error}</span>
        </p>
      )}
      {state.notice && (
        <p className="notice notice-good">
          <span aria-hidden="true">✓</span> <span>{state.notice}</span>
        </p>
      )}

      {editable ? (
        <form action={submit}>
          <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
          {table}
          <ButtonRow>
            <Button variant="primary" type="submit">
              Save attendance
            </Button>
            <Button type="submit" name="bulk" value="all_present">
              Mark unmarked students present
            </Button>
          </ButtonRow>
          <p className="hint">
            Marking all present only fills places nobody has judged yet — it never
            overwrites an attendance you have already recorded.
          </p>
        </form>
      ) : (
        table
      )}
    </Card>
  );
}
