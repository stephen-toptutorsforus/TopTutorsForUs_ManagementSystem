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
 * view or the date.
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
  // second answer to the same question.
  const date = asked.searchParams.get("date");
  if (date) back.set("date", date);

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
