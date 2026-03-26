# Reserve Schedule Tools — System Roundup

> Written March 2026. Reference this when you've forgotten how everything fits together.

---

## What This Is

A small, private web toolset for airline reserve scheduling, hosted at **reserve.blueskiestailwinds.com**. Two tools:

- **PBS Simulator** (`/pbs/`) — models a reserve bid month. You paint day codes onto a calendar and the app validates your schedule against contract rules (min work blocks, X-day block limits, reserve guarantee category, etc.).
- **PCS Planner** (`/pcs/`) — models a Preferential Cascading Schedule change. You enter your current awarded schedule and your desired schedule, then the app analyzes what PCS moves are legal and what advisories apply.

---

## Hosting

- **Platform:** GitHub Pages, repo `blueskiestailwinds/reserve`
- **Custom domain:** `reserve.blueskiestailwinds.com` via a `CNAME` file in the repo root
- **Deployment:** pushing to `main` is live within ~30 seconds. No build step. GitHub Pages serves the static files directly.
- There is no server, no backend process, no Node.js, no bundler. Everything runs in the browser.

---

## Frontend Architecture

**Vanilla HTML + JavaScript. No framework. No build toolchain.**

Each of the three pages is a single self-contained `.html` file:

```
/index.html       ← homepage / auth hub
/pbs/index.html   ← PBS Simulator
/pcs/index.html   ← PCS Planner
```

All CSS is in `<style>` tags in the same file. All JavaScript is in `<script>` tags at the bottom. The only external dependency loaded at runtime is the Supabase JS client via CDN:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
```

### Responsive Layout

Both apps have a **desktop layout** and a **mobile layout** built into the same HTML file. JavaScript detects the device on load (`isMobileDevice()`) and toggles CSS classes to show the correct layout. On resize, it re-evaluates and re-renders.

### Day Codes

Both apps use single-character codes to represent days:

| Code  | Meaning                                               |
| ----- | ----------------------------------------------------- |
| `X`   | X-day (off day — the only type PCS can move)          |
| `R`   | Reserve (work day)                                    |
| `A`   | Absence                                               |
| `CQ`  | Training                                              |
| `CI`  | Carry-In                                              |
| `IVD` | Individual Vacation Day (PCS only)                    |
| `C`   | Carry (PBS only — maps to `R` when imported into PCS) |

---

## Supabase

**Project URL:** `https://sowczbjrrqazotbqpzrr.supabase.co`

The anonymous publishable key is embedded directly in the client-side JS of all three pages. This is intentional and safe — the anon key only permits what Row Level Security (RLS) allows.

### Database Tables

#### `public.users`

Minimal user registry. Created on first sign-in.

```
id  uuid  (matches auth.users.id)
```

#### `public.periods`

Admin-managed bid period definitions. Defines the name, start/end month+day, and day count for each named bid period (e.g. "January", "February", etc.). These are the template rows — not year-specific.

#### `public.month_instances`

Year-specific instances of periods. One row per bid month that actually appears in the apps. Admin-populated.

```
id            uuid
year          int
period_id     → periods.id
min_work      int   (default 4)
max_work      int   (default 99)
max_x_blocks  int   (default 4)
alv           text  ('cat1' or 'cat2' — reserve guarantee category)
extra_x       bool
```

Both PBS and PCS read from this table on load to populate the bid month selector. If Supabase is unavailable, both apps fall back to a locally generated month list (`generateBidMonths()`).

#### `public.schedules` _(PBS only)_

One row per user per month. Stores the user's PBS bid.

```
user_id   uuid  → users.id
month_id  uuid  → month_instances.id
days      text[]   (array of day codes, one per day in the bid month)
PRIMARY KEY (user_id, month_id)
```

#### `public.pcs_schedules` _(PCS only)_

One row per user per month. Stores the PCS planner data.

```
user_id       uuid     → users.id
month_id      uuid     → month_instances.id
current_days  text[]   (awarded schedule)
desired_days  text[]   (target schedule)
staffing      boolean[] (true = staffing day OK/blue, false = blocked/black)
updated_at    timestamptz
PRIMARY KEY (user_id, month_id)
```

