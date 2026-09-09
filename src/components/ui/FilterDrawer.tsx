/**
 * The panel the filter button opens, and the groups inside it.
 *
 * The button and its menu are in `FilterActions`, which needs a browser; this
 * half does not, so it stays on the server and its markup never reaches the
 * bundle.
 *
 * **It works with scripting off.** The drawer is `:target` and it is a plain GET
 * form whose Apply is a submit — the same idioms as the navigation drawer and
 * the People modals, for the same reason. A filter panel that only opens under
 * a script is a filter nobody can reach when the script fails.
 *
 * **The drawer is a whole form, not a fragment of the toolbar's.** It carries
 * every filter the page has, including the search text the toolbar also shows.
 * Two forms cannot be nested and one cannot reach into the other, so the choice
 * is between a partial drawer that silently drops the search text on Apply and
 * a complete one that restates it. It restates it — under different ids, since
 * two `id="q"` on one page is invalid and breaks both labels.
 */

import { Button, LinkButton } from "./Button";

/** Marks the drawer's `:target` id, so the button and the panel cannot drift. */
export const FILTER_DRAWER_ID = "edit-filter";

/**
 * The panel itself.
 *
 * A `<form>` and not a dialog: Apply is a submit, Cancel is a link back to `#`,
 * and the browser closes the drawer on its own when the submit navigates away.
 * `aria-labelledby` points at the heading, and the scrim is a link, both for
 * the same reasons as `Modal`.
 */
export function FilterDrawer({
  id = FILTER_DRAWER_ID,
  title = "Edit filter",
  action,
  resetHref,
  children,
}: {
  id?: string;
  title?: React.ReactNode;
  /** Where the filter submits — the page's own path. */
  action: string;
  /** Where "Reset filter" inside the drawer goes. */
  resetHref: string;
  children: React.ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <div className="filterdrawer" id={id} role="dialog" aria-labelledby={titleId}>
      <a className="filterdrawer-scrim" href="#" tabIndex={-1} aria-hidden="true" />
      <form className="filterdrawer-panel" method="get" action={action}>
        <div className="filterdrawer-head">
          <h2 id={titleId}>{title}</h2>
          <a className="filterdrawer-close" href="#" aria-label="Close filter panel">
            <span aria-hidden="true">×</span>
          </a>
        </div>

        <div className="filterdrawer-body">{children}</div>

        <div className="filterdrawer-foot">
          {/* "Reset filter", not "Clear all": every box in here starts ticked,
              so clearing the filter *ticks* boxes rather than emptying them,
              and the menu outside calls the same destination by this name. */}
          <LinkButton href={resetHref}>Reset filter</LinkButton>
          <span className="filterdrawer-gap" />
          {/* Cancel is a link to `#`, which un-targets the drawer and leaves
              the page exactly as it was — no submit, so nothing typed here
              reaches the address. */}
          <a className="btn" href="#">
            Cancel
          </a>
          <Button variant="primary" type="submit">
            Apply
          </Button>
        </div>
      </form>
    </div>
  );
}

/** One headed group of fields inside the drawer. */
export function FilterSection({
  legend,
  children,
}: {
  legend: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="filterdrawer-section">
      <legend>{legend}</legend>
      <div className="filterdrawer-section-body">{children}</div>
    </fieldset>
  );
}
