/**
 * The navigation drawer's element id.
 *
 * Shared because two components need the same string: the sidebar carries it,
 * and the header's menu button points `aria-controls` at it. It used to be the
 * fragment the drawer opened on — the header linked to it and the stylesheet
 * matched `:target` — which is why it was a constant in the first place. React
 * state opens the drawer now; the id is only a name.
 */
export const DRAWER_ID = "primary-nav";
