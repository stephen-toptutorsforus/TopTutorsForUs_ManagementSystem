/**
 * Buttons, and the things that look like buttons.
 *
 * Three elements wore `class="btn"` by hand across the application — `button`,
 * `a` and Next's `Link` — and which one is right is not a style question: a
 * control that performs an action is a button, and one that goes somewhere is a
 * link, and swapping them takes away middle-click, keyboard conventions and the
 * meaning announced to assistive technology. Keeping all three here, sharing
 * one class builder, makes the choice explicit at each call site instead of
 * incidental to whichever tag was nearest.
 */

import { Children } from "react";

import Link from "next/link";

/**
 * `link` is a button that looks like a link, for an action that sits in a row
 * of real links — "Assign" beside "Sessions" in the directory's Actions column.
 * The alternative was an anchor going nowhere, which is announced as a link to
 * nothing and swallows middle-click and Enter conventions to no purpose. Looking
 * alike is a style; being alike is not.
 */
export type ButtonVariant = "default" | "primary" | "danger" | "link";
export type ButtonSize = "default" | "small";

/**
 * `btn`, then the variant, then the size, then anything else.
 *
 * The order is fixed here because it was not fixed before — the same pair of
 * modifiers appeared as `btn btn-primary` in one place and `btn btn-small
 * btn-primary` in another. Nothing in the stylesheet cares, but a class string
 * that varies for no reason makes every diff of this markup harder to read.
 */
function classes(variant: ButtonVariant, size: ButtonSize, extra?: string): string {
  return [
    "btn",
    variant !== "default" && `btn-${variant}`,
    size !== "default" && `btn-${size}`,
    extra,
  ]
    .filter(Boolean)
    .join(" ");
}

type Common = { variant?: ButtonVariant; size?: ButtonSize; className?: string };

/** Performs an action. Submits a form, or runs a handler. */
export function Button({
  variant = "default",
  size = "default",
  className,
  type = "button",
  ...rest
}: Common & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={classes(variant, size, className)} type={type} {...rest} />;
}

/** Goes somewhere inside the application. */
export function LinkButton({
  variant = "default",
  size = "default",
  className,
  href,
  ...rest
}: Common & React.ComponentProps<typeof Link>) {
  return <Link className={classes(variant, size, className)} href={href} {...rest} />;
}

/**
 * Goes somewhere a `Link` cannot — a route handler that streams a file rather
 * than rendering a page, which is Export CSV and nothing else at present.
 *
 * Not for opening a panel. That used to be a fragment link, and this component
 * used to recommend it; overlays are React state now, and the control that
 * opens one is a `Button`.
 */
export function AnchorButton({
  variant = "default",
  size = "default",
  className,
  ...rest
}: Common & React.AnchorHTMLAttributes<HTMLAnchorElement>) {
  return <a className={classes(variant, size, className)} {...rest} />;
}

/**
 * A row of them, spaced and wrapped.
 *
 * `as="form"` where the row is the form that submits them, which is the usual
 * case for a panel of actions: wrapping a form in a row div adds an element
 * that exists only to carry a class.
 */
export function ButtonRow({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  as?: "div" | "form";
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement> &
  Pick<React.FormHTMLAttributes<HTMLFormElement>, "action" | "method">) {
  // A row of buttons with no buttons in it is not a row. Call sites write
  // `{canExport && <Button/>}`, so a row can end up holding nothing but refused
  // permissions — and an empty `.btn-row` still has a gap and a margin above
  // it. `Children.toArray` drops the `false`s for us.
  if (Children.toArray(children).length === 0) return null;

  return (
    <Tag className={className ? `btn-row ${className}` : "btn-row"} {...rest}>
      {children}
    </Tag>
  );
}
