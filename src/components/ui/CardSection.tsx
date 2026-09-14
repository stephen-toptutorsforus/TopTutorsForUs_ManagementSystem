/**
 * One labelled group inside a card.
 *
 * The booking form divides nineteen fields into four of these and it is the
 * reason a long screen is readable, so a record's own page uses the same
 * rhythm rather than inventing a second one: a small upright heading, space,
 * and a rule between neighbours.
 *
 * A `section` and an `h2`, where the booking form uses `fieldset` and
 * `legend`. The grouping is the same and the element is not — a `fieldset`
 * exists to group *controls*, and a session's scheduled length is a fact
 * rather than a control. Both carry `.card-section`, so the spacing is defined
 * once.
 *
 * The heading is a real `h2` because it is one: the page's `h1` is in
 * `PageHeader`, and a screen reader's heading list is the fastest way through
 * a page this long.
 */

export function CardSection({
  title,
  children,
  className,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `card-section ${className}` : "card-section"}>
      <h2 className="card-subhead">{title}</h2>
      {children}
    </section>
  );
}
