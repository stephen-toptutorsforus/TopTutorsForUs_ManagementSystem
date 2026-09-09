"use client";

/**
 * Where somebody works: schools, or regions, not both.
 *
 * Written out twice — once for a student, once for an instructor — as two
 * pickers, a paragraph of explanation, and the same pair of `onChange`
 * handlers, each clearing the other list. The two copies differed only in the
 * noun in the paragraph.
 *
 * The rule is the reason this is a component rather than two pickers side by
 * side. "One or the other" is enforced by each choice clearing the other, and
 * that enforcement was duplicated: a third copy would have been where the two
 * quietly stopped agreeing.
 *
 * Why the rule exists at all: a school already carries its district and its
 * region, so choosing both a school and a region is either redundant or a
 * contradiction, and the account would be created with one of them silently
 * winning. After creation the profile can hold any mixture — this is the
 * narrow, one-shot version of a question that gets a proper editor later.
 */

import { Picker, type PickerOption } from "./Picker";

export function LocationPickers({
  /** "student" or "instructor" — the only thing that differed between them. */
  subject,
  schools,
  schoolRefs,
  onSchools,
  regions,
  regionRefs,
  onRegions,
}: {
  subject: string;
  schools: PickerOption[];
  schoolRefs: string[];
  onSchools: (refs: string[]) => void;
  regions: PickerOption[];
  regionRefs: string[];
  onRegions: (refs: string[]) => void;
}) {
  return (
    <>
      <p className="hint hint-block">
        Assign this {subject} to schools or regions. Assigning directly to a school
        will also assign the {subject} to that school&rsquo;s districts and regions. You
        can only use one of the methods below when creating {article(subject)} {subject}.
        After creation, additional changes can be made to user locations from their
        profile.
      </p>

      <Picker
        label="Select schools"
        name="school"
        placeholder="Search schools"
        options={schools}
        chosen={schoolRefs}
        onChange={(refs) => {
          onSchools(refs);
          if (refs.length > 0) onRegions([]);
        }}
      />
      <Picker
        label="Select regions"
        name="region"
        placeholder="Search regions"
        options={regions}
        chosen={regionRefs}
        onChange={(refs) => {
          onRegions(refs);
          if (refs.length > 0) onSchools([]);
        }}
        hint="Schools or regions, not both — a school already carries its district and region."
      />
    </>
  );
}

/** "an instructor", "a student". The only English the component has to do. */
function article(noun: string): string {
  return /^[aeiou]/i.test(noun) ? "an" : "a";
}
