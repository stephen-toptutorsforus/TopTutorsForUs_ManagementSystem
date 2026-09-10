/**
 * Which instructors may teach which students.
 *
 * Eligibility and availability are different questions, asked in that order.
 * Eligibility asks whether this instructor is *allowed* to teach this student —
 * a relationship question, answered from assignments and organization
 * structure. Availability asks whether they are *free* — a calendar question,
 * answered by `lib/availability` and, per proposed occurrence, by
 * `lib/conflicts`. Confusing the two produces the worst message a booking
 * screen can give: "nobody is available", when in fact everybody was busy for
 * the other reason.
 *
 * **This module is the only place the first question is answered.** The booking
 * screen's instructor list, the live refresh, the preview and the write all
 * call it. A second implementation on the screen would be a second answer, free
 * to disagree with the one that guards the write — and the one that guards the
 * write is the only one that matters, because hiding a name in a dropdown is
 * not authorization. The screen narrows; `assertEligible` refuses.
 *
 * **The mode is tenant configuration, and its absence is meaningful.**
 * `booking.instructor_eligibility_mode` is deliberately *not* in
 * `DEFAULT_SETTINGS`: `setting()` walks the shipped defaults, so a key present
 * there could never read as unset, and "unset" is exactly what the older
 * `booking.assigned_users_only` boolean has to be translated from. Tenants
 * configured before this setting existed keep the behaviour their boolean
 * asked for, without anybody rewriting their rows.
 *
 * **Intersection, not union.** An instructor must be eligible for *every*
 * student who will sit in the session. A group of four where the instructor is
 * assigned to three is not a partial pass; the fourth student would be taught
 * by somebody the tenant said may not teach them.
 *
 * Every query here is tenant-scoped and bounded: at most one query for the
 * candidate instructors and one (or three) more for the relationships of that
 * bounded set. Nothing loops a query per instructor per student.
 */

