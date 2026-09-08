/**
 * A labelled control.
 *
 * Written out by hand fifty-six times: the same wrapper, the same label, the
 * same `htmlFor`.
 *
 * It owns the wrapper and the label and stops there. An earlier draft handed
 * the control a generated id and an `aria-describedby` built from it, which is
 * the wiring most worth guaranteeing — but the fields here are not uniform
 * enough for it. One is described by two hints at once
 * (`aria-describedby="count-hint count-repeat"`); several hold a select and
 * its options, or a picker and the chips it fills. Generating those ids would
 * have renamed every one of them to prove a point. The control keeps its id
 * and its own describedby; the label is told where to point.
 */

export function Field({
  id,
  label,
  className,
  labelClassName,
  children,
  ...rest
}: {
  /** The control's id. The label points at it; the control still carries it. */
  id: string;
  label: React.ReactNode;
  className?: string;
  /** For a label that is present but not drawn — a search box in a toolbar. */
  labelClassName?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={className ? `field ${className}` : "field"} {...rest}>
      <label className={labelClassName} htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

/** Secondary text: a unit, a caveat, an explanation of an empty cell. */
export function Hint({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={className ? `hint ${className}` : "hint"} {...rest}>
      {children}
    </span>
  );
}

/** Text only a screen reader reaches. */
export function VisuallyHidden({ children }: { children: React.ReactNode }) {
  return <span className="visually-hidden">{children}</span>;
}
