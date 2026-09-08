/**
 * Sign out.
 *
 * A form rather than a link, because signing out changes state and a GET that
 * does is one prefetch away from logging people out by accident. The CSRF token
 * rides in it like every other form's.
 */

import { Button } from "@/components/ui";
import { signOut } from "@/app/actions/auth";

export function SignOutButton({
  csrfField,
  csrfToken,
}: {
  csrfField: string;
  csrfToken: string;
}) {
  return (
    <form action={signOut}>
      <input type="hidden" name={csrfField} value={csrfToken} />
      <Button size="small" className="nav-signout" type="submit">
        Sign out
      </Button>
    </form>
  );
}
