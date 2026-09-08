/**
 * A table, and the box that lets it be wider than the screen.
 *
 * The wrapper scrolls so the page does not, and below the breakpoint the
 * stylesheet turns each row into a card — which is why every cell needs a
 * `data-label`: it becomes the row's label once the header is gone. A table
 * written without them loses its headings entirely on a phone, which is a
 * defect nothing about the desktop layout reveals.
 *
 * The caption is required rather than optional. It is what names the table to
 * anyone listing a page's tables, and a caption invented at the call site is
 * the first thing dropped when markup is copied to a second screen.
 */

export function TableWrap({
  caption,
  className,
  children,
}: {
  /** Visually hidden by default — the heading above usually says it too. */
  caption: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="table-wrap">
      <table className={className}>
        <caption className="visually-hidden">{caption}</caption>
        {children}
      </table>
    </div>
  );
}
