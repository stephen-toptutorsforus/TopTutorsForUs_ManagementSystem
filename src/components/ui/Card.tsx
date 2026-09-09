/**
 * The surface every screen is built on.
 *
 * Hand-written on every screen before this, which is how three of them ended up
 * with a border and a shadow and the rest with just a border. The title block
 * that used to live here has grown into `PageHeader`, which owns the toolbar and
 * the navigation row as well.
 */

export function Card({
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  /**
   * `section` where the card is a landmark worth naming, `form` where the card
   * *is* the form — a filter bar, say — and `div` otherwise. A form wrapped in
   * a card div is one element more than the page needs.
   */
  as?: "div" | "section" | "form";
  className?: string;
  children: React.ReactNode;
} & React.HTMLAttributes<HTMLElement> &
  Pick<React.FormHTMLAttributes<HTMLFormElement>, "action" | "method">) {
  return (
    <Tag className={className ? `card ${className}` : "card"} {...rest}>
      {children}
    </Tag>
  );
}

/** Cards laid out in a row that wraps — the dashboard's figures, mostly. */
export function CardGrid({ children }: { children: React.ReactNode }) {
  return <div className="card-grid">{children}</div>;
}
