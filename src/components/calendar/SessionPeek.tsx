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
 * **What it does not do is act.** Cancelling needs a reason the tenant
 * configured, and editing is a screen of its own; both are reached from here
 * rather than performed here, so that the one function that writes a change is
 * still the one the audit trail records.
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button, LinkButton, Modal, StatusBadge, Tag } from "@/components/ui";
import type { SessionStatus } from "@/generated/prisma/enums";
import type { PeekSession } from "@/lib/web/sessionPeek";

/** A click that means "open this in a new tab", not "tell me about it". */
function isModified(event: MouseEvent): boolean {
  return event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
}

export function SessionPeek({
  sessions,
  canCancel,
  canEdit,
  children,
}: {
  /** Every session drawn in `children`, by ref. */
  sessions: Record<string, PeekSession>;
  canCancel: boolean;
  canEdit: boolean;
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
                <StatusBadge status={session.status as SessionStatus} />
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
                {session.studentNames.length > 0 ? (
                  session.studentNames.join(", ")
                ) : (
                  <Tag>Nobody yet</Tag>
                )}
              </dd>

              <dt>Title</dt>
              <dd>{session.title}</dd>

              <dt>Description</dt>
              <dd>{session.description || <Tag>None</Tag>}</dd>

              <dt>View</dt>
              <dd>
                <Link href={`/sessions/${session.ref}`}>Session Details</Link>
              </dd>
            </dl>

            {/* Close on the left, because it is the way out rather than one of
                the things to do. The three that act sit together on the right,
                widest scope last. */}
            <div className="peek-actions">
              {/* `Modal` already focuses its own close control, so this one
                  needs no ref: it is the same way out said in words, where the
                  eye looks for it. */}
              <Button type="button" onClick={close}>
                Close
              </Button>
              <div className="peek-actions-doing">
                {canCancel && (
                  <LinkButton
                    variant="danger"
                    href={`/sessions/${session.ref}/edit?do=cancel`}
                  >
                    Cancel session
                  </LinkButton>
                )}
                {canEdit && session.seriesPosition !== null && (
                  <LinkButton
                    variant="primary"
                    href={`/sessions/${session.ref}/edit?scope=all`}
                  >
                    Edit Series
                  </LinkButton>
                )}
                {canEdit && (
                  <LinkButton variant="primary" href={`/sessions/${session.ref}/edit`}>
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
