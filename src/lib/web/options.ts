/**
 * The lists a filter's select is drawn from.
 *
 * "Every instructor in this tenant, as value-and-label pairs" was written out
 * four times — the session grid, the directory, the booking context and the
 * group editor — each with its own spelling of the same `where`. The calendar
 * would have been the fifth, and the fifth copy is the one that makes it worth
 * having one.
 *
 * Scoped like every other read, and archived people are left out: a filter that
 * offers somebody who no longer works here is offering an empty result.
 */

import type { Role } from "@/generated/prisma/enums";
import type { Db } from "@/lib/db";
import type { Principal } from "@/lib/policies/principal";
import { scoped } from "@/lib/policies/scoping";

/** What `OptionSelect` takes. */
export interface Option {
  value: string;
  label: string;
}

/**
 * Everybody holding one role, by ref, surname first.
 *
 * The ref rather than the id, because that is what an address carries and what
 * the filter parsers read back — an id in a query string would name a record
 * directly, which is the thing this codebase spends a lot of effort not doing.
 */
export async function personOptions(
  db: Db,
  principal: Principal,
  role: Role,
): Promise<Option[]> {
  const people = await db.user.findMany({
    where: { ...scoped(principal), archivedAt: null, roles: { some: { role } } },
    select: { ref: true, firstName: true, lastName: true },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });
  return people.map((person) => ({
    value: person.ref,
    label: `${person.firstName} ${person.lastName}`.trim(),
  }));
}
