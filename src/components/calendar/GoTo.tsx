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
 * **A submitter carries one name and one value, so a control that changes both
 * has to say both in that one value.** "+3 more" wanted the day view *and* that
 * day; it could only send `goto_date`, so it moved the anchor inside a month
 * that renders the same either way and the press did nothing at all — reported
 * as a dead button, and it was. `goto_at` carries `view|date` for exactly that
 * case, and `applyCalendarState` splits it.
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
  // One name and one value per button, which is all a submitter carries. Most
  // of these change one of the two and let the form hold the other; a control
  // that changes both packs them into the single value it is allowed.
  const [name, value] =
    view !== undefined && date !== undefined
      ? (["goto_at", `${view}|${date}`] as const)
      : view !== undefined
        ? (["goto_view", view] as const)
        : (["goto_date", date ?? ""] as const);

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
