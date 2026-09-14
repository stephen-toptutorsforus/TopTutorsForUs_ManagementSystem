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
    expect(backTarget(`https://${HOST}/calendar`, HOST, HERE)).toEqual({
      href: "/calendar",
      label: "Back to calendar",
    });
  });

  it("keeps only the path, never the whole address", () => {
    // The link is built from the referrer, so this is the property that keeps
    // it from becoming a redirect to somewhere else.
    const target = backTarget(`https://${HOST}/calendar?view=week`, HOST, HERE);
    expect(target.href).toBe("/calendar");
    expect(target.href.startsWith("/")).toBe(true);
    expect(target.href).not.toContain(HOST);
  });

  it("refuses another host outright", () => {
    expect(backTarget("https://elsewhere.test/calendar", HOST, HERE)).toEqual(SESSION_LIST);
    // Including one that merely starts with ours.
    expect(backTarget(`https://${HOST}.elsewhere.test/calendar`, HOST, HERE)).toEqual(
      SESSION_LIST,
    );
  });

  it("refuses a scheme this application does not serve", () => {
    expect(backTarget(`javascript:alert(1)//${HOST}`, HOST, HERE)).toEqual(SESSION_LIST);
    expect(backTarget(`data:text/html,<p>hi</p>`, HOST, HERE)).toEqual(SESSION_LIST);
  });

  it("falls back when there is no referrer to read", () => {
    expect(backTarget(null, HOST, HERE)).toEqual(SESSION_LIST);
    expect(backTarget("", HOST, HERE)).toEqual(SESSION_LIST);
    expect(backTarget("not a url", HOST, HERE)).toEqual(SESSION_LIST);
    expect(backTarget(`https://${HOST}/calendar`, null, HERE)).toEqual(SESSION_LIST);
  });

  it("does not offer to go back to the page it is on", () => {
    expect(backTarget(`https://${HOST}${HERE}`, HOST, HERE)).toEqual(SESSION_LIST);
  });

  it("does not offer a download or the API as somewhere to return to", () => {
    expect(backTarget(`https://${HOST}/sessions/export.csv`, HOST, HERE)).toEqual(SESSION_LIST);
    expect(backTarget(`https://${HOST}/api/v1/sessions`, HOST, HERE)).toEqual(SESSION_LIST);
  });

  it("names the destination, longest prefix first", () => {
    const label = (path: string) => backTarget(`https://${HOST}${path}`, HOST, HERE).label;
    expect(label("/")).toBe("Back to insights");
    expect(label("/calendar")).toBe("Back to calendar");
    expect(label("/sessions")).toBe("Back to sessions");
    // Not "Back to sessions", which is what a plain prefix scan would say.
    expect(label("/sessions/new")).toBe("Back to booking");
    expect(label("/series/ser_9")).toBe("Back to series");
    expect(label("/audit")).toBe("Back to history");
  });

  it("says plain 'Back' for a route nobody has named", () => {
    // Rather than inventing one from the path, which reads like a defect the
    // first time somebody adds a screen.
    expect(backTarget(`https://${HOST}/locations`, HOST, HERE).label).toBe("Back");
  });

  it("does not mistake a longer path for a listed one", () => {
    expect(backTarget(`https://${HOST}/calendaring`, HOST, HERE).label).toBe("Back");
  });
});
