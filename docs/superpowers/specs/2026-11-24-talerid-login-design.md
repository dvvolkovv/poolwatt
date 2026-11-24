# Sign in and register with Taler ID

Date: 2026-11-24. Status: approved.

## Goal

Let people sign in to and register on poolwatt.com with Taler ID (OpenID
Connect). It stands next to nickname + password; neither replaces the other.

Out of scope: company sign-in (`companies` scope), KYC / wallet / phone claims,
single logout, native mobile apps, renaming a nickname.

## Facts the design rests on

- Issuer `https://api.talerid.io/oauth`, discovery works, PKCE S256 is
  mandatory, ID tokens are RS256, client auth is `client_secret_basic`.
- A self-registered client gets `openid profile email offline_access`. We ask
  for `openid profile email` only.
- The registered redirect URI is
  `https://poolwatt.com/api/auth/callback/talerid`. No localhost URI.
- The Taler ID browser login screen has no sign-up and no password recovery.
  People without a Taler ID create one in the Taler ID app
  (`https://talerid.io/download/`).
- Existing accounts have a nickname and a password and almost never an email,
  so they cannot be matched to a Taler ID automatically.
- Users own exchange wallets, so a wrong account link is a money problem.

## Approach

Auth.js v5 built-in OIDC provider (PKCE, state, nonce, `iss`, signature checks
come with it) plus our own `resolveTalerIdUser()` that finds, creates or links
the local user. Sessions stay JWT.

Rejected:

- `@auth/prisma-adapter`: its `createUser` knows nothing about our mandatory
  `username`, and it stores provider tokens we have no use for.
- Hand-written flow on `openid-client`: repeats what Auth.js already does.

Claims come from `/oauth/me` (`idToken: false` in the provider), because the ID
token is not guaranteed to carry `name` and `email`.

## Behaviour

| Situation | Result |
|---|---|
| `sub` already linked | Sign in to that account |
| `sub` unknown, email verified and free | New account, email stored as verified |
| `sub` unknown, email missing or unverified | New account without email |
| `sub` unknown, email belongs to a Poolwatt account | Refused: sign in with your nickname, then link Taler ID in settings |
| Link from settings, `sub` unknown | Linked to the signed-in account; its email and name are left alone |
| Link, `sub` linked to someone else | Refused |
| Link, account already has another Taler ID | Refused |

A new account has no password. Its nickname is the slug of the Taler ID name
(`ivan-petrov`), with a short random suffix when taken or reserved, and
`user-<random>` when the name gives nothing usable.

We do not auto-link by email. It would be defensible (both sides verified), but
accounts hold wallets and the manual path costs one click.

No Taler ID token is stored. The `Account` row keeps `provider`,
`providerAccountId` (`sub`), `type`, nothing else.

Sign-out ends the Poolwatt session only.

## Linking intent

The callback must know whether a signed-in user asked to link. The settings
action sets a cookie holding `userId.expiry.hmac` (HMAC-SHA256 with the auth
secret, 10 minutes, httpOnly, SameSite=Lax, `__Host-` prefix on https). The
callback links only if the cookie verifies **and** its user id equals the
current session user. Otherwise it is an ordinary sign-in. The cookie is
deleted on every Taler ID callback that reaches our code.

Signing matters: an unsigned cookie could be planted from a sibling host to
attach an attacker's Taler ID to a victim's account.

## Interface

- `/login`, `/register`: title, Taler ID button (brand: `#167EF2`, hover
  `#1570D6`, 8 px radius, Inter 600, 44 px), hint "No Taler ID? Create one in
  the app", "or", the existing form.
- `/me/settings`: "Taler ID" section. Not linked: link button. Linked: status
  and unlink button. Unlink needs a password on the account, otherwise the
  section explains that a password has to be set first.
- `/me/settings` for accounts without a password: "Set a password" form instead
  of "Change password". The server only sets it while `passwordHash` is null.
- Everything Taler ID is hidden when `TALERID_CLIENT_ID` or
  `TALERID_CLIENT_SECRET` is missing.
- Strings in en, ru, sk. Other locales fall back to English as they do today.

## Errors

`pages.error` joins `pages.signIn` at `/login`. Codes shown there, or in
settings when the visitor already has a session:

| Code | Meaning shown |
|---|---|
| `OAuthCallbackError` | Cancelled or refused at Taler ID |
| `TalerIdEmailTaken` | Email already used here, link from settings |
| `TalerIdTaken` | This Taler ID belongs to another Poolwatt account |
| `TalerIdAlreadyLinked` | Your account already has another Taler ID |
| anything else (`Configuration`: lost cookies, state mismatch, Taler ID down; `AccessDenied`: our callback threw) | Could not finish, try again in the same browser |

Unknown codes never reach the page as text.

## Data

One migration, compatible with the running build:

- `User.passwordHash` becomes nullable. Credentials sign-in, change password
  and unlink treat null as "no password".
- `Account` gets `@@unique([userId, provider])`: one Taler ID per user.

## Infrastructure

- `.env.local`: `TALERID_CLIENT_ID`, `TALERID_CLIENT_SECRET` (done). Optional
  `TALERID_ISSUER` for tests.
- nginx: `www.poolwatt.com` → 308 → `poolwatt.com`. Auth.js builds callbacks
  from `NEXTAUTH_URL`, so a flow started on www loses its state cookie.

## Testing

- Unit: nickname candidates, claim mapping, link intent, error mapping.
- Integration against a throwaway Postgres: every row of the behaviour table,
  plus concurrent callbacks for one `sub` and nickname collisions.
- Full flow locally: production build, throwaway Postgres, `oidc-provider` stub
  as Taler ID, real Chrome. Register, sign in again, link, unlink, refuse, cancel.
- After deploy: the button leads to the real Taler ID login screen with the
  right parameters; password login still works; then a human signs in with a
  real Taler ID.

## Rollout and rollback

Check the bot is idle and the tree is clean, back up the database and `.next`,
apply the migration, build, restart `poolwatt-web`, then nginx. Rollback:
restore the saved `.next`, restart; the migration can stay.