### Row Level Security

All user-data tables have RLS enabled. The policy on each is:

```sql
for all
using  (auth.uid() = user_id)
with check (auth.uid() = user_id)
```

Users can only read and write their own rows. `month_instances` and `periods` are readable by everyone (anon key) since they're shared config data.

---

## Auth: Magic Link

There are no passwords. Auth is handled entirely by Supabase via **magic links** (OTP email).

### Flow

1. User visits `reserve.blueskiestailwinds.com`
2. They enter their email and click **Send Magic Link**
3. Supabase sends an email containing a one-time link
4. User clicks the link → browser is redirected back to the site with a token in the URL fragment
5. The Supabase JS client on the homepage detects the token, exchanges it for a session, and fires `onAuthStateChange` with `SIGNED_IN`
6. The session (access token + refresh token) is stored in `localStorage` by the Supabase client automatically

### Session Lifetime

| Token         | Lifetime |
| ------------- | -------- |
| Access token  | 1 hour   |
| Refresh token | 60 days  |

The Supabase client silently refreshes the access token in the background using the refresh token. The user stays logged in for up to 60 days of inactivity before needing a new magic link. They will never notice the 1-hour access token expiry.

### Auth State in the Sub-Apps

Both PBS and PCS call `_supa.auth.getSession()` on startup to check for an existing session. If a session exists, it's stored in `_session` and Supabase sync is enabled. If not, the app loads from `localStorage` with no redirect — unauthenticated use is permitted.

`onAuthStateChange` is registered in PBS to handle sign-in/sign-out events after initial load (reloads schedule data from Supabase on sign-in, falls back to localStorage on sign-out).

---

## Resend (Email Delivery)

Supabase's magic link emails are delivered via **Resend**, configured as a custom SMTP provider in the Supabase dashboard. This is a dashboard-level setting — there is no Resend code in this repository.

To find/change this config: Supabase Dashboard → **Project Settings → Auth → SMTP Settings**.

Resend is used because Supabase's built-in email sender has low rate limits and can end up in spam on free-tier projects. Resend provides better deliverability and a sending domain you control.

---

## Save / Sync Pattern

Both apps use the same two-layer save strategy:

### Layer 1: localStorage (immediate, always)

Every time the user makes a change, the full month data object is serialized to `localStorage` immediately. This works offline and requires no auth. Key names: `rm_vRolling_Final_v4` (PBS), `scp_v1` (PCS).

### Layer 2: Supabase (debounced, auth-gated)

If the user is signed in, a 1500ms debounced upsert fires after each change:

- **PBS** → upserts to `schedules` (just the `days` array for the current month)
- **PCS** → upserts to `pcs_schedules` (`current_days`, `desired_days`, `staffing` for the current month)

The debounce means rapid painting (drag-painting across days) only triggers one network call at the end of the gesture, not one per cell.

On load, if signed in, Supabase data takes precedence over localStorage.

---

## Import from PBS → PCS

The PCS app has an **Import from PBS** button in the current schedule panel header. It queries `schedules` for the signed-in user's PBS bid for the current month and loads it into `pcs_schedules.current_days`.

Code mapping on import:

| PBS code   | → PCS code |
| ---------- | ---------- |
| `C`        | `R`        |
| All others | unchanged  |

This only works when the user is signed in (it reads from Supabase). There is no localStorage-to-localStorage transfer path by design.

A future "Transfer from PBS" button (not yet built) would let users copy any month with one click.

---

## Key Files

| File                     | Purpose                                                         |
| ------------------------ | --------------------------------------------------------------- |
| `/index.html`            | Homepage, auth UI, links to tools                               |
| `/pbs/index.html`        | PBS Simulator — entire app in one file                          |
| `/pcs/index.html`        | PCS Planner — entire app in one file                            |
| `/pcs/PCS_RULES_SPEC.md` | Contract rule definitions used to build the PCS analysis engine |
| `/CNAME`                 | Custom domain for GitHub Pages                                  |
| `/350.jpg`               | Background image on homepage                                    |
| `/roundup.md`            | This file                                                       |
