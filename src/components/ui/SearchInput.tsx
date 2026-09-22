"use client";

/**
 * A search box that applies only when Enter is pressed.
 *
 * `type="search"` draws a control that empties the field. In Chromium that
 * control, and Escape, fire a `search` event and then submit the form, so
 * clearing the box reloads the list underneath it. Enter is the search. The
 * flag is set on keydown, which happens before the search event, so the two
 * can be told apart.
 *
 * The listener is native. React's `onSearch` prop is stored on the element
 * and never called for this event, which is how the clear control kept
 * submitting.
 *
 * The blocker is removed shortly afterwards if nothing submitted. A browser
 * that clears the field without submitting must not swallow the Enter that
 * follows.
 */

import { useEffect, useRef } from "react";

export function SearchInput({
  onKeyDown,
  onSearch,
  ...props
}: React.ComponentProps<"input">) {
  const fromEnter = useRef(false);
  const onSearchRef = useRef(onSearch);
  const nodeRef = useRef<HTMLInputElement>(null);
  onSearchRef.current = onSearch;

  useEffect(() => {
    const input = nodeRef.current;
    if (input === null) return;

    const handle = (event: Event) => {
      onSearchRef.current?.(event as unknown as React.SyntheticEvent<HTMLInputElement>);
      if (fromEnter.current) {
        fromEnter.current = false;
        return;
      }
      const form = input.form;
      if (form === null) return;
      const block = (submit: Event) => {
        submit.preventDefault();
        form.removeEventListener("submit", block, true);
      };
      form.addEventListener("submit", block, true);
      window.setTimeout(() => form.removeEventListener("submit", block, true), 100);
    };

    input.addEventListener("search", handle);
    return () => input.removeEventListener("search", handle);
  }, []);

  return (
    <input
      {...props}
      ref={nodeRef}
      type="search"
      onKeyDown={(event) => {
        if (event.key === "Enter") fromEnter.current = true;
        onKeyDown?.(event);
      }}
    />
  );
}
