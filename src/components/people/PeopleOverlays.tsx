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

import { Sheet } from "@/components/ui";
import type { PersonSheetData } from "@/lib/web/personSheet";

import { AssignModal } from "./AssignModal";
import { PersonSheet } from "./PersonSheet";
import { CreateUserModal, type CreateUserModalProps } from "./CreateUserModal";
import type { PickerOption } from "./Picker";

export type PeopleOverlay = "create-user" | "assign-people" | "person" | null;

/** The person a row's Assign button was pressed for. */
export interface AssignTarget {
  ref: string;
  label: string;
}

interface OverlayControls {
  openCreateUser: () => void;
  openAssign: (target?: AssignTarget) => void;
  /**
   * Open one person's record.
   *
   * Takes the whole payload rather than a ref, because the page has already
   * built it for every row — opening a drawer should not be a round trip for
   * data that is on screen. It is a hand-built shape rather than the Prisma
   * row: see `lib/web/personSheet.ts`.
   */
  openPerson: (person: PersonSheetData) => void;
  /** False where the viewer may not manage people: the triggers render nothing. */
  enabled: boolean;
  /** Whether the drawer's forms are editable, which is `USER_MANAGE`. */
  canManage: boolean;
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
  canManage,
  csrfToken,
  create,
  assign,
  children,
}: {
  enabled: boolean;
  /**
   * `USER_MANAGE`, which is not the same question as `enabled`.
   *
   * The person drawer opens for anybody who may *read* the directory — it is
   * where a record is read — and its fields are disabled for anybody who may
   * not change one.
   */
  canManage: boolean;
  csrfToken: string;
  /** Everything `CreateUserModal` needs but the token and the open state. */
  create: Omit<CreateUserModalProps, "csrfToken" | "open" | "onOpenChange">;
  assign: { instructors: PickerOption[]; students: PickerOption[] };
  children: React.ReactNode;
}) {
  const places = { schools: create.schools, regions: create.regions };
  const [overlay, setOverlay] = useState<PeopleOverlay>(null);
  const [target, setTarget] = useState<AssignTarget | null>(null);
  const [person, setPerson] = useState<PersonSheetData | null>(null);
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

  const openPerson = useCallback((next: PersonSheetData) => {
    setPerson(next);
    setOpenings((count) => count + 1);
    setOverlay("person");
  }, []);

  const controls = useMemo<OverlayControls>(
    () => ({ openCreateUser, openAssign, openPerson, enabled, canManage }),
    [canManage, enabled, openAssign, openCreateUser, openPerson],
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
      {/* Outside the `enabled` gate: a record is readable by anybody who may
          read the directory, and the drawer's own fields are what narrow by
          `canManage`. */}
      <Sheet
        open={overlay === "person"}
        onOpenChange={(open) => setOverlay(open ? "person" : null)}
        title={person?.displayName ?? ""}
        subtitle={person ? person.roleNames.join(", ") : undefined}
      >
        {person && (
          <PersonSheet
            key={`person-${openings}`}
            person={person}
            csrfToken={csrfToken}
            canManage={canManage}
            onDone={() => setOverlay(null)}
            schools={places.schools}
            regions={places.regions}
          />
        )}
      </Sheet>
    </Controls.Provider>
  );
}
