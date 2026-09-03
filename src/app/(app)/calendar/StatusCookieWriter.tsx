"use client";

/**
 * Keep the status filter for the next bare visit, or forget it.
 *
 * Forgetting is the "Clear all" path: it arrives with a view and a date and no
 * statuses, which is a person saying they want everything again. Leaving the
 * cookie in place there would restore the old filter the moment they came back
 * from another screen, which is the bug this whole thing exists to fix.
 *
 * Written from the browser rather than on the response. A server component
 * cannot set a cookie — only an action or a route handler can — and the
 * alternative, an action fired on every calendar render, would turn a read into
 * a write. The value is a working preference, not a credential: it is read back
 * only to build a redirect, and never trusted as more than a list of status
 * names.
 */

import { useEffect } from "react";

import { STATUS_COOKIE, STATUS_COOKIE_MAX_AGE } from "@/lib/calendar";

export function StatusCookieWriter({ statuses }: { statuses: string[] }) {
  useEffect(() => {
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    if (statuses.length > 0) {
      document.cookie = `${STATUS_COOKIE}=${statuses.join(",")}; path=/; max-age=${STATUS_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
    } else {
      document.cookie = `${STATUS_COOKIE}=; path=/; max-age=0; SameSite=Lax${secure}`;
    }
  }, [statuses]);

  return null;
}
