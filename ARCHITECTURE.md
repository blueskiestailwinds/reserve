# Architecture

> Reserve Schedule Tools — a private web toolset for airline reserve scheduling.
> Hosted at **reserve.blueskiestailwinds.com**.

---

## Overview

Two browser-based planning tools for airline reserve pilots, plus a landing page with authentication. There is no build step, no framework, no server-side code. Everything is vanilla HTML, CSS, and JavaScript served as static files via GitHub Pages.

```
reserve.blueskiestailwinds.com
├── /            Landing page, auth hub, status checks
├── /pbs/        PBS Planner — model a reserve bid month
└── /pcs/        PCS Planner — plan Preferential Cascading Schedule changes
```

---

## File Structure

```
/
├── index.html          Homepage — auth UI, tool links, service status
├── shared.css          Design tokens, resets, responsive layout scaffolding
├── shared.js           Shared utilities (device detection, brush selection)
├── 350.jpg             Background image (homepage)
├── favicon.png         App icon
├── CNAME               GitHub Pages custom domain
├── roundup.md          Internal reference document
│
├── pbs/
│   ├── index.html      PBS Planner — HTML structure (desktop + mobile layouts)
│   ├── pbs.js          PBS Planner — all application logic (~900 lines)
│   ├── pbs.css         PBS-specific styles
│   └── favicon.png     Icon copy
│
└── pcs/
    ├── index.html      PCS Planner — HTML structure (desktop + mobile layouts)
    ├── pcs.js          PCS Planner — all application logic (~2700 lines)
    ├── pcs.css         PCS-specific styles
    ├── PCS_RULES_SPEC.md  Contract rules spec for the PCS analysis engine
    └── favicon.png     Icon copy
```

---

## Hosting & Deployment

| Aspect       | Detail                                            |
| ------------ | ------------------------------------------------- |
| Platform     | GitHub Pages (`blueskiestailwinds/reserve`)        |
| Domain       | `reserve.blueskiestailwinds.com` (via `CNAME`)     |
| Deployment   | Push to `main` — live in ~30s, no build step       |
| Backend      | None — all logic runs client-side                  |
| CDN deps     | Supabase JS v2 loaded from jsDelivr at runtime     |

---

## Application Architecture

### Single-File Apps

Each page is self-contained. The PBS and PCS planners each have their own HTML, JS, and CSS files. They share `shared.css` (tokens, layout primitives, day/brush color classes) and `shared.js` (device detection, brush toggle).

### Responsive Dual-Layout Pattern

Both PBS and PCS embed **two complete layouts** in the same HTML file — a desktop layout (`#desktop-root`) and a mobile layout (`#mobile-root`). On page load, `isMobileDevice()` evaluates viewport width and user-agent, toggles an `.active` class on the correct root, and hides the other. A resize listener re-evaluates and swaps layouts.

- **Desktop**: sidebar + main content area with calendar grids
- **Mobile**: fixed top bar, swipe viewport or tab bar, and a draggable bottom sheet for settings

### Day Code System

Both apps represent schedule days with short string codes painted onto calendar grids:

| Code  | Meaning                        | Movable by PCS? |
| ----- | ------------------------------ | --------------- |
| `X`   | X-day (off day)                | Yes             |
| `R`   | Reserve (work day)             | Target only     |
| `A`   | Absence / leave                | No              |
| `CQ`  | Training                       | No              |
| `CI`  | Carry-In                       | No              |
| `IVD` | Individual Vacation Day (PCS)  | Placeable       |
| `C`   | Coverage (PBS only, maps to R) | N/A             |
| `Z`   | Locked X-day (PBS only)        | N/A             |

Users paint codes onto calendar days using a brush palette. Both apps support click and drag-painting.

### Bid Period Definitions

Bid months follow contractual definitions (Section 23 A. 4.) and do **not** align with calendar months (e.g., February runs Jan 31 - Mar 1, March runs Mar 2 - Mar 31). Both apps define a `generateBidMonths()` fallback that hardcodes these date boundaries. When Supabase is available, bid periods are loaded from the `month_instances` + `periods` tables instead.

---

## PBS Planner (`/pbs/`)

Models a reserve bid month. The user paints day codes onto a calendar and the app validates against contract rules in real time:

- **X-day proration**: Uses lookup tables from Section 12.M.2 indexed by available days and reserve guarantee category (`cat1` / `cat2`)
- **Work block validation**: Enforces minimum work block length, max X-day blocks, and end-of-month exceptions
- **Multi-month view**: Desktop shows previous/current/next months side by side; mobile uses swipe navigation
- **Visual feedback**: Invalid days get a red border (`.day.illegal`)

### PBS Data Shape

```js
monthData[i] = {
  days: ['R', 'R', 'X', 'X', ...],     // one code per day
  settings: { minW, maxW, maxX, alv, extraX }
}
```

---

