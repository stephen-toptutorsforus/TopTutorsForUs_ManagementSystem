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

import { Field } from "./Field";
import { SearchIcon } from "./icons";
import { SearchInput } from "./SearchInput";

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
  actions,
  toolbar,
  secondary,
  className,
}: {
  title: React.ReactNode;
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
  menu,
  filters,
  actions,
  form,
  className,
}: {
  /**
   * A `FilterControl` — the filter button, its menu, and the panel it opens —
   * before the search box. Outside the form, which is what keeps the panel's
   * own form from nesting inside this one, and what stops a menu press from
   * submitting the filters.
   *
   * There was a `drawer` slot on `PageHeader` beside this, for the panel. It
   * existed only because a fragment id was the only thing joining the button to
   * the panel; one component owns both now, so a page passes one slot.
   */
  menu?: React.ReactNode;
  filters?: React.ReactNode;
  actions?: React.ReactNode;
  /** Present when the filters submit. Absent for a toolbar of plain links. */
  form?: {
    /**
     * A server action, which is what every filter form now posts to. A string
     * is still accepted for a form that really is a navigation — none at
     * present, and the filters are not one: they change what this page shows
     * without changing where it is.
     */
    action: string | ((form: FormData) => void | Promise<void>);
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
  if (!isPresent(menu) && !isPresent(filters) && !isPresent(actions)) {
    return null;
  }

  const fields = isPresent(filters) ? (
    <div className="page-toolbar-fields">{filters}</div>
  ) : null;

  return (
    <div className={className ? `page-toolbar ${className}` : "page-toolbar"}>
      <div className="page-toolbar-row">
        {isPresent(menu) && <div className="page-toolbar-menu">{menu}</div>}
        {form === undefined ? (
          <div className="page-toolbar-filters">{fields}</div>
        ) : (
          <form
            className="page-toolbar-filters"
            // A method only means anything for a form that posts to a URL. A
            // server action decides its own transport.
            method={typeof form.action === "string" ? (form.method ?? "get") : undefined}
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
 * The toolbar's search box.
 *
 * Three pages were each writing out the same ten lines and each deciding for
 * themselves whether the label was drawn — it was on the directory and hidden
 * on the other two, so one toolbar sat lower than the others. The `id`, the
 * `name`, the type, the width class and the hidden label are settled here now,
 * and a page says only what it searches.
 *
 * `label` and `placeholder` are both required and both say something different:
 * the label is the accessible name, and the placeholder is what tells somebody
 * which of two fields they are typing in. A default for either would be a
 * worse answer than the page's own.
 *
 * No submit button beside it. Enter still searches. The clear control on a
 * search box does not: emptying the field used to submit the form and reload
 * the list. With scripting off, Enter is also what applies the filter menu's
 * ticks.
 */
export function SearchField({
  label,
  placeholder,
  defaultValue,
  name = "q",
  id = "q",
}: {
  /** The accessible name — "Search by name or email", not "Search". */
  label: string;
  /** Drawn in the empty field, and the only visible clue to what it searches. */
  placeholder: string;
  defaultValue?: string;
  name?: string;
  id?: string;
}) {
  return (
    <Field
      id={id}
      label={label}
      className="page-toolbar-search"
      labelClassName="visually-hidden"
    >
      {/* Before the input in the markup as well as on the screen, so it is
          not a decoration bolted on afterwards with `::before` — and hidden,
          because the label beside it already says what the field is. */}
      <span className="page-toolbar-search-icon" aria-hidden="true">
        <SearchIcon />
      </span>
      <SearchInput
        id={id}
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
      />
    </Field>
  );
}
