/**
 * The shared vocabulary of the interface.
 *
 * One import for every screen, so a page reads as what it shows rather than as
 * a list of class names. Everything here renders the markup the stylesheet
 * expects — `btn`, `card`, `badge badge-<tone>` — and nothing here knows about
 * the domain: a `Badge` takes a tone and a glyph, and it is
 * `Badge.tsx`'s job to know that a cancelled session is a red one.
 */

export { Badge, StatusBadge, AttendanceBadge, DeliveryBadge, Tag } from "./Badge";
export type { Tone } from "./Badge";
export { Button, LinkButton, AnchorButton, ButtonRow } from "./Button";
export type { ButtonVariant, ButtonSize } from "./Button";
export { Card, CardGrid, PageHead } from "./Card";
export { EmptyState } from "./EmptyState";
export { Field, Hint, VisuallyHidden } from "./Field";
export { Modal } from "./Modal";
export { Notice } from "./Notice";
export { ScopeChoice } from "./ScopeChoice";
export { TableWrap } from "./Table";
export { When, WhenTime } from "./When";