## PCS Planner (`/pcs/`)

Models a Preferential Cascading Schedule change. The user enters their current awarded schedule and a desired schedule, then runs an analysis engine:

- **Three calendars**: Current (awarded), Desired (target), and Reserve Levels (staffing data)
- **PCS Analysis Engine**: A rule-based pathfinder that determines legal X-day moves, validates work blocks, respects frozen-day deadlines (D+4 rule at 2200 ET), staffing blocks, and edge-from-block constraints (P10)
- **Two-run detection**: When a direct move is blocked by P10 (X days must be removed from block edges), the engine searches for valid two-submission sequences (P11)
- **Import from PBS**: Pulls the user's PBS schedule from Supabase, mapping `C` -> `R`
- **Crew Schedule Import**: PPR number input dialog to import external schedule data

### PCS Data Shape

```js
monthData[i] = {
  current:  ['R', 'X', 'X', ...],   // awarded schedule
  desired:  ['X', 'R', 'X', ...],   // target schedule
  staffing: [true, true, false, ...] // per-day staffing availability
}
```

### PCS Rules

The full contract rule specification is in `/pcs/PCS_RULES_SPEC.md`. Key rules:

- **P2**: Only X-days can move, and only onto R-days
- **P3**: Work blocks must meet minimum length (exceptions for end-of-month, CQ/IVD-adjacent, start-of-month)
- **P10**: Removed X-days must be contiguous from a block edge (prefix or suffix)
- **P12**: Staffing-blocked dates forbid new R-to-X transitions
- **D9**: Frozen days (within D+4 of today) cannot differ between current and desired

---

## Data Layer

### Supabase

**Project**: `https://sowczbjrrqazotbqpzrr.supabase.co`

The anonymous publishable key is embedded client-side (intentional — RLS restricts access).

#### Tables

| Table              | Purpose                               | RLS                    |
| ------------------ | ------------------------------------- | ---------------------- |
| `periods`          | Bid period templates (name, dates)    | Public read            |
| `month_instances`  | Year-specific periods with settings   | Public read            |
| `users`            | Minimal user registry (matches auth)  | User-scoped            |
| `schedules`        | PBS bids (user + month -> day array)  | User-scoped            |
| `pcs_schedules`    | PCS plans (current, desired, staffing)| User-scoped            |

#### Row Level Security

User-data tables enforce `auth.uid() = user_id` for all operations. `periods` and `month_instances` are readable by the anon key.

### Save / Sync Strategy

**Two layers, identical pattern in both apps:**

1. **localStorage** (immediate, always): Every change serializes the full month object immediately. Works offline, no auth required.
   - PBS key: `rm_vRolling_Final_v4`
   - PCS key: `scp_v1`

2. **Supabase** (debounced, auth-gated): If signed in, a 1500ms debounced upsert fires after changes. Rapid drag-painting triggers only one network call.

On load: Supabase data takes precedence over localStorage when signed in.

---

## Authentication

**Magic link (passwordless)** via Supabase Auth, delivered through Resend (custom SMTP configured in Supabase dashboard).

### Flow

1. User enters email on the homepage
2. Supabase sends a one-time magic link email
3. User clicks link -> token exchanged for a session
4. Session stored in `localStorage` by Supabase client (access token: 1hr, refresh token: 60 days, auto-refreshed)

### Auth in Sub-Apps

Both PBS and PCS check `_supa.auth.getSession()` on startup. If a session exists, Supabase sync is enabled. If not, the app works in localStorage-only mode. Unauthenticated use is fully supported.

---

## Shared CSS Architecture

`shared.css` provides:

- **Design tokens**: Color variables (`--x-green`, `--r-yellow`, `--bg`, `--card-bg`, `--border`, etc.)
- **Day/brush color classes**: `.day.X`, `.brush.R`, etc. — used by both apps
- **Responsive layout roots**: `#desktop-root` / `#mobile-root` visibility toggling, including a media query fallback at 768px
- **Mobile UI primitives**: Top bar, palette toolbar, calendar grid, stat chips, bottom sheet
- **Desktop UI primitives**: Sidebar, layout grid, card styling

Each app adds its own CSS file for app-specific styles (`pbs.css`, `pcs.css`).

---

## Key Patterns

- **No framework**: All DOM manipulation is direct (`innerHTML`, `createElement`, `classList`)
- **No bundler**: Script tags in HTML, CDN for Supabase
- **Inline event handlers**: `onclick`, `oninput`, `onchange` in HTML
- **Global state**: Module-level variables (`monthData`, `currentIdx`, `activeBrush`, `_session`)
- **Immediate validation**: PBS validates on every paint stroke; PCS marks analysis as stale and requires manual re-run
- **Touch support**: Mobile layouts handle swipe gestures (PBS) and tab switching (PCS)
- **Graceful degradation**: Both apps work fully offline via localStorage when Supabase is unavailable
