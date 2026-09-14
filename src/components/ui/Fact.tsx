/**
 * One labelled value, in the shape `Field` gives one labelled control.
 *
 * A session's own page shows the same things the booking screen collects —
 * type, title, date, length, start time, instructor, students — and reading
 * them back in a different layout from the one they were entered in makes two
 * screens out of one subject. So this is `Field`'s read-only counterpart: the
 * same label, the same rhythm, the same `.form-row` grids, so a fact sits
 * exactly where the control that set it sat.
 *
 * **A box, but not an input's box.** It borrows the padding, radius and height
 * so the columns line up, and then deliberately differs: a filled ground
 * rather than paper, and a quieter border. A read-only field drawn as an
 * editable one is a control people click into and cannot type in, which is a
 * worse fault than a layout that does not quite line up.
 *
 * **A `span`, not a `label`.** `label` means "this names a control", and
 * `htmlFor` pointing at something that is not one is a promise to a screen
 * reader that nothing keeps. The definition-list markup this replaced said the
 * same thing correctly and is still right for a dense run of pairs — `Fact` is
 * for the places a page is echoing a form.
 */

export function Fact({
  label,
  children,
  className,
  wide,
}: {
  label: React.ReactNode;
  /** The value. `null` and `undefined` draw the em dash rather than nothing. */
  children: React.ReactNode;
  className?: string;
  /** Let the value wrap and grow — a description, a list of names. */
  wide?: boolean;
}) {
  const empty = children === null || children === undefined || children === "";
  return (
    <div className={className ? `field fact ${className}` : "field fact"}>
      <span className="fact-label">{label}</span>
      <p className={wide ? "fact-value is-wide" : "fact-value"}>
        {empty ? <span className="fact-empty">&mdash;</span> : children}
      </p>
    </div>
  );
}
