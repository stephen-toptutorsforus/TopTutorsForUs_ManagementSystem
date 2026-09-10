"use client";

/**
 * Which of the directory's two dialogs is open, and what it is about.
 *
 * The page is a server component and stays one. This wraps it, holds the one
 * piece of state the page has — nothing, one dialog, or the other — and mounts
 * both dialogs itself. The page's own markup passes straight through as
 * `children`, so nothing that renders a table becomes a client component.
 *
 * The triggers are the leaves that need a browser: a button in the header and a
 * button in every row. They reach the state through context rather than
 * through props threaded down eight levels of table markup, which is the one
 * thing a context is unambiguously for.
 *
 * **The row's person travels with the request.** "Assign" used to be a link to
 * `#assign-people`, which opened a dialog with two empty selects: the row you
 * pressed it on was lost between the click and the panel. It arrives here now,
 * and the dialog starts with that person chosen.
 *
 * **Each opening is a new form.** `openings` counts them and keys the dialog
 * bodies, so closing and reopening starts clean — a half-filled wizard does not
 * survive being dismissed. It changes only on open, so a failed submission,
 * which does not reopen anything, keeps everything that was typed.
 */

import { createContext, useCallback, useContext, useMemo, useState } from "react";

import { AssignModal } from "./AssignModal";
import { CreateUserModal, type CreateUserModalProps } from "./CreateUserModal";
import type { PickerOption } from "./Picker";

export type PeopleOverlay = "create-user" | "assign-people" | null;

/** The person a row's Assign button was pressed for. */
export interface AssignTarget {
  ref: string;
  label: string;
}

interface OverlayControls {
  openCreateUser: () => void;
  openAssign: (target?: AssignTarget) => void;
  /** False where the viewer may not manage people: the triggers render nothing. */
  enabled: boolean;
}

const Controls = createContext<OverlayControls | null>(null);

export function usePeopleOverlays(): OverlayControls {
  const controls = useContext(Controls);
  // A trigger outside the provider would be a button that silently does
  // nothing, which is worse than a page that fails to build.
  if (controls === null) {
    throw new Error("A people overlay trigger must be inside <PeopleOverlays>.");
  }
  return controls;
}

export function PeopleOverlays({
  enabled,
  csrfToken,
  create,
  assign,
  children,
}: {
  enabled: boolean;
  csrfToken: string;
  /** Everything `CreateUserModal` needs but the token and the open state. */
  create: Omit<CreateUserModalProps, "csrfToken" | "open" | "onOpenChange">;
  assign: { instructors: PickerOption[]; students: PickerOption[] };
  children: React.ReactNode;
}) {
  const [overlay, setOverlay] = useState<PeopleOverlay>(null);
  const [target, setTarget] = useState<AssignTarget | null>(null);
  const [openings, setOpenings] = useState(0);

  const openCreateUser = useCallback(() => {
    setOpenings((count) => count + 1);
    setOverlay("create-user");
  }, []);

  const openAssign = useCallback((next?: AssignTarget) => {
    setTarget(next ?? null);
    setOpenings((count) => count + 1);
    setOverlay("assign-people");
  }, []);

  const controls = useMemo<OverlayControls>(
    () => ({ openCreateUser, openAssign, enabled }),
    [enabled, openAssign, openCreateUser],
  );

  return (
    <Controls.Provider value={controls}>
      {children}
      {enabled && (
        <>
          <CreateUserModal
            key={`create-${openings}`}
            open={overlay === "create-user"}
            onOpenChange={(open) => setOverlay(open ? "create-user" : null)}
            csrfToken={csrfToken}
            {...create}
          />
          <AssignModal
            key={`assign-${openings}`}
            open={overlay === "assign-people"}
            onOpenChange={(open) => setOverlay(open ? "assign-people" : null)}
            csrfToken={csrfToken}
            target={target}
            {...assign}
          />
        </>
      )}
    </Controls.Provider>
  );
}
