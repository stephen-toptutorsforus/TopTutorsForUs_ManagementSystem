/**
 * The header area every administration screen starts with.
 *
 * The title block, the filter toolbar under it, and the navigation row under
 * that were built separately on each page: `.page-head` here, `.cal-toolbar`
 * there, `.people-toolbar` on a third, `.filters` on a fourth. Four names for
 * the same three boxes, which is why the search field was a fixed 260px on two
 * screens and elastic on a third, why one toolbar was a bordered bar and
 * another a card, and why the actions sat at different heights depending on
 * which page you were reading.
 *
 * **Slots, not children.** The layout only works with boxes whose shape it
 * knows: without a wrapper the title and the subtitle become separate flex
 * items and the subtitle lands beside the heading rather than under it. Each
 * slot takes a `ReactNode`, so a page passes its own fields, its own
 * permission-gated actions, its own view switcher — none of which this file
 * knows anything about.
 *
 * **Nothing here parses a query or loads data.** A count of active filters is
 * passed in, because working it out means knowing which parameters are filters
 * and which are state, and that is the page's business. This file owns spacing,
 * order, and what gets announced.
 *
 * **A `<header>`, and not a banner.** It sits inside `<main>`, which under the
 * HTML sectioning rules makes it a section header rather than the document's
 * banner landmark — so it does not compete with `TopBar`, which is the
 * application's real banner and is untouched by any of this.
 */

import { VisuallyHidden } from "./Field";

/**
 * Title, subtitle, and the three rows that may follow.
 *
 * `actions` is what acts on the page as a whole without narrowing it — Export
 * CSV, New session. `toolbar` is the search-and-filter bar. `secondary` is a row
 * that changes what the page is *showing* rather than which records it shows:
 * the calendar's date range and view switcher, and so far nothing else.
 *
 * The `h1` lives here, so every page has exactly one of them by construction.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
  toolbar,
  secondary,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  toolbar?: React.ReactNode;
  secondary?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={className ? `page-header ${className}` : "page-header"}>
      <div className="page-header-main">
        <div className="page-header-title">
          <h1>{title}</h1>
          {subtitle !== undefined && <p className="subtitle">{subtitle}</p>}
        </div>
        {/* Only when there is something to put in it. An empty flex item still
            takes part in the row's justification, which is how a page with no
            actions ended up with its title in a different place from one that
            had them. */}
        {isPresent(actions) && <div className="page-header-actions">{actions}</div>}
      </div>
      {toolbar}
      {isPresent(secondary) && <div className="page-header-secondary">{secondary}</div>}
    </header>
  );
}

/**
 * Whether a slot has anything in it.
 *
 * `undefined` is the obvious empty, but a page writes
 * `actions={canBook && <Button/>}` and hands over `false` when the permission
 * is absent. Rendering `false` produces no markup, but the wrapper around it is
 * still a box with padding — an empty toolbar row on exactly the pages where
 * somebody is not allowed to act.
 */
function isPresent(slot: React.ReactNode): boolean {
  return slot !== undefined && slot !== null && slot !== false && slot !== "";
}

/**
 * The bar under the title: what narrows the list on the left, what adds to it
 * on the right.
 *
 * **It owns the form, and `actions` stays outside it.** That split is the whole
 * reason this is a component rather than three class names. The filter controls
 * have to be inside one `<form>` to submit together — including the ones under
 * "More filters", which is why `advancedFilters` renders inside it rather than
 * as a sibling. The actions have to be outside it: "Create User" opens a modal
 * with a form of its own, and a form inside a form is not parseable HTML. A
 * hand-written `<form>` passed in through a slot could satisfy one of those at
 * a time, so the component holds the boundary instead of the page.
 *
 * `form.label` is not optional. Three search forms in one application all
 * announced as "search" is the failure this prevents, and a required prop is
 * cheaper than remembering.
 *
 * Renders nothing at all when every slot is empty, rather than a bordered white
 * bar with nothing in it.
 */
export function PageToolbar({
  filters,
  actions,
  advancedFilters,
  form,
  className,
}: {
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  /** A `MoreFilters` disclosure. Inside the form, below the fields. */
  advancedFilters?: React.ReactNode;
  /** Present when the filters submit. Absent for a toolbar of plain links. */
  form?: {
    action: string;
    method?: "get" | "post";
    /** What this form is for, announced. Required, see above. */
    label: string;
    /**
     * `search` where there is something to type in — the landmark a screen
     * reader user jumps to for exactly that. Left off the availability picker,
     * which has one select and no search field: a search landmark with nothing
     * to search in it is a lie, and a named `<form>` is already a landmark.
     */
    role?: "search";
  };
  className?: string;
}) {
  if (!isPresent(filters) && !isPresent(actions) && !isPresent(advancedFilters)) {
    return null;
  }

  const fields = (
    <>
      {isPresent(filters) && <div className="page-toolbar-fields">{filters}</div>}
      {advancedFilters}
    </>
  );

  return (
    <div className={className ? `page-toolbar ${className}` : "page-toolbar"}>
      <div className="page-toolbar-row">
        {form === undefined ? (
          <div className="page-toolbar-filters">{fields}</div>
        ) : (
          <form
            className="page-toolbar-filters"
            method={form.method ?? "get"}
            action={form.action}
            role={form.role}
            aria-label={form.label}
          >
            {fields}
          </form>
        )}
        {isPresent(actions) && <div className="page-toolbar-actions">{actions}</div>}
      </div>
    </div>
  );
}

/**
 * The filters that are not worth a permanent row.
 *
 * A `<details>` at every width — not a row on a wide screen and a disclosure on
 * a narrow one. That was the first design and it does not work: a closed
 * `<details>` cannot be forced open by author CSS. Chromium computes the
 * override of the UA's `content-visibility: hidden` and still lays the content
 * out at zero height, which is worth knowing before building on it rather than
 * after.
 *
 * The alternatives were worse. A second copy of the markup means duplicate
 * `name` and `id` attributes inside one form; a client component that collapses
 * the row after first paint means watching the filters fold away on load.
 *
 * So what changes with the viewport is the always-visible half above it: search
 * stays at every width, because search is how records are found on all of these
 * screens, and the rest is one press away.
 *
 * `active` is a count the page works out. It is drawn as a number and announced
 * as a phrase, never as a colour alone — the rule the status badges already
 * follow. It also opens the panel: arriving on a page filtered by a date range
 * should show the date range, not a closed panel hinting that one exists.
 */
export function MoreFilters({
  label = "More filters",
  active = 0,
  children,
}: {
  label?: React.ReactNode;
  active?: number;
  children: React.ReactNode;
}) {
  return (
    <details className="page-toolbar-more" open={active > 0}>
      <summary>
        <span>{label}</span>
        {active > 0 && (
          <>
            <span className="page-toolbar-count" aria-hidden="true">
              {active}
            </span>
            <VisuallyHidden>— {active} active</VisuallyHidden>
          </>
        )}
      </summary>
      <div className="page-toolbar-more-body">{children}</div>
    </details>
  );
}
