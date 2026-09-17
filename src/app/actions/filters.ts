"use server";

/**
 * Setting a screen's filter without touching its address.
 *
 * Every filter form on the three list screens posts to one of these. Each takes
 * the fields the form has always submitted, runs them through the same parser
 * the page used to run the query string through, serialises the result with the
 * same serialiser, and stores it. The page then re-renders from the cookie.
 *
 * **No CSRF token.** These read nothing and write nothing but one preference,
 * so there is no state for a forged request to reach: the worst a stray post
 * can do is change which sessions somebody is looking at, which their next
 * filter change undoes. The same reasoning the calendar's reset was written
 * with. Every action that alters a record still verifies one.
 *
 * `revalidatePath` rather than a redirect, because a redirect is a new address
 * and a new address is the thing being avoided.
 */

import { revalidatePath } from "next/cache";

import { parseAnchor, parseView, queryString } from "@/lib/calendar";
import {
  directoryQuery,
  parseDirectoryFilters,
} from "@/lib/services/peopleQuery";
import { EMPTY_FILTERS, parseFilters, toQuery } from "@/lib/services/sessionQuery";
import { civilDate } from "@/lib/time";
import {
  SCREEN_PATH,
  paramsFromForm,
  writeScreenState,
  type FilterScreen,
} from "@/lib/web/filterState";
import { requireContext } from "@/lib/web/session";

/** Store and re-render. One place, so the three screens cannot drift. */
async function apply(screen: FilterScreen, query: string): Promise<void> {
  await writeScreenState(screen, query);
  revalidatePath(SCREEN_PATH[screen]);
}

export async function applyDirectoryFilters(form: FormData): Promise<void> {
  // Signed in and allowed to be here, before a preference is stored under
  // somebody's name. The page checks the permission properly; this is the
  // check that there is a person at all.
  await requireContext();
  const params = paramsFromForm(form);
  await apply("people", directoryQuery(parseDirectoryFilters(params)));
}

export async function applySessionFilters(form: FormData): Promise<void> {
  await requireContext();
  const params = paramsFromForm(form);
  // A filter change moves the rows under the pagination, so it goes back to
  // the first page — unless the form is the pagination itself, which submits
  // the page it wants.
  const filters = parseFilters(params);
  await apply("sessions", toQuery(filters));
}

export async function applyCalendarState(form: FormData): Promise<void> {
  const { principal } = await requireContext();
  const params = paramsFromForm(form);
  const today = civilDate(new Date(), principal.timezone);

  // `goto_*` wins over the form's own `view`/`date`, which carry the range the
  // person is leaving. A button can submit one name and one value, and a second
  // `view` entry would be a duplicate key whose first value — the old one — is
  // what a parser reads. See `components/calendar/GoTo.tsx`.
  const view = parseView(params.get("goto_view") ?? params.get("view"));
  const anchor = parseAnchor(params.get("goto_date") ?? params.get("date"), today);
  const filters = parseFilters(params);

  // `queryString` drops what is already the default — the month view, today's
  // date — so coming back tomorrow shows tomorrow rather than the day this was
  // stored on.
  await apply("calendar", queryString(filters, { view, anchor, today }));
}

/** Clear one screen's filter. What "Reset filter" does. */
export async function resetDirectoryFilters(): Promise<void> {
  await requireContext();
  await apply("people", "");
}

export async function resetSessionFilters(): Promise<void> {
  await requireContext();
  await apply("sessions", "");
}

/**
 * The calendar keeps the range it is showing. The week somebody is reading is
 * not something they asked to filter by — the same reason `activeCalendarFilters`
 * does not count the view or the date.
 */
export async function resetCalendarFilters(form: FormData): Promise<void> {
  const { principal } = await requireContext();
  const params = paramsFromForm(form);
  const today = civilDate(new Date(), principal.timezone);
  const view = parseView(params.get("view"));
  const anchor = parseAnchor(params.get("date"), today);

  // `EMPTY_FILTERS` rather than a literal of the two keys that existed when this
  // was written: a reset that names the fields it clears silently stops
  // clearing the next one somebody adds, which is how `instructor` came to be
  // parsed by this screen and never written by it.
  await apply("calendar", queryString(EMPTY_FILTERS, { view, anchor, today }));
}
