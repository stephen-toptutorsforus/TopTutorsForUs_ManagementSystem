/**
 * A labelled control.
 *
 * Written out by hand fifty-six times, and the label was wired to the control
 * by a matching `htmlFor`/`id` pair each time — which is the part that quietly
 * stops being true. Here the id is passed once and used for both, and the hint
 * is wired to `aria-describedby` rather than left as a paragraph that happens
 * to sit underneath.
 */

export function Field({
  id,
  label,
  hint,
  error,
  className,
  labelSuffix,
  children,
}: {
  id: string;
  label: React.ReactNode;
  /** Guidance. Announced with the control, not merely printed near it. */
  hint?: React.ReactNode;
  /** Shown only once the field has been left — see the stylesheet's note. */
  error?: React.ReactNode;
  className?: string;
  /** Anything that belongs on the label's line, such as a units note. */
  labelSuffix?: React.ReactNode;
  /** Given the id and, when there is one, the id describing it. */
  children: (props: { id: string; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const hintId = hint !== undefined ? `${id}-hint` : undefined;
  const errorId = error !== undefined ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={className ? `field ${className}` : "field"}>
      <label htmlFor={id}>
        {label}
        {labelSuffix}
      </label>
      {children({ id, "aria-describedby": describedBy })}
      {hint !== undefined && (
        <span className="hint" id={hintId}>
          {hint}
        </span>
      )}
      {error !== undefined && (
        <span className="error" id={errorId}>
          {error}
        </span>
      )}
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
