"use client";

/**
 * What the page says after a dialog has closed.
 *
 * Every modal on this product used to leave itself open once its action had
 * succeeded. The notice appeared *inside* the dialog, so the only signal that
 * anything had happened was a line of text behind a panel somebody then had to
 * dismiss by hand — and, reported more than once, people pressed Create twice
 * because the form was still sitting there.
 *
 * So a completed action does two things: it closes the dialog, and it says what
 * happened where the page can be read. This is the second half.
 *
 * **Client state rather than a cookie.** A flash cookie is the usual shape for
 * this and is wrong here, because none of these actions navigates: a server
 * action returns to the same render tree, so there is no next request to carry
 * a cookie on. The message has to survive a re-render, not a redirect.
 *
 * **`role="status"`, not `alert`.** These announce a thing that succeeded.
 * `alert` interrupts a screen reader mid-sentence, which is right for "that
 * failed" and rude for "user created". Errors stay where they are — beside the
 * form that produced them, inside the dialog, which is where the field that
 * needs correcting is.
 *
 * The region sits above the page's own heading and is never removed from the
 * document, so an announcement is made by the text changing inside a live
 * region that was already there. A region added *with* its first message is one
 * most screen readers never announce at all.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type FlashTone = "good" | "warn" | "bad";

export interface FlashMessage {
  id: number;
  text: string;
  tone: FlashTone;
}

interface FlashApi {
  /** Say what happened. Returns the id, so a caller can dismiss it early. */
  notify: (text: string, tone?: FlashTone) => number;
  dismiss: (id: number) => void;
}

const FlashContext = createContext<FlashApi | null>(null);

/**
 * How long a message stays.
 *
 * Long enough to read a sentence twice at an unhurried pace, and short enough
 * that three actions in a row do not stack into a wall. Errors are not shown
 * here, so nothing that needs acting on is ever taken away by this timer.
 */
const LINGER_MS = 9000;

/**
 * Announcing an action's result, for anything under the app shell.
 *
 * `notify` is stable across renders, so a component may hold it in a dependency
 * list without re-subscribing on every keystroke.
 */
export function useFlash(): FlashApi {
  const api = useContext(FlashContext);
  // A no-op rather than a throw: a dialog rendered in a test, or on a page
  // outside the shell, should still work — it simply has nowhere to announce.
  return (
    api ?? {
      notify: () => 0,
      dismiss: () => {},
    }
  );
}

export function FlashProvider({ children }: { children: React.ReactNode }) {
  const [messages, setMessages] = useState<FlashMessage[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setMessages((current) => current.filter((message) => message.id !== id));
  }, []);

  const notify = useCallback((text: string, tone: FlashTone = "good") => {
    const id = nextId.current++;
    // Newest first: the thing that just happened is what somebody is looking
    // for, and it is at the top of the page rather than at the bottom of a list.
    setMessages((current) => [{ id, text, tone }, ...current].slice(0, 4));
    return id;
  }, []);

  const api = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <FlashContext.Provider value={api}>
      <FlashRegion messages={messages} onDismiss={dismiss} />
      {children}
    </FlashContext.Provider>
  );
}

const GLYPH: Record<FlashTone, string> = { good: "✓", warn: "!", bad: "✕" };

function FlashRegion({
  messages,
  onDismiss,
}: {
  messages: FlashMessage[];
  onDismiss: (id: number) => void;
}) {
  return (
    // Always in the document, empty or not — see the note at the top of this
    // file about live regions that arrive with their first message.
    <div className="flash-region" role="status" aria-live="polite">
      {messages.map((message) => (
        <FlashLine key={message.id} message={message} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function FlashLine({
  message,
  onDismiss,
}: {
  message: FlashMessage;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => onDismiss(message.id), LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [message.id, onDismiss]);

  return (
    <p className={`flash flash-${message.tone}`}>
      <span className="flash-glyph" aria-hidden="true">
        {GLYPH[message.tone]}
      </span>
      <span className="flash-text">{message.text}</span>
      <button
        type="button"
        className="flash-close"
        // The text is already read out by the live region; this control needs a
        // name of its own that says which one it closes.
        aria-label={`Dismiss: ${message.text}`}
        onClick={() => onDismiss(message.id)}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </p>
  );
}

/**
 * A dialog's action has succeeded: say so on the page, and close the dialog.
 *
 * The rule this enforces, which was not being followed anywhere: a modal that
 * has done what it was opened to do goes away. It had been leaving itself open
 * with a green line inside it, so the only way out was the control that means
 * "abandon this", and pressing Create twice was the obvious reading of a form
 * that was still sitting there.
 *
 * **Only success closes it.** An error keeps the dialog exactly where it is,
 * because the field that needs correcting is in it and a message about it on
 * the page behind would be a message beside nothing.
 *
 * `useActionState` hands back a new result object per submission, so the object
 * itself is the thing to watch: a notice that happens to repeat the previous
 * one — creating two people with the same message — is still a new result and
 * is still announced.
 */
export function useSettled(
  result: { notice?: string; error?: string } | undefined,
  onSettled: () => void,
): void {
  const { notify } = useFlash();
  const announced = useRef<object | null>(null);
  // Kept in a ref so a caller may pass an inline arrow without this firing
  // again on every render of the dialog. Written in an effect rather than
  // during render, which is the rule refs follow: a value read during render
  // can be the previous one after a bail-out.
  const settle = useRef(onSettled);
  useEffect(() => {
    settle.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    if (result === undefined || !result.notice) return;
    if (announced.current === result) return;
    announced.current = result;
    notify(result.notice);
    settle.current();
  }, [result, notify]);
}
