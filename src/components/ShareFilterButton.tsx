"use client";

/**
 * Copying this page's address, filter and all.
 *
 * The filter *is* the address — that is what the canonical-URL work made true,
 * and it is why sharing a filter needs no storage of any kind. So this button
 * copies `location.href` and says it did.
 *
 * The one control in the filter menu that needs a script, which is why it is
 * its own client component rather than making the menu one. With scripting off
 * it renders nothing and the `<noscript>` beside it says to copy from the
 * address bar, which is what somebody would do anyway.
 *
 * `document.execCommand` is not attempted as a fallback for a refused
 * clipboard: it is deprecated, it needs a temporary textarea and a selection,
 * and a button that silently half-works is worse than one that says it could
 * not. A refusal shows the address instead, ready to select.
 */

import { useEffect, useRef, useState } from "react";

import { ShareIcon } from "@/components/ui/icons";

type State = { kind: "idle" } | { kind: "copied" } | { kind: "failed"; href: string };

export function ShareFilterButton() {
  const [state, setState] = useState<State>({ kind: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  const share = async () => {
    const href = window.location.href;
    try {
      await navigator.clipboard.writeText(href);
      setState({ kind: "copied" });
      if (timer.current !== null) clearTimeout(timer.current);
      timer.current = setTimeout(() => setState({ kind: "idle" }), 2500);
    } catch {
      // Refused, which happens on an insecure origin and under some policies.
      setState({ kind: "failed", href });
    }
  };

  return (
    <>
      <button
        type="button"
        className="filteractions-item"
        onClick={share}
        title="Copy this page's address, filter and all"
      >
        <span className="glyph" aria-hidden="true">
          <ShareIcon />
        </span>
        {state.kind === "copied" ? "Copied" : "Share filter"}
      </button>
      {/* Announced rather than only drawn: the button's own label changing is
          not something a screen reader reliably reports. */}
      <p className="filteractions-note" role="status">
        {state.kind === "copied" && "Address copied."}
        {state.kind === "failed" && (
          <>
            Copying was refused. The address is <code>{state.href}</code>
          </>
        )}
      </p>
    </>
  );
}
