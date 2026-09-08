/**
 * What a screen says when it has nothing to show.
 *
 * Never a blank area: an empty list and a list that failed to load look the
 * same, and only one of them is somebody's fault. The message says what would
 * put something here.
 */

export function EmptyState({
  heading,
  message,
  glyph = "◌",
}: {
  heading: string;
  message: string;
  glyph?: string;
}) {
  return (
    <div className="empty">
      <span className="glyph" aria-hidden="true">
        {glyph}
      </span>
      <h3>{heading}</h3>
      <p>{message}</p>
    </div>
  );
}
