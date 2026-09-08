/**
 * The two boxes every screen is built from.
 *
 * `Card` is a surface on the page; `PageHead` is the title block above it. Both
 * were hand-written on every screen, which is how the same heading ended up
 * with a subtitle in a `<p class="subtitle">` on one page and a bare paragraph
 * on another.
 */

export function Card({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  /** `section` where the card is a landmark worth naming, `div` otherwise. */
  as?: "div" | "section";
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <Tag className={className ? `card ${className}` : "card"} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * The title, what the page is for, and anything acting on the whole of it.
 *
 * `actions` rather than free children on the right, because the layout only
 * works with exactly two boxes: without the wrapper the title and subtitle
 * become separate flex items and the subtitle lands beside the heading.
 */
export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {subtitle !== undefined && <p className="subtitle">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}
