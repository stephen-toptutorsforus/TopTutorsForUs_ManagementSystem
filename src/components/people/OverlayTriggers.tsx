"use client";

/**
 * The two buttons that open the directory's dialogs.
 *
 * Both were anchors to a fragment. Neither went anywhere: they were buttons
 * wearing a link's element, which cost the semantics announced to assistive
 * technology and bought a history entry nobody wanted. They are buttons now,
 * and the only reason they are client components is that a button needs a
 * handler.
 *
 * They live apart from the panels they open so that the header and the table
 * rows — server-rendered, and staying that way — can drop one in without
 * pulling a dialog and its form into their own bundle.
 */

import { Button } from "@/components/ui";
import type { PersonSheetData } from "@/lib/web/personSheet";

import { usePeopleOverlays, type AssignTarget } from "./PeopleOverlays";

/** Opens the create-user wizard. Sits among the page header's actions. */
export function CreateUserButton() {
  const { openCreateUser } = usePeopleOverlays();
  return (
    <Button variant="primary" onClick={openCreateUser}>
      <span aria-hidden="true">＋</span> Create User
    </Button>
  );
}

/**
 * Opens the assign dialog for one person.
 *
 * `variant="link"` and not an anchor: it sits in a table cell beside "Sessions",
 * which is a real link to a real page, and the two should look alike. Looking
 * alike is a styling question; being alike is not, and an anchor that goes
 * nowhere is announced as a link that goes nowhere.
 */
export function AssignButton({ target }: { target: AssignTarget }) {
  const { openAssign } = usePeopleOverlays();
  return (
    // Which row this is, for anyone hearing the cell rather than seeing it: a
    // column of buttons all called "Assign" says nothing about who.
    //
    // An `aria-label` rather than a visually-hidden span, which is how this was
    // written first. `.visually-hidden` is `position: absolute` and the button
    // is not positioned, so the span was placed against the initial containing
    // block — escaping the table's `overflow-x` and pushing the document 35px
    // wider than the viewport. `e2e/layout.spec.ts` caught it.
    <Button
      variant="link"
      aria-label={`Assign ${target.label}`}
      onClick={() => openAssign(target)}
    >
      Assign
    </Button>
  );
}

/**
 * Somebody's name in the directory, which opens their record.
 *
 * A button rather than a link, for the reason the two above are: it opens a
 * panel over this page rather than going anywhere, and the address of the
 * directory stays the directory's. A name that navigated would also lose the
 * filter somebody is reading under, which is a cookie keyed to the screen.
 *
 * Drawn as a link because that is what a name in a table reads as, and because
 * every other row in the product opens something when its first cell is
 * pressed.
 */
export function PersonNameButton({
  person,
  children,
}: {
  person: PersonSheetData;
  children: React.ReactNode;
}) {
  const { openPerson } = usePeopleOverlays();
  return (
    <Button variant="link" className="person-name" onClick={() => openPerson(person)}>
      {children}
    </Button>
  );
}
