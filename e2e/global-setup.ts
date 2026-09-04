/**
 * Sign the suite in, once, without posting the sign-in form.
 *
 * `scripts/mint-session.ts` already mints exactly the value a real sign-in
 * would set, so this reuses it as a subprocess rather than importing the
 * hashing and signing code into the test runner. Anything these tests can
 * reach is therefore something a real sign-in can reach too.
 *
 * The minted cookies are credentials for the seeded development accounts.
 * They are written under `e2e/.auth/`, which is git-ignored, and never logged.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

import { SESSION_COOKIE } from "../src/lib/names";

import { ACCOUNTS, AUTH_DIR, statePath, type Account } from "./accounts";

function mint(email: string): string {
  const output = execFileSync("npx", ["tsx", "scripts/mint-session.ts", email], {
    encoding: "utf-8",
    // dotenv announces itself on the way past; the cookie is the last line.
    stdio: ["ignore", "pipe", "ignore"],
    shell: process.platform === "win32",
  });
  const token = output.trim().split(/\r?\n/).pop() ?? "";
  if (token === "") throw new Error(`no session minted for ${email}`);
  return token;
}

export default function globalSetup(): void {
  mkdirSync(AUTH_DIR, { recursive: true });

  for (const [account, email] of Object.entries(ACCOUNTS) as [Account, string][]) {
    writeFileSync(
      statePath(account),
      JSON.stringify(
        {
          cookies: [
            {
              name: SESSION_COOKIE,
              value: mint(email),
              domain: "127.0.0.1",
              path: "/",
              expires: -1,
              httpOnly: true,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [],
        },
        null,
        2,
      ),
    );
  }
}
