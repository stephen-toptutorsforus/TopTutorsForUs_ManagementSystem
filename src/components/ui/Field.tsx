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

/**
 * A select over a list of records, with an optional "none chosen" first entry.
 *
 * Twenty of the twenty-two selects in the application are this: map a list to
 * options, sometimes after a `<option value="">Anyone</option>`. What differed
 * between them was nothing — one wrote `key` on the option and another did not,
 * one put the empty option inside the map and another outside.
 *
 * The list arrives already shaped as `{ value, label }` because only the page
 * knows whether a person's label is their name, their name and address, or
 * their reference. Every other select attribute passes straight through, so a
 * controlled select, an `aria-describedby`, a `required` and a `key` all still
 * work exactly as they did.
 */
export function OptionSelect({
  options,
  placeholder,
  ...select
}: {
  options: readonly { value: string; label: string }[];
  /** The label on the empty first option. Omitted where a choice is required. */
  placeholder?: string;
  // `WithRef`, so a caller can hold the element — the assign dialog focuses its
  // first select when it opens. In React 19 a ref is an ordinary prop, but the
  // attribute types do not include it, so it has to be asked for.
} & React.ComponentPropsWithRef<"select">) {
  return (
    <select {...select}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((option) => (
        <option value={option.value} key={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

/**
 * One tick or one radio, with its label beside it.
 *
 * `<label class="choice"><input/><span/></label>`, written out twenty-odd times
 * across the session grid's columns, the create-user modal and the scope
 * chooser. The wrapper is the whole point of the pattern — it makes the words
 * part of the hit area — and it was the part most often retyped.
 */
export function Choice({
  label,
  ...input
}: {
  label: React.ReactNode;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="choice">
      <input {...input} />
      <span>{label}</span>
    </label>
  );
}

/**
 * A named group of them.
 *
 * A `<fieldset>` and a `<legend>`, because that is what tells a screen reader
 * which question a row of ticks answers — reading "Scheduled, Completed,
 * Missed" with no legend says nothing about what is being chosen.
 */
export function ChoiceGroup({
  legend,
  legendClassName,
  hint,
  children,
  className,
}: {
  legend: React.ReactNode;
  legendClassName?: string;
  /**
   * What follows the row, inside the fieldset. Two of the three groups have
   * one, and it belongs to the question rather than to the form around it — so
   * it goes inside, where a screen reader reads it with the legend.
   */
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <fieldset className={className}>
      <legend className={legendClassName}>{legend}</legend>
      <div className="choice-row">{children}</div>
      {hint}
    </fieldset>
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
