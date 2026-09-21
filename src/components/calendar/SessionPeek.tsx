"use client";

/**
 * The calendar's session modal, and the click that opens it.
 *
 * **The chips stay links.** Every session on the calendar is a real anchor to
 * its own page, rendered by the server; this component listens for clicks on
 * them and opens a dialog instead. So with a script the calendar answers "what
 * is this session" without leaving the month somebody is reading, and without
 * one it navigates to the detail page exactly as it always did. A button that
 * only exists once React has hydrated would have taken the second away.
 *
 * One listener on the wrapper rather than a handler per chip: a month view is
 * a hundred or more of them, and they are server-rendered markup this
 * component never owns. Modified clicks — a new tab, a middle button — are
 * left alone, because somebody asking for a new tab is asking for the page.
 *
 * **Cancelling happens here.** It used to send somebody to the editing screen
 * with a panel pre-opened, so the shortest way to call off one session was:
 * press the chip, read the dialog, press Cancel, wait for a page, find the
 * panel, choose a reason, press Cancel again, then walk back to the calendar.
 * Six steps and two screens for one decision already made. The reason and the
 * scope are asked in the dialog now and posted to `cancelSession` — the same
 * action the editing screen calls, so the same policy check and the same audit
 * entry. Editing is still a screen of its own, because it is a form rather than
 * a decision.
 *
 * **Nor does it decide what may be done.** Each session arrives with the
 * `availableActions` answer for itself, computed on the server, and the buttons
 * are drawn from that. Deciding once for the whole calendar from a broad
 * permission is the bug this replaced: status gates action, so an
 * administrator was being offered "Cancel session" on a completed one.
 */

import Link from "next/link";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";

import { cancelSession } from "@/app/actions/sessions";
import {
  Badge,
  Button,
  ButtonRow,
  Field,
  Hint,
  LinkButton,
  Modal,
  OptionSelect,
  ScopeChoice,
  Tag,
  useSettled,
} from "@/components/ui";
import { CSRF_FIELD } from "@/lib/names";
import type { PeekSession } from "@/lib/web/sessionPeek";

