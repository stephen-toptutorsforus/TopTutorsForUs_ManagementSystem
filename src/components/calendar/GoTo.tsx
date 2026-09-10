/**
 * A control that moves the calendar, drawn as whatever it used to be a link to.
 *
 * Every one of these was a `<Link>` to `/calendar?view=…&date=…`, which is how
 * the range travelled: the address was the state. It is a cookie now — see
 * `lib/web/filterState.ts` — so moving the calendar is a submission rather than
 * a navigation, and the address of the page does not change.
 *
 * **One form for all of them.** `CALENDAR_FORM` is declared once by the page
 * and carries the filter as hidden fields; every button here is bound to it by
 * the `form=` attribute, which HTML allows precisely so a control can belong to
 * a form it does not sit inside. A form per day cell would be forty-two forms
 * on a month view.
 *
 * **`goto_` and not `view`/`date`.** The form already carries the current view
 * and date, and a button submitting a second `view` would be a duplicate key
 * whose first value — the old one — is what a parser reads. A separate name
 * that the action prefers says "instead of that" without depending on
 * document order.
 *
 * No script is needed for any of it: this is a submit button.
 */

export const CALENDAR_FORM = "calendar-goto";

export function GoTo({
  view,
  date,
  className,
  ariaCurrent,
  disabled,
  children,
}: {
  /** The view to move to, when that is what this control changes. */
  view?: string;
  /** The date to move to. */
  date?: string;
  className?: string;
  ariaCurrent?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  // One name and one value per button, which is all a submitter carries. Every
  // control here changes exactly one of the two, and the form holds the other.
  const [name, value] =
    view !== undefined ? (["goto_view", view] as const) : (["goto_date", date ?? ""] as const);

  return (
    <button
      type="submit"
      form={CALENDAR_FORM}
      name={name}
      value={value}
      className={className}
      aria-current={ariaCurrent ? "true" : undefined}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