import { Role, UserStatus } from "@/generated/prisma/enums";
import type { Db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { type ConfigurableOrganization, setting } from "@/lib/organization";
import type { Principal } from "@/lib/policies/principal";
import { scoped } from "@/lib/policies/scoping";

/** How a tenant decides who may teach whom. */
export enum EligibilityMode {
  /** Only where an assignment row links the instructor to the student. */
  ASSIGNED_ONLY = "assigned_only",
  /** Where the two share a school, a district, or a region. */
  SHARED_STRUCTURE = "shared_structure",
  /** Anyone active. */
  ANY_INSTRUCTOR = "any_instructor",
}

/** The setting that names the mode. See the note above on why it has no default. */
export const ELIGIBILITY_MODE_PATH = ["booking", "instructor_eligibility_mode"] as const;
const ASSIGNED_USERS_ONLY_PATH = ["booking", "assigned_users_only"] as const;

/**
 * What a person is told when the instructor they chose may not teach somebody
 * on the roster. It names neither the student nor the reason: the chooser may
 * not be entitled to know which assignments exist, and "who is not allowed to
 * teach whom" is exactly the kind of detail an error message should not hand
 * out. The fix is the same either way — choose somebody else.
 */
export const INELIGIBLE_INSTRUCTOR =
  "The selected instructor is not eligible for one or more students. " +
  "Please choose another instructor.";

/** Enough of an organization to answer the question. */
export interface EligibilityOrganization extends ConfigurableOrganization {
  id: bigint;
}

/** Enough of an instructor to list them, without an internal id crossing out. */
export interface InstructorRecord {
  id: bigint;
  ref: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

/**
 * One eligibility question.
 *
 * `studentIds` are already resolved and tenant-checked; `groupId` is expanded
 * here when the caller has a group rather than a roster. Callers that have
 * already expanded the group — `plan()` does, because a group is expanded once
 * at booking time and the session then owns its roster — pass the roster and
 * leave `groupId` unset, so the group is never expanded twice with a
 * membership change in between.
 */
export interface EligibilityRequest {
  readonly organization: EligibilityOrganization;
  readonly principal: Principal;
  readonly studentIds?: readonly bigint[];
  readonly groupId?: bigint | null;
  /** Defaults to the organization's configured mode. */
  readonly mode?: EligibilityMode;
}

/**
 * The tenant's mode, translating the older boolean when the mode is unset.
 *
 * `assigned_users_only: true` — the shipped default — becomes `assigned_only`,
 * and false becomes `any_instructor`. That is what the boolean has always
 * claimed to mean; it simply had nothing enforcing it.
 */
export function eligibilityMode(
  organization: ConfigurableOrganization | null | undefined,
): EligibilityMode {
  const stored = setting(organization, ELIGIBILITY_MODE_PATH);
  if (typeof stored === "string") {
    const named = (Object.values(EligibilityMode) as string[]).includes(stored)
      ? (stored as EligibilityMode)
      : null;
    // An unrecognised value is not a licence to widen the list. A tenant that
    // has typed something this build does not know falls back to the strictest
    // mode, which refuses rather than over-shares.
    if (named !== null) return named;
    return EligibilityMode.ASSIGNED_ONLY;
  }

  const assignedOnly = setting(organization, ASSIGNED_USERS_ONLY_PATH, true);
  return assignedOnly === false
    ? EligibilityMode.ANY_INSTRUCTOR
    : EligibilityMode.ASSIGNED_ONLY;
}

/**
 * Every active instructor in the tenant.
 *
 * Active as well as un-archived: an invited account that has never set a
 * password, or a disabled one, cannot sign in, so offering them as this term's
 * instructor books a session nobody can teach. The old list asked only about
 * `archivedAt`, which is why disabled instructors were bookable.
 */
async function activeInstructors(db: Db, principal: Principal): Promise<InstructorRecord[]> {
  return db.user.findMany({
    where: {
      ...scoped(principal),
      archivedAt: null,
      status: UserStatus.ACTIVE,
      roles: { some: { role: Role.INSTRUCTOR } },
    },
    select: { id: true, ref: true, firstName: true, lastName: true, email: true },
    orderBy: { lastName: "asc" },
  });
}

/**
 * The students a group currently holds.
 *
 * Tenant-scoped through the group itself: a group ref belonging to somebody
 * else finds no group, and therefore contributes no members, rather than
 * reaching into their roster.
 */
async function groupMembers(
  db: Db,
  principal: Principal,
  groupId: bigint,
): Promise<bigint[]> {
  const group = await db.group.findFirst({
    where: { ...scoped(principal), id: groupId, archivedAt: null },
    select: { id: true },
  });
  if (group === null) return [];
  const members = await db.groupMember.findMany({
    where: { ...scoped(principal), groupId: group.id, memberRole: "student" },
    select: { userId: true },
  });
  return members.map((member) => member.userId);
}

/**
 * Everybody who will sit in the session: the individually chosen students plus
 * the group's current members, deduplicated.
 *
 * Somebody picked individually *and* present in the chosen group counts once —
 * otherwise the intersection below would demand two matching relationships for
 * one person, and a perfectly eligible instructor would be dropped.
 */
export async function resolveRoster(
  db: Db,
  principal: Principal,
  selection: { studentIds?: readonly bigint[]; groupId?: bigint | null },
): Promise<bigint[]> {
  const ids = [...(selection.studentIds ?? [])];
  if (selection.groupId !== null && selection.groupId !== undefined) {
    ids.push(...(await groupMembers(db, principal, selection.groupId)));
  }
  return [...new Set(ids)];
}

/**
 * The same, from public refs — what the booking screen holds.
 *
 * A ref that resolves to nothing is dropped rather than raising. This path
 * draws a picker, and a stale or foreign ref in a form field must narrow
 * nothing and disclose nothing; the write path resolves the same refs through
 * `plan()`, which *does* refuse an unknown student.
 */
export async function resolveRosterFromRefs(
  db: Db,
  principal: Principal,
  selection: { studentRefs?: readonly string[]; groupRef?: string | null },
): Promise<bigint[]> {
  const refs = [...new Set((selection.studentRefs ?? []).filter((ref) => ref !== ""))];

  const [students, group] = await Promise.all([
    refs.length === 0
      ? Promise.resolve([] as { id: bigint }[])
      : db.user.findMany({
          where: { ...scoped(principal), ref: { in: refs }, archivedAt: null },
          select: { id: true },
        }),
    selection.groupRef
      ? db.group.findFirst({
          where: { ...scoped(principal), ref: selection.groupRef, archivedAt: null },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);

  return resolveRoster(db, principal, {
    studentIds: students.map((student) => student.id),
    groupId: group?.id ?? null,
  });
}

/** Every placement key a set of people holds: `school:1`, `district:2`, `region:3`. */
async function placements(
  db: Db,
  principal: Principal,
  userIds: readonly bigint[],
): Promise<Map<bigint, Set<string>>> {
  const keys = new Map<bigint, Set<string>>();
  if (userIds.length === 0) return keys;

  const where = { ...scoped(principal), userId: { in: [...userIds] } };
  // Three bounded reads over the candidate set, not one per pairing. The set is
  // the tenant's active instructors plus the chosen students, so this stays
  // proportional to the roster rather than to their product.
  const [schools, districts, regions] = await Promise.all([
    db.userSchool.findMany({ where, select: { userId: true, schoolId: true } }),
    db.userDistrict.findMany({ where, select: { userId: true, districtId: true } }),
    db.userRegion.findMany({ where, select: { userId: true, regionId: true } }),
  ]);

  const add = (userId: bigint, key: string) => {
    const held = keys.get(userId);
    if (held === undefined) keys.set(userId, new Set([key]));
    else held.add(key);
  };
  for (const row of schools) add(row.userId, `school:${row.schoolId}`);
  for (const row of districts) add(row.userId, `district:${row.districtId}`);
  for (const row of regions) add(row.userId, `region:${row.regionId}`);
  return keys;
}

/**
 * Has this tenant configured a location hierarchy at all?
 *
 * The distinction the fallback rests on. A tenant with no regions, districts or
 * schools has not disabled structure matching — it has never set it up, and
 * matching on a hierarchy that does not exist would refuse every booking. A
 * tenant that *has* one and simply has not placed this student is a different
 * case entirely: that is a gap in their data, and quietly widening the list
 * would hide it.
 */
async function hasHierarchy(db: Db, principal: Principal): Promise<boolean> {
  const where = { ...scoped(principal) };
  const [region, district, school] = await Promise.all([
    db.region.findFirst({ where, select: { id: true } }),
    db.district.findFirst({ where, select: { id: true } }),
    db.school.findFirst({ where, select: { id: true } }),
  ]);
  return region !== null || district !== null || school !== null;
}

/** What a caller learns about a narrowing, beyond the list itself. */
export interface EligibilityResult {
  readonly instructors: InstructorRecord[];
  /**
   * Every active instructor, before the roster narrowed anything. Kept so a
   * refusal can tell "may not teach these students" apart from "this account
   * cannot be booked at all" without asking the database a second time.
   */
  readonly pool: InstructorRecord[];
  readonly mode: EligibilityMode;
  /** The roster the answer was computed for, after group expansion. */
  readonly studentIds: bigint[];
  /**
   * Whether a roster actually constrained the list. False when nobody is
   * selected, when the mode is `any_instructor`, and when structure matching
   * fell back for want of a hierarchy — in all three the list is simply
   * "everyone active", and saying otherwise would blame a filter that did not
   * run.
   */
  readonly narrowed: boolean;
}

/**
 * Who may teach this roster.
 *
 * With nobody selected the question has no content yet, so the answer is every
 * active instructor — the same list the screen opens on.
 */
export async function eligibleInstructors(
  db: Db,
  request: EligibilityRequest,
): Promise<EligibilityResult> {
  const { principal } = request;
  const mode = request.mode ?? eligibilityMode(request.organization);
  const studentIds = await resolveRoster(db, principal, request);

  const active = await activeInstructors(db, principal);
  const everyone: EligibilityResult = {
    instructors: active,
    pool: active,
    mode,
    studentIds,
    narrowed: false,
  };

  if (studentIds.length === 0 || mode === EligibilityMode.ANY_INSTRUCTOR) return everyone;
  if (active.length === 0) return { ...everyone, narrowed: true };

  const instructorIds = active.map((person) => person.id);

  if (mode === EligibilityMode.ASSIGNED_ONLY) {
    const links = await db.instructorStudent.findMany({
      where: {
        ...scoped(principal),
        archivedAt: null,
        instructorId: { in: instructorIds },
        studentId: { in: studentIds },
      },
      select: { instructorId: true, studentId: true },
    });
    const covered = new Map<bigint, Set<bigint>>();
    for (const link of links) {
      const held = covered.get(link.instructorId);
      if (held === undefined) covered.set(link.instructorId, new Set([link.studentId]));
      else held.add(link.studentId);
    }
    return {
      ...everyone,
      narrowed: true,
      instructors: active.filter(
        (person) => (covered.get(person.id)?.size ?? 0) === studentIds.length,
      ),
    };
  }

  // shared_structure. Nothing to match on means nothing has been set up, which
  // is a fallback rather than a refusal — see `hasHierarchy`.
  if (!(await hasHierarchy(db, principal))) return everyone;

  const keys = await placements(db, principal, [...instructorIds, ...studentIds]);
  const shares = (instructorId: bigint, studentId: bigint): boolean => {
    const mine = keys.get(instructorId);
    const theirs = keys.get(studentId);
    if (mine === undefined || theirs === undefined) return false;
    for (const key of theirs) if (mine.has(key)) return true;
    return false;
  };

  return {
    ...everyone,
    narrowed: true,
    instructors: active.filter((person) =>
      studentIds.every((studentId) => shares(person.id, studentId)),
    ),
  };
}

/**
 * Refuse an instructor who may not teach somebody on the roster.
 *
 * Called by `plan()` and again by `createFromPlan()`. Twice on purpose: a
 * preview can sit on somebody's screen for an hour, and an assignment removed
 * in that hour must not be honoured by the confirm — the second call is what
 * makes eligibility a property of the write rather than of the preview that
 * preceded it.
 */
export async function assertEligible(
  db: Db,
  request: EligibilityRequest & { instructorId: bigint | null | undefined },
): Promise<void> {
  const { instructorId } = request;
  if (instructorId === null || instructorId === undefined) return;

  const result = await eligibleInstructors(db, request);
  if (result.instructors.some((person) => person.id === instructorId)) return;

  // Two ways to fail, and they are not the same thing to a person reading the
  // message. Being active is part of eligibility under every mode — the widest
  // one is still "every *active* instructor" — so both are refused here. But
  // "not eligible for these students" said about somebody whose account is
  // simply disabled would send an administrator looking for an assignment that
  // was never the problem, so the pool is checked first.
  if (!result.pool.some((person) => person.id === instructorId)) {
    throw new ValidationError(
      "that instructor cannot be booked — the account is not active here",
    );
  }
  throw new ValidationError(INELIGIBLE_INSTRUCTOR);
}
