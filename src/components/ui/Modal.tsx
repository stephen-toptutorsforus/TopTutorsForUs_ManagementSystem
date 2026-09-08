/**
 * A panel opened by the URL.
 *
 * `:target` rather than `<dialog>`: a dialog that only a script can open is,
 * without one, a form nobody can reach. Opened by a link to its id, closed by a
 * link back to `#` — so it opens, submits and closes with scripting off.
 *
 * The scrim is a link for the same reason, and the parts that make it a dialog
 * to assistive technology — the role, and the heading it is labelled by — are
 * wired here rather than remembered at each call site.
 */

export function Modal({
  id,
  title,
  subtitle,
  children,
}: {
  id: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <div className="modal" id={id} role="dialog" aria-labelledby={titleId}>
      <a className="modal-scrim" href="#" tabIndex={-1} aria-hidden="true" />
      <div className="modal-card">
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <a className="modal-close" href="#" aria-label="Close">
            <span aria-hidden="true">×</span>
          </a>
        </div>
        {subtitle !== undefined && <p className="subtitle">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
