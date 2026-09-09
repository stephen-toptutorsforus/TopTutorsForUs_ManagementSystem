/**
 * The shared page header.
 *
 * Rendered to a string with `react-dom/server`, not into a DOM: these are
 * server components with no state and no effects, so what the server sends is
 * the whole of what they are. A jsdom environment would buy a dependency and
 * test the same markup.
 *
 * The cases worth pinning are the ones that were wrong on at least one page
 * before there was a component: an empty box where a refused permission used to
 * be, a second `<h1>`, a form inside a form, a filter count announced only as a
 * colour.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MoreFilters, PageHeader, PageToolbar, SearchField } from "@/components/ui";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);
const count = (markup: string, needle: string) => markup.split(needle).length - 1;

describe("PageHeader", () => {
  it("renders every slot it is given", () => {
    const markup = html(
      <PageHeader
        title="Calendar"
        actions={<button type="button">Export</button>}
        toolbar={<PageToolbar filters={<input name="q" />} />}
        secondary={<nav aria-label="Change date range">arrows</nav>}
      />,
    );

    expect(markup).toContain("<h1>Calendar</h1>");
    expect(markup).toContain('<div class="page-header-actions">');
    expect(markup).toContain('<div class="page-toolbar">');
    expect(markup).toContain('<div class="page-header-secondary">');
    expect(markup).toContain('aria-label="Change date range"');
  });

  it("is a header, and holds the page's only h1", () => {
    // Inside `<main>`, so it is a section header and not a second banner
    // landmark competing with the mobile TopBar.
    const markup = html(<PageHeader title="Sessions" />);

    expect(markup.startsWith('<header class="page-header">')).toBe(true);
    expect(count(markup, "<h1>")).toBe(1);
  });

  it("leaves out the slots it is not given, rather than emptying them", () => {
    const markup = html(<PageHeader title="Session Booking" />);

    expect(markup).not.toContain("page-header-actions");
    expect(markup).not.toContain("page-header-secondary");
    expect(markup).not.toContain("subtitle");
    expect(markup).not.toContain("page-toolbar");
  });

  it("treats a refused permission as no actions at all", () => {
    // The shape every page writes: `actions={canBook && <Button/>}`. Rendering
    // `false` produces no markup, but the wrapper around it is still a box with
    // padding, which is an empty action area on exactly the pages where
    // somebody is not allowed to act.
    const canBook = false;
    const markup = html(<PageHeader title="Sessions" actions={canBook && <button />} />);

    expect(markup).not.toContain("page-header-actions");
  });
});

describe("PageToolbar", () => {
  it("names its form, and only calls it a search when there is one", () => {
    // A `search` landmark with nothing to search in it sends a screen reader
    // user somewhere useless, so the role is per page rather than automatic.
    const named = { action: "/availability", label: "Choose whose availability to show" };
    const picker = html(<PageToolbar form={named} filters={<select />} />);

    expect(picker).toContain('aria-label="Choose whose availability to show"');
    expect(picker).not.toContain('role="search"');
    expect(html(<PageToolbar form={{ ...named, role: "search" }} filters={<select />} />)).toContain(
      'role="search"',
    );
  });

  it("owns one form, with the actions outside it", () => {
    // "Create User" opens a modal that has a form of its own. If the toolbar
    // put the actions inside the filter form, that modal would be a form inside
    // a form, which is not parseable HTML.
    const markup = html(
      <PageToolbar
        form={{ action: "/people", label: "Search and filter people", role: "search" }}
        filters={<input name="q" />}
        actions={<a href="#create-user">Create User</a>}
      />,
    );

    expect(count(markup, "<form")).toBe(1);
    expect(markup).toContain('role="search"');
    expect(markup).toContain('aria-label="Search and filter people"');
    // The actions come after the form closes.
    expect(markup.indexOf("</form>")).toBeLessThan(markup.indexOf("Create User"));
  });

  it("puts the advanced filters inside the form, so they submit with it", () => {
    const markup = html(
      <PageToolbar
        form={{ action: "/sessions", label: "Search and filter sessions" }}
        filters={<input name="q" />}
        advancedFilters={
          <MoreFilters>
            <input name="from" />
          </MoreFilters>
        }
      />,
    );

    const open = markup.indexOf("<form");
    const close = markup.indexOf("</form>");
    expect(markup.indexOf('name="from"')).toBeGreaterThan(open);
    expect(markup.indexOf('name="from"')).toBeLessThan(close);
  });

  it("renders no form at all when the filters do not submit", () => {
    const markup = html(<PageToolbar filters={<span>a summary</span>} />);

    expect(markup).not.toContain("<form");
    expect(markup).toContain('<div class="page-toolbar-filters">');
  });

  it("is nothing when it has nothing — booking gets no toolbar", () => {
    // The booking page has a title and a form, and no list to narrow. A
    // bordered white bar with nothing in it is what this prevents.
    expect(html(<PageToolbar />)).toBe("");
    expect(html(<PageToolbar filters={undefined} actions={false} />)).toBe("");
    expect(html(<PageHeader title="Session Booking" toolbar={<PageToolbar />} />)).not.toContain(
      "page-toolbar",
    );
  });

  it("leaves out an actions box when every action is refused", () => {
    const markup = html(
      <PageToolbar
        form={{ action: "/calendar", label: "Filter the calendar" }}
        filters={<input name="q" />}
        actions={undefined}
      />,
    );

    expect(markup).not.toContain("page-toolbar-actions");
  });
});

describe("MoreFilters", () => {
  it("has an accessible name and no count when nothing is set", () => {
    const markup = html(
      <MoreFilters>
        <input name="from" />
      </MoreFilters>,
    );

    expect(markup).toContain("<summary><span>More filters</span></summary>");
    expect(markup).not.toContain("page-toolbar-count");
    expect(markup).not.toContain("open=");
  });

  it("shows the number set, and says it in words as well", () => {
    // The number is drawn; the phrase is what a screen reader reaches. Neither
    // is a colour — the same rule the status badges follow.
    const markup = html(
      <MoreFilters active={3}>
        <input name="from" />
      </MoreFilters>,
    );

    expect(markup).toContain('<span class="page-toolbar-count" aria-hidden="true">3</span>');
    expect(markup).toContain('<span class="visually-hidden">— 3 active</span>');
  });

  it("opens itself when something inside it is filtering", () => {
    // Arriving on a page narrowed by a date range should show the date range,
    // not a closed panel hinting that one exists.
    expect(html(<MoreFilters active={1}>x</MoreFilters>)).toContain("open=");
    expect(html(<MoreFilters active={0}>x</MoreFilters>)).not.toContain("open=");
  });

  it("takes a label, for a page where these are the only filters", () => {
    expect(html(<MoreFilters label="Filters" active={2}>x</MoreFilters>)).toContain(
      "<span>Filters</span>",
    );
  });
});

describe("SearchField", () => {
  it("settles the wiring three pages were each deciding for themselves", () => {
    // The id, the name, the type, the width class and the hidden label. What
    // varies is only what the page searches.
    const markup = html(
      <SearchField
        label="Search by name or email"
        placeholder="Name or email"
        defaultValue="mercer"
      />,
    );

    expect(markup).toContain('<div class="field page-toolbar-search">');
    expect(markup).toContain('<label class="visually-hidden" for="q">Search by name or email</label>');
    expect(markup).toContain('id="q"');
    expect(markup).toContain('name="q"');
    expect(markup).toContain('type="search"');
    expect(markup).toContain('placeholder="Name or email"');
    expect(markup).toContain('value="mercer"');
  });

  it("draws the magnifier before the input, and hides it from a reader", () => {
    // The label already says what the field is, so the icon is decoration —
    // and it comes first in the markup rather than being bolted on with a
    // pseudo-element, so it is where it looks like it is.
    const markup = html(<SearchField label="Search" placeholder="Search" />);

    expect(markup.indexOf("page-toolbar-search-icon")).toBeLessThan(markup.indexOf("<input"));
    expect(markup).toContain('<span class="page-toolbar-search-icon" aria-hidden="true">');
    expect(markup).toContain("<svg");
    expect(markup).toContain("</svg>");
  });

  it("keeps a name for a screen reader even though none is drawn", () => {
    const markup = html(<SearchField label="Search session titles" placeholder="Session title" />);

    expect(markup).toContain('class="visually-hidden" for="q"');
    expect(markup).toContain("Search session titles");
  });

  it("can be a second search box on a page that needs one", () => {
    const markup = html(
      <SearchField id="student-q" name="student_q" label="Find a student" placeholder="Name" />,
    );

    expect(markup).toContain('for="student-q"');
    expect(markup).toContain('name="student_q"');
  });
});
