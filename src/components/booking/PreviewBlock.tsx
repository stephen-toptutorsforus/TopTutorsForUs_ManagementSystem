/**
 * The booking preview.
 *
 * Ported from the preview section of `app/templates/sessions/new.html`. Every
 * occurrence is listed with whatever is wrong with it, so a clash is shown on
 * the date it happens rather than as a single "there is a problem somewhere"
 * that leaves the person to find it.
 */

import { Tag, VisuallyHidden } from "@/components/ui";
import type { PlanView } from "@/lib/web/planView";

export function PreviewBlock({
  plan,
  canOverride,
}: {
  plan: PlanView;
  canOverride: boolean;
}) {
  return (
    <section className="card">
      <h2>
        Preview — {plan.total} session{plan.total === 1 ? "" : "s"}
      </h2>

      {plan.firstWhen && plan.lastWhen && (
        <dl className="preview-summary">
          <dt>Sessions</dt>
          <dd>{plan.total}</dd>
          <dt>First</dt>
          <dd>{plan.firstWhen}</dd>
          <dt>Last</dt>
          <dd>{plan.lastWhen}</dd>
          <dt>Time</dt>
          <dd>
            {plan.startTime} to {plan.endTime}
          </dd>
          <dt>Timezone</dt>
          <dd>{plan.zone}</dd>
          {plan.repeatsOn && (
            <>
              <dt>Repeats</dt>
              <dd>Every {plan.repeatsOn}</dd>
            </>
          )}
        </dl>
      )}

      {plan.truncated && (
        <p className="notice notice-warn">
          <span aria-hidden="true">!</span>
          <span>
            {plan.truncationReason}
            {plan.requestedCount !== null && <> You asked for {plan.requestedCount}.</>}
          </span>
        </p>
      )}

      {plan.skippedDates.length > 0 && (
        <p className="notice notice-info">
          <span aria-hidden="true">◷</span>
          <span>
            Skipped {plan.skippedDates.length} closure day(s):{" "}
            {plan.skippedDates.join(", ")}. The run was extended so you still get the
            number of sessions you asked for.
          </span>
        </p>
      )}

      {plan.dstAdjustedCount > 0 && (
        <p className="notice notice-info">
          <span aria-hidden="true">◔</span>
          <span>
            {plan.dstAdjustedCount} session(s) fall on a daylight-saving change and were
            adjusted to the nearest real time. They are marked below.
          </span>
        </p>
      )}

      {plan.selfOverlaps && (
        <p className="notice notice-bad" role="alert">
          <span aria-hidden="true">!</span>
          <span>
            These sessions overlap each other. Shorten the length or widen the interval
            before booking.
          </span>
        </p>
      )}

      <ol className="preview-list">
        {plan.sessions.map((item) => (
          <li
            className={`preview-item ${
              item.blocked ? "is-blocked" : item.hasConflicts ? "has-conflict" : ""
            }`}
            key={item.index}
          >
            <span className="idx" aria-hidden="true">
              {item.index}
            </span>
            <VisuallyHidden>Session {item.index}:</VisuallyHidden>
            <span>{item.when}</span>
            <Tag>→ {item.endsAt}</Tag>
            {item.shiftedByDst && (
              <span className="badge badge-info">
                <span className="glyph" aria-hidden="true">
                  ◔
                </span>
                Adjusted for daylight saving
              </span>
            )}
            {item.blocked ? (
              <span className="badge badge-bad">
                <span className="glyph" aria-hidden="true">
                  ✕
                </span>
                Cannot book
              </span>
            ) : (
              item.hasConflicts && (
                <span className="badge badge-warn">
                  <span className="glyph" aria-hidden="true">
                    !
                  </span>
                  Conflict
                </span>
              )
            )}
            {item.conflicts.map((message) => (
              <span className="why" key={message}>
                {message}
              </span>
            ))}
          </li>
        ))}
      </ol>

      {plan.blocked ? (
        <p className="notice notice-bad" role="alert">
          <span aria-hidden="true">✕</span>
          <span>
            Some sessions clash with an existing booking for the same instructor or room.
            Those cannot be booked at all — change the time, the instructor, or the room.
          </span>
        </p>
      ) : (
        plan.needsOverride &&
        (canOverride ? (
          <>
            <label className="choice">
              <input type="checkbox" name="override_conflicts" />
              <span>Book anyway, despite the conflicts above</span>
            </label>
            <p className="hint">
              The override is recorded on each session and in the audit trail.
            </p>
          </>
        ) : (
          <p className="notice notice-warn">
            <span aria-hidden="true">!</span>
            <span>
              These conflicts need an administrator to override before this can be booked.
            </span>
          </p>
        ))
      )}
    </section>
  );
}