function sentenceCase(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Calling off a session, without leaving the month it is drawn on.
 *
 * A component of its own because the action has to be bound to one ref, and
 * because it is keyed on that ref by its caller: opening a second session must
 * not inherit the reason chosen for the first.
 *
 * It is a *second* press rather than a confirm dialog on top of a dialog. The
 * panel names what will happen and asks for the reason the tenant configured,
 * which is a better confirmation than "are you sure?" — somebody who opened it
 * by accident closes it, and somebody who meant it has answered the question
 * the record needs anyway.
 */
function PeekCancel({
  session,
  csrfToken,
  reasons,
  onDone,
}: {
  session: PeekSession;
  csrfToken: string;
  reasons: string[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, submit, pending] = useActionState(cancelSession.bind(null, session.ref), {});
  // Cancelled: the dialog goes and the calendar behind it says so. A failure
  // keeps the panel exactly where it is, because the reason that was refused is
  // in it.
  useSettled(state, onDone);

  if (!open) {
    return (
      <Button variant="danger" type="button" onClick={() => setOpen(true)}>
        Cancel session
      </Button>
    );
  }

  return (
    <form action={submit} className="peek-cancel">
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      {state.error && (
        <p className="notice notice-bad" role="alert">
          <span aria-hidden="true">!</span> <span>{state.error}</span>
        </p>
      )}
      <Field id="peek-cancel-reason" label="Reason">
        <OptionSelect
          id="peek-cancel-reason"
          name="reason"
          required
          options={reasons.map((reason) => ({ value: reason, label: sentenceCase(reason) }))}
        />
      </Field>
      {session.inSeries && <ScopeChoice series legend="Cancel" />}
      <Hint>
        Participants keep the record that it was booked. Nothing is deleted.
      </Hint>
      <ButtonRow>
        <Button type="button" onClick={() => setOpen(false)}>
          Keep it
        </Button>
        <Button variant="danger" type="submit" disabled={pending}>
          {pending ? "Cancelling…" : "Cancel session"}
        </Button>
      </ButtonRow>
    </form>
  );
}

/** A click that means "open this in a new tab", not "tell me about it". */
function isModified(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

export function SessionPeek({
  sessions,
  csrfToken,
  cancellationReasons,
  children,
}: {
  /** Every session drawn in `children`, by ref. */
  sessions: Record<string, PeekSession>;
  /** For the cancel panel, which posts from inside the dialog. */
  csrfToken: string;
  /** The tenant's own list. An empty one means nothing here may cancel. */
  cancellationReasons: string[];
  children: React.ReactNode;
}) {
  const [openRef, setOpenRef] = useState<string | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = wrapper.current;
    if (node === null) return;

    const onClick = (event: MouseEvent) => {
      if (isModified(event)) return;
      const target = event.target as HTMLElement | null;
      const chip = target?.closest<HTMLElement>("[data-session-ref]");
      const ref = chip?.dataset.sessionRef;
      if (!ref || !(ref in sessions)) return;
      event.preventDefault();
      setOpenRef(ref);
    };

    node.addEventListener("click", onClick);
    return () => node.removeEventListener("click", onClick);
  }, [sessions]);

  const close = useCallback(() => setOpenRef(null), []);
  const session = openRef === null ? null : sessions[openRef];

  return (
    <div ref={wrapper}>
      {children}
      <Modal
        open={session !== null}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        title={session?.deliveryLabel ?? ""}
        subtitle={
          session?.seriesPosition ? (
            <>Session {session.seriesPosition} in a repeating series</>
          ) : undefined
        }
      >
        {session && (
          <>
            <dl className="definition peek-details">
              <dt>Date</dt>
              <dd>{session.startLabel}</dd>

              <dt>Duration</dt>
              <dd>{session.durationLabel}</dd>

              <dt>Status</dt>
              <dd>
                <Badge
                  tone={session.state.tone}
                  glyph={session.state.icon}
                  title={session.state.meaning}
                >
                  {session.state.label}
                </Badge>
                {/* And in words, for everybody the title does not reach —
                    every touch screen, and most screen readers. Only
                    Incomplete has one: it is worked out when the page is drawn
                    rather than stored, so it is the one state that cannot be
                    looked up in the status filter's menu, and the one that
                    asks for something to be done. */}
                {session.state.meaning !== undefined && (
                  <span className="peek-meaning">{session.state.meaning}</span>
                )}
              </dd>

              <dt>{session.placeIsLink ? "Online Classroom link" : "Location"}</dt>
              <dd>
                {session.place === null || session.place === "" ? (
                  <Tag>Not set</Tag>
                ) : session.placeIsLink ? (
                  /* Shown only to somebody already authorised to see this
                     session, and never written to a log or the audit trail. */
                  <a href={session.place} rel="noopener noreferrer">
                    Join the meeting
                  </a>
                ) : (
                  session.place
                )}
              </dd>

              <dt>Instructor</dt>
              <dd>{session.instructorName ?? <Tag>Unassigned</Tag>}</dd>

              <dt>Students</dt>
              <dd>
                {session.studentsLabel === "" ? (
                  <Tag>Nobody yet</Tag>
                ) : (
                  session.studentsLabel
                )}
              </dd>

              <dt>Title</dt>
              <dd>{session.title}</dd>

              <dt>Description</dt>
              <dd>{session.description || <Tag>None</Tag>}</dd>

              <dt>View</dt>
              <dd>
                <Link href={`/sessions/${session.ref}?from=%2Fcalendar`}>Session Details</Link>
              </dd>
            </dl>

            {/* Close on the left, because it is the way out rather than one of
                the things to do. The ones that act sit together on the right,
                widest scope last.

                Each is drawn from this session's own `actions`, so a completed
                session offers no cancel however broad the viewer's permission
                is. `edit_series` already answers both halves — `canEditSeries`
                refuses a session with no series before it looks at the
                permission — so it is the whole test. Not `seriesPosition`,
                which is a *label* and is null for a session whose index was
                never set: gating a control on a display field is the same
                mistake in a smaller place. */}
            <div className="peek-actions">
              {/* `Modal` already focuses its own close control, so this one
                  needs no ref: it is the same way out said in words, where the
                  eye looks for it. */}
              <Button type="button" onClick={close}>
                Close
              </Button>
              <div className="peek-actions-doing">
                {session.actions.includes("cancel") && cancellationReasons.length > 0 && (
                  <PeekCancel
                    key={session.ref}
                    session={session}
                    csrfToken={csrfToken}
                    reasons={cancellationReasons}
                    onDone={close}
                  />
                )}
                {session.actions.includes("edit_series") && (
                  <LinkButton
                    variant="primary"
                    href={`/sessions/${session.ref}/edit?scope=all&do=edit&from=%2Fcalendar`}
                  >
                    Edit Series
                  </LinkButton>
                )}
                {session.actions.includes("edit") && (
                  <LinkButton variant="primary" href={`/sessions/${session.ref}/edit?from=%2Fcalendar`}>
                    Edit Session
                  </LinkButton>
                )}
              </div>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
