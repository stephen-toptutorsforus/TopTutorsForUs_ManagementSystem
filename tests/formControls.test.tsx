/**
 * The shared form controls.
 *
 * `OptionSelect`, `Choice` and `ChoiceGroup` replaced twenty-two hand-written
 * selects and nine hand-written tick boxes. The markup they produce has to be
 * what those produced, so these tests are mostly about exact output — a wrapper
 * that quietly stops making the label part of the hit area, or an empty option
 * that appears where a choice is required, is the kind of change nothing else
 * here would notice.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Choice, ChoiceGroup, EmailField, OptionSelect, PhoneField } from "@/components/ui";
import { PHONE_PATTERN, isEmail, isPhone } from "@/lib/shapes";

const html = (node: React.ReactElement) => renderToStaticMarkup(node);

const PEOPLE = [
  { value: "usr_a", label: "Imani Okafor" },
  { value: "usr_b", label: "Dara Nwosu" },
];

describe("OptionSelect", () => {
  it("writes the options in order", () => {
    expect(html(<OptionSelect id="instructor" name="instructor" options={PEOPLE} />)).toBe(
      '<select id="instructor" name="instructor">' +
        '<option value="usr_a">Imani Okafor</option>' +
        '<option value="usr_b">Dara Nwosu</option>' +
        "</select>",
    );
  });

  it("puts the placeholder first, as the empty value", () => {
    // "Anyone" and "No program" are not values — they are the absence of one,
    // which is what an empty `value` means to the query parser.
    const markup = html(<OptionSelect options={PEOPLE} placeholder="Anyone" />);

    expect(markup).toContain('<select><option value="">Anyone</option><option value="usr_a"');
  });

  it("leaves the empty option out where a choice is required", () => {
    const markup = html(<OptionSelect options={PEOPLE} required />);

    expect(markup).not.toContain('value=""');
    expect(markup).toContain("required");
  });

  it("passes every other attribute through untouched", () => {
    // A controlled select, a description, a name: all of them were on at least
    // one of the call sites this replaced.
    const markup = html(
      <OptionSelect
        options={PEOPLE}
        name="instructor_ref"
        aria-describedby="who-hint"
        defaultValue="usr_b"
        className="field-auto"
      />,
    );

    expect(markup).toContain('name="instructor_ref"');
    expect(markup).toContain('aria-describedby="who-hint"');
    expect(markup).toContain('class="field-auto"');
    expect(markup).toContain('<option value="usr_b" selected=""');
  });

  it("renders an empty list as an empty select rather than failing", () => {
    expect(html(<OptionSelect options={[]} placeholder="Anyone" />)).toBe(
      '<select><option value="">Anyone</option></select>',
    );
  });
});

describe("Choice", () => {
  it("keeps the words inside the label, where they are part of the hit area", () => {
    expect(html(<Choice type="checkbox" name="billable" label="Billable" />)).toBe(
      '<label class="choice"><input type="checkbox" name="billable"/><span>Billable</span></label>',
    );
  });

  it("works checked-and-controlled as well as uncontrolled", () => {
    expect(html(<Choice type="checkbox" name="columns" value="title" defaultChecked label="Title" />)).toContain(
      'checked=""',
    );
    expect(
      html(<Choice type="radio" name="scope" value="all" checked readOnly label="All" />),
    ).toContain('checked=""');
  });
});

describe("ChoiceGroup", () => {
  it("names the question the row answers", () => {
    // Without the legend a screen reader reads "Title, Instructor, Students"
    // and never says what is being chosen.
    const markup = html(
      <ChoiceGroup legend="Columns">
        <Choice type="checkbox" name="columns" value="title" label="Title" />
      </ChoiceGroup>,
    );

    expect(markup).toBe(
      "<fieldset><legend>Columns</legend>" +
        '<div class="choice-row">' +
        '<label class="choice"><input type="checkbox" name="columns" value="title"/><span>Title</span></label>' +
        "</div></fieldset>",
    );
  });

  it("keeps the hint inside the fieldset, with the legend", () => {
    // It explains the question, so it belongs to the group rather than to the
    // form around it.
    const markup = html(
      <ChoiceGroup legend="Apply this change to" hint={<p className="hint">Past sessions are never changed.</p>}>
        <Choice type="radio" name="scope" value="this" label="Only this session" />
      </ChoiceGroup>,
    );

    expect(markup.indexOf("Past sessions")).toBeLessThan(markup.indexOf("</fieldset>"));
    expect(markup.indexOf("choice-row")).toBeLessThan(markup.indexOf("Past sessions"));
  });

  it("omits the hint entirely when there is none", () => {
    const markup = html(
      <ChoiceGroup legend="Columns">
        <Choice type="checkbox" name="c" value="a" label="A" />
      </ChoiceGroup>,
    );

    expect(markup).not.toContain("hint");
  });
});

describe("EmailField and PhoneField", () => {
  // The value is controlled and the complaint only appears once the field has
  // been left, so what a static render can hold is the shape of the control and
  // the fact that it starts quiet. The blur behaviour is in `e2e/people.spec.ts`,
  // where there is a browser to blur in.

  it("is an email input with the label pointing at it", () => {
    const markup = html(
      <EmailField id="parent-email" label="Email" value="" onChange={() => {}} />,
    );

    expect(markup).toContain('<label for="parent-email">Email</label>');
    expect(markup).toContain('type="email"');
    expect(markup).toContain('name="email"');
    // The longest address the standard allows, and the width of the column.
    expect(markup).toContain('maxLength="320"');
  });

  it("says nothing about an empty field nobody has touched yet", () => {
    // Opening a form and being told immediately that it is wrong is telling
    // somebody off for not having started.
    const markup = html(<EmailField id="e" label="Email" value="" onChange={() => {}} />);

    expect(markup).not.toContain("field-error");
    expect(markup).not.toContain("is-invalid");
    expect(markup).not.toContain("aria-invalid");
  });

  it("is required by default and optional when the caller says so", () => {
    expect(html(<EmailField id="e" label="Email" value="" onChange={() => {}} />)).toContain(
      "required",
    );
    // A student whose parent does the onboarding has no address of their own.
    expect(
      html(<EmailField id="e" label="Email" value="" onChange={() => {}} required={false} />),
    ).not.toContain("required");
  });

  it("carries the hint when there is one, and nothing when there is not", () => {
    expect(
      html(
        <EmailField
          id="e"
          label="Email"
          value=""
          onChange={() => {}}
          hint="The onboarding email goes here."
        />,
      ),
    ).toContain('<span class="hint">The onboarding email goes here.</span>');
    expect(html(<EmailField id="e" label="Email" value="" onChange={() => {}} />)).not.toContain(
      "hint",
    );
  });

  it("never makes a phone number compulsory", () => {
    // Nobody is turned away for not having one, and the pattern is the
    // service's, not a second opinion about what a number looks like.
    const markup = html(<PhoneField id="p" label="Phone" value="" onChange={() => {}} />);

    expect(markup).not.toContain("required");
    expect(markup).toContain('type="tel"');
    expect(markup).toContain(`pattern="${PHONE_PATTERN}"`);
  });
});

describe("what the form and the service agree an address is", () => {
  // One regex, imported by both. Two would drift, and the form would either
  // refuse what the service accepts or accept what it refuses — the second of
  // which fails at the last step, about a field three steps back.
  it("accepts an ordinary address, and an unusual one", () => {
    expect(isEmail("rowan.mercer@example.test")).toBe(true);
    expect(isEmail("a+b'c@sub.domain.example.test")).toBe(true);
  });

  it("refuses what is obviously not one", () => {
    expect(isEmail("")).toBe(false);
    expect(isEmail("rowan")).toBe(false);
    expect(isEmail("rowan@")).toBe(false);
    expect(isEmail("rowan@example")).toBe(false);
    expect(isEmail("rowan mercer@example.test")).toBe(false);
  });

  it("trims first, because the service trims before it stores", () => {
    // A form stricter than the service refuses what the service would have
    // taken, and a trailing space is a typing accident rather than an answer.
    expect(isEmail("  rowan.mercer@example.test  ")).toBe(true);
    expect(isPhone("  555 0134  ")).toBe(true);
  });

  it("takes a phone number the way people write one", () => {
    expect(isPhone("+1 (555) 0134")).toBe(true);
    expect(isPhone("555")).toBe(false);
    expect(isPhone("call me")).toBe(false);
  });
});
