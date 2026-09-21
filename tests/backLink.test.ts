/**
 * Where "back" goes, and what it refuses to trust.
 *
 * The referrer is a header anybody can set, so most of these are about what
 * does *not* become a link.
 */

import { describe, expect, it } from "vitest";

import { SESSION_LIST, backTarget, fromQuery, originPath } from "@/lib/web/backLink";

const HOST = "ops.example.test";
const HERE = "/sessions/ses_123";

describe("backTarget", () => {
  it("returns to the page somebody came from", () => {
    expect(backTarget(`https://${HOST}/calendar`, HOST, HERE)).toBe("/calendar");
  });

  it("keeps only the path, never the whole address", () => {
    // The link is built from the referrer, so this is the property that keeps
    // it from becoming a redirect to somewhere else.
    const target = backTarget(`https://${HOST}/calendar?view=week`, HOST, HERE);
    expect(target).toBe("/calendar");
    expect(target.startsWith("/")).toBe(true);
    expect(target).not.toContain(HOST);
  });

  it("refuses another host outright", () => {
    expect(backTarget("https://elsewhere.test/calendar", HOST, HERE)).toBe(SESSION_LIST);
    // Including one that merely starts with ours.
    expect(backTarget(`https://${HOST}.elsewhere.test/calendar`, HOST, HERE)).toBe(
      SESSION_LIST,
    );
  });

  it("refuses a scheme this application does not serve", () => {
    expect(backTarget(`javascript:alert(1)//${HOST}`, HOST, HERE)).toBe(SESSION_LIST);
    expect(backTarget(`data:text/html,<p>hi</p>`, HOST, HERE)).toBe(SESSION_LIST);
  });

  it("falls back when there is no referrer to read", () => {
    expect(backTarget(null, HOST, HERE)).toBe(SESSION_LIST);
    expect(backTarget("", HOST, HERE)).toBe(SESSION_LIST);
    expect(backTarget("not a url", HOST, HERE)).toBe(SESSION_LIST);
    expect(backTarget(`https://${HOST}/calendar`, null, HERE)).toBe(SESSION_LIST);
  });

  it("does not offer to go back to the page it is on", () => {
    expect(backTarget(`https://${HOST}${HERE}`, HOST, HERE)).toBe(SESSION_LIST);
  });

  it("does not offer a download or the API as somewhere to return to", () => {
    expect(backTarget(`https://${HOST}/sessions/export.csv`, HOST, HERE)).toBe(SESSION_LIST);
    expect(backTarget(`https://${HOST}/api/v1/sessions`, HOST, HERE)).toBe(SESSION_LIST);
  });

  it("returns any screen's path, named or not", () => {
    // No list of known routes to keep in step with the application, because
    // the button says "Back" wherever it goes.
    const to = (path: string) => backTarget(`https://${HOST}${path}`, HOST, HERE);
    expect(to("/")).toBe("/");
    expect(to("/calendar")).toBe("/calendar");
    expect(to("/sessions/new")).toBe("/sessions/new");
    expect(to("/series/ser_9")).toBe("/series/ser_9");
    expect(to("/somewhere-nobody-has-built-yet")).toBe("/somewhere-nobody-has-built-yet");
  });
});

describe("where a record says it was opened from", () => {
  it("prefers what the link said over what the browser sent", () => {
    // The case the parameter exists for. A server action re-renders the page it
    // was submitted from, and the `Referer` on that POST is the page itself —
    // so after any save the referrer says "here", falls through to the session
    // list, and somebody who started on the calendar is quietly moved.
    expect(
      backTarget(
        "https://ops.test/sessions/ses_a/edit",
        "ops.test",
        "/sessions/ses_a/edit",
        "/calendar",
      ),
    ).toBe("/calendar");
  });

  it("falls back to the referrer when nothing was stated", () => {
    expect(
      backTarget("https://ops.test/calendar", "ops.test", "/sessions/ses_a", undefined),
    ).toBe("/calendar");
  });

  it("refuses a from that is not a path on this site", () => {
    // It arrives from the address bar and ends up in an `href`, so the same
    // rule the referrer already followed applies: a protocol-relative `//host`
    // is read by a browser as somewhere else entirely.
    for (const hostile of [
      "//evil.test/phish",
      "https://evil.test/phish",
      "javascript:alert(1)",
      "calendar",
      "",
    ]) {
      expect(originPath(hostile), hostile).toBeNull();
      expect(
        backTarget("https://ops.test/calendar", "ops.test", "/sessions/ses_a", hostile),
        hostile,
      ).toBe("/calendar");
    }
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(originPath(["/calendar", "/sessions"])).toBe("/calendar");
  });

  it("does not send somebody back to the page they are on", () => {
    expect(
      backTarget(null, null, "/sessions/ses_a", "/sessions/ses_a"),
    ).toBe(SESSION_LIST);
  });

  it("writes the parameter only when there is somewhere to say", () => {
    expect(fromQuery("/calendar")).toBe("?from=%2Fcalendar");
    expect(fromQuery("/series/ser_a")).toBe("?from=%2Fseries%2Fser_a");
    expect(fromQuery(null)).toBe("");
    expect(fromQuery(undefined)).toBe("");
  });
});
