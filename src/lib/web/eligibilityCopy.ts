/**
 * What the booking screen says about eligibility, in one place.
 *
 * Two components need these sentences — the form, beside the Instructor field,
 * and the availability block, where the grid would otherwise be — and the whole
 * point of the wording is that it distinguishes two states a person keeps
 * confusing: *not allowed to teach this student* and *not free at this time*.
 * Two copies of that distinction would eventually become one and a half.
 *
 * Deliberately free of imports. Both callers are client components, so
 * anything reachable from here crosses into the browser bundle; the context
 * module next door pulls in the eligibility service and, through it, Prisma.
 */

/** Nobody may teach the chosen roster. Not a calendar problem. */
export function noEligibleInstructors(rosterSize: number): string {
  return rosterSize === 1
    ? "No instructors are eligible for the selected student."
    : "No instructors are eligible for the selected students.";
}

/** People may teach them; none has a long enough window. A calendar problem. */
export const ELIGIBLE_BUT_UNAVAILABLE =
  "Eligible instructors were found, but none are available at this time.";
