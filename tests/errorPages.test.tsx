/**
 * What an error page is allowed to say.
 *
 * These are the pages nobody can reach on purpose, which is exactly why they
 * are worth pinning: a mistake here is invisible until the worst moment, and
 * the thing being asserted is mostly an *absence*.
 *
 * The rule is that the digest goes on the page and nothing else from the error
 * does. Next replaces a server error's message with a generic string in
 * production, so there is nothing to show there anyway — but a client error's
 * message is real text, and on this product it can quote a record. No student's
 * information reaches a screen, and an error page is a screen like any other.
 *
 * Rendered to a string with `react-dom/server`, in the established style: the
 * only browser thing here is the `reset` callback, and its presence is what the
 * markup is checked for rather than its behaviour.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ErrorCard } from "@/components/ErrorCard";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const noop = () => {};

describe("the error card", () => {
  it("shows the digest, which is what is worth quoting", () => {
    const markup = html(<ErrorCard digest="a1b2c3d4" onRetry={noop} />);

    expect(markup).toContain("a1b2c3d4");
    // Marked up as code: it is an identifier to select and send on, not prose.
    expect(markup).toContain("<code>a1b2c3d4</code>");
  });

  it("says nothing about the error when there is no digest", () => {
    const markup = html(<ErrorCard onRetry={noop} />);

    // No empty "Reference:" hanging there with nothing after it. Some
    // client-side failures arrive without one, and a label for a value that
    // does not exist reads as a second bug.
    expect(markup).not.toContain("Reference");
  });

  it("offers trying again before leaving", () => {
    const markup = html(<ErrorCard digest="x" onRetry={noop} />);

    expect(markup).toContain("Try again");
    expect(markup).toContain('href="/"');
    // Order matters: a dropped connection is the common case, so the cheapest
    // fix is the nearest one and leaving is the fallback.
    expect(markup.indexOf("Try again")).toBeLessThan(markup.indexOf('href="/"'));
  });

  it("is a button, not a link, for trying again", () => {
    const markup = html(<ErrorCard digest="x" onRetry={noop} />);

    // A link would navigate and lose the boundary's state. The button asks the
    // server again and clears the boundary in one transition — see `useRetry`,
    // and the note there about why `reset()` alone recovers nothing.
    expect(markup).toMatch(/<button[^>]*>\s*Try again/);
  });

  it("takes its retry from the caller and calls nothing during render", () => {
    // Each boundary means something different by "try again": a page asks the
    // router to fetch again, `global-error.tsx` reloads, because a router
    // refresh cannot recover a tree that never assembled. The component holds
    // no hooks of its own, which is what lets it render here at all — the app
    // router is not mounted in a test.
    let called = false;
    const markup = html(<ErrorCard digest="x" onRetry={() => (called = true)} />);

    expect(markup).toContain("Try again");
    expect(called, "wired to the press, not run while rendering").toBe(false);
  });

  it("says a retry is in flight rather than taking a second one", () => {
    const markup = html(<ErrorCard digest="x" onRetry={noop} pending />);

    expect(markup).toContain("Trying");
    expect(markup).toMatch(/<button[^>]*disabled/);
  });

  it("never puts the error's own words on the page", () => {
    // The shape of the leak this guards against: a message that quotes a
    // record. The component takes no message at all, and this asserts the API
    // stays that way — the day somebody adds one "for debugging", this fails.
    const secret = "Teo Vasquez has no availability on 2026-09-16";
    const markup = html(
      // @ts-expect-error — `message` is not a prop, and must not become one.
      <ErrorCard digest="x" onRetry={noop} message={secret} />,
    );

    expect(markup).not.toContain("Teo");
    expect(markup).not.toContain(secret);
  });
});
