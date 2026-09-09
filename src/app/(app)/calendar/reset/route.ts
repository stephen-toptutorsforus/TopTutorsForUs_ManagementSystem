/**
 * Forgetting the calendar's filter.
 *
 * "Reset filter" cannot simply be a link to `/calendar`, because a bare
 * `/calendar` is precisely what restores the remembered status — the reset
 * would arrive and be undone by the filter it had just cleared. It cannot carry
 * a parameter to defeat that either: the only candidates are the view and the
 * date, and the tidying drops both when they are already the default, which is
 * exactly the case that needs defeating.
 *
 * So resetting clears what is remembered rather than trying to out-argue it.
 * That is also what the menu item says it does.
 *
 * A GET, and a plain link, so it works with scripting off like the rest of the
 * menu. It reads nothing and writes nothing but this one preference cookie, so
 * there is no state for a forged request to reach: the worst a stray visit can
 * do is forget which statuses somebody had ticked.
 *
 * The range travels with it. Resetting a filter should leave you on the week
 * you were reading — the same reason `activeCalendarFilters` does not count the
 * view or the date. So does the search text, when the caller sends it: this is
 * also where "Select all" in the status menu goes, which widens the statuses
 * without touching what somebody typed.
 */

import { NextResponse } from "next/server";

import { STATUS_COOKIE, CalendarView, parseView } from "@/lib/calendar";

export async function GET(request: Request): Promise<NextResponse> {
  const asked = new URL(request.url);
  const back = new URLSearchParams();

  const view = parseView(asked.searchParams.get("view"));
  if (view !== CalendarView.MONTH) back.set("view", view);
  // Passed through unvalidated on purpose: the calendar parses it properly on
  // arrival and falls back to today, and duplicating that here would be a
  // second answer to the same question. Bounded, though — that is not a second
  // answer, it is a limit on how long a `Location` header this can be made to
  // emit.
  const date = asked.searchParams.get("date");
  if (date) back.set("date", date.slice(0, 40));

  // The search text rides along when it is sent, and is not when it is not.
  // That is the whole difference between "Select all", which widens the status
  // filter and keeps the search, and "Reset filter", which clears both. The
  // route does not decide which of those it is being used for.
  const search = asked.searchParams.get("q");
  if (search) back.set("q", search.slice(0, 100));

  // A relative `Location`, not `NextResponse.redirect`, which insists on an
  // absolute URL and builds it from `request.url` — whose host is whatever
  // reached the server. That is `localhost` where the browser said `127.0.0.1`,
  // and a redirect across those two is a redirect to a different origin, which
  // arrives without the session cookie and lands on the sign-in form. Relative
  // keeps whatever origin the person is actually on, proxies included.
  const response = new NextResponse(null, {
    status: 307,
    headers: { Location: back.size > 0 ? `/calendar?${back}` : "/calendar" },
  });
  response.cookies.delete(STATUS_COOKIE);
  return response;
}
