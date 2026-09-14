/**
 * Where "back" goes, and what it refuses to trust.
 *
 * The referrer is a header anybody can set, so most of these are about what
 * does *not* become a link.
 */

import { describe, expect, it } from "vitest";

import { SESSION_LIST, backTarget } from "@/lib/web/backLink";

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
