/**
 * The shared vocabulary of the interface.
 *
 * One import for every screen, so a page reads as what it shows rather than as
 * a list of class names. Everything here renders the markup the stylesheet
 * expects — `btn`, `card`, `badge badge-<tone>` — and nothing here knows about
 * the domain: a `Badge` takes a tone and a glyph, and it is
 * `Badge.tsx`'s job to know that a cancelled session is a red one.
 */

export { Badge, StatusBadge, UserStatusBadge, AttendanceBadge, DeliveryBadge, Tag } from "./Badge";
export type { Tone } from "./Badge";
export { Button, LinkButton, AnchorButton, ButtonRow } from "./Button";
export type { ButtonVariant, ButtonSize } from "./Button";
export { Card, CardGrid } from "./Card";
export { EmptyState } from "./EmptyState";
export { Choice, ChoiceGroup, Field, Hint, OptionSelect, VisuallyHidden } from "./Field";
export { CardSection } from "./CardSection";
export { Fact } from "./Fact";
export { FilterActions } from "./FilterActions";
export { FlashProvider, useFlash, useSettled } from "./Flash";
export type { FlashTone } from "./Flash";
export { FilterControl } from "./FilterControl";
export { FILTER_DRAWER_ID, FilterDrawer, FilterSection } from "./FilterDrawer";
export { ChevronIcon, FunnelIcon, ResetIcon, SaveIcon, SearchIcon, ShareIcon, TrashIcon } from "./icons";
export { Modal } from "./Modal";
export { Sheet } from "./Sheet";
export { PageHeader, PageToolbar, SearchField } from "./PageHeader";
export { Notice } from "./Notice";
export { ScopeChoice } from "./ScopeChoice";
export { TableWrap } from "./Table";
export { EmailField, PhoneField } from "./TextField";
export { When, WhenTime } from "./When";
