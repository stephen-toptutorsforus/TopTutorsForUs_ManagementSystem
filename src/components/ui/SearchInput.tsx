"use client";

/**
 * A search box. Enter applies what was typed.
 *
 * `type="search"` draws a control that empties the field. In Chromium that
 * control, and Escape, fire a `search` event and then submit the form.
 * Enter is told apart from those by a flag set on keydown, which happens
 * before the search event.
 *
 * `submitOnClear` lets that following submit through once the field is
 * empty, so the list underneath is the unfiltered one. A picker and a
 * filter drawer leave it off: one lives inside another form, and the other
 * applies on its own button.
 *
 * The listener is native. React's `onSearch` prop is stored on the element
 * and never called for this event.
 *
 * The blocker is removed shortly afterwards if nothing submitted. A browser
 * that clears the field without submitting must not swallow the Enter that
 * follows.
 */

import { useEffect, useRef } from "react";

export function SearchInput({
  onKeyDown,
  onSearch,
  submitOnClear = false,
  ...props
}: Omit<React.ComponentProps<"input">, "onSearch"> & {
  /** The clear control applies an empty search and reloads the list. */
  submitOnClear?: boolean;
  onSearch?: (event: React.SyntheticEvent<HTMLInputElement>) => void;
}) {
  const fromEnter = useRef(false);
  const onSearchRef = useRef(onSearch);
  const nodeRef = useRef<HTMLInputElement>(null);
  const submitOnClearRef = useRef(submitOnClear);
  onSearchRef.current = onSearch;
  submitOnClearRef.current = submitOnClear;

  useEffect(() => {
    const input = nodeRef.current;
    if (input === null) return;

    const handle = (event: Event) => {
      onSearchRef.current?.(event as unknown as React.SyntheticEvent<HTMLInputElement>);
      if (fromEnter.current) {
        fromEnter.current = false;
        return;
      }
      // The clear control has already emptied the field. It fires `search`
      // and does not submit, so the list would stay on the old text. Submit
      // the form that owns the box.
      if (submitOnClearRef.current && input.value === "") {
        input.form?.requestSubmit();
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
