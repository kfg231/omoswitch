# OmOswitch Design System

Contract for all UI in `src/components/` and `src/App.tsx`. Every visual value in JSX must trace
to a token below. All user-facing text comes from `src/i18n/{ja,en}.json` (brand string
"OmOswitch" is the only literal allowed).

## 0. Research Log

Not a greenfield brand exercise: this is an internal single-window operator tool for an existing
CLI (`omo`). Direction is taken from the plan (`.omo/plans/omoswitch.md`) and from the already
shipped foundation (Tailwind v4 via `@tailwindcss/vite`, no component library, no added deps).
Layer A posture: operational/neutral (`taste-skill`) - dense config surface, legibility over
spectacle. Layer B posture: developer-tool ink ramp with a single warm accent, in the spirit of a
terminal-adjacent tool rather than a marketing page. No external reference packet was supplied, so
there is no pixel target; fidelity is judged against this contract.

## 1. Tokens

Defined in `src/index.css` under `@theme`. Consumed only as Tailwind utilities
(`bg-ink-100`, `text-accent-600`, `font-mono`, `rounded-panel`, `text-micro`).

- Ink ramp `ink-50 … ink-950`: the only neutral. Surfaces, text, borders, and every
  hover/selected/active wash are this one ink at different steps or alphas.
- Accent `accent-400/500/600`: warm amber. Reserved for the active profile marker, primary
  actions, and the `focus-visible` ring. Never a decorative fill.
- Semantic `good-500` (in sync), `warn-500` (drift, legacy `[senpi]`), `bad-500` (errors).
  Semantic colors appear as a dot, a text color, or a tinted surface - never as a bare
  coloured edge.
- Radius: `rounded-panel` for panels/dialogs/cards, `rounded-md` for controls, `rounded-full`
  for badges and dots.
- Type: `font-sans` for UI, `font-mono` for models, paths, hashes, JSON, and the preview
  `[native]` text. Scale is the Tailwind default plus `text-micro` for metadata lines.
- Spacing: Tailwind's 4px scale only. No arbitrary pixel values.
- Motion: `ease-ui` with 120-160ms, `opacity`/`transform` only, and a
  `prefers-reduced-motion` reset in `src/index.css`.

## 2. Light and dark

No theme toggle: both modes follow the OS through `color-scheme: light dark` plus `dark:`
utilities on every surface. Light = `ink-100` app background on `ink-50` panels; dark =
`ink-950` background on `ink-900` panels. Borders are `ink-200` / `ink-800`.

## 3. Primitives (`src/components/primitives.tsx`)

- `Button` - variants `primary` (accent), `secondary` (ink surface + border), `ghost`
  (transparent, ink wash on hover), `danger` (bad-500 text, bad wash on hover); sizes `sm`/`md`.
- `IconButton` - square ghost button, always carries an accessible label.
- `Field` - label + control + optional hint/error, wired with `htmlFor`/`id` and
  `aria-describedby`. Every input in the app goes through it.
- `TextInput`, `TextArea`, `Select` - native controls styled on the ink ramp.
- `Badge` - `tone` of `neutral | accent | good | warn | bad`; tinted surface, no accent border.
- `Panel` - `rounded-panel` surface with a 1px ink border and an optional header row.
- `Dialog` (`src/components/Dialog.tsx`) - `role="dialog"` `aria-modal`, labelled by its title,
  Esc closes, Tab cycles inside (focus trap), focus restores to the opener on close, backdrop is
  an ink scrim.

## 4. State encoding (AI-slop guard)

Selection and focus are expressed by ink washes, weight, and a glyph - never by a coloured side
border. The selected profile row uses an ink wash plus an accent dot; the active profile adds an
accent `Badge`. `focus-visible` rings are the only coloured edges in the app.

## 5. Component contract

- `StatusBar` - config path (mono, truncating), active profile name, drift state, `[native]`
  presence, legacy `[senpi]` warning, `omo` availability, language toggle. Drift renders a
  `warn` badge plus `Re-apply` and `Capture` buttons.
- `ProfileList` - left column; each row shows name, agent/category counts, updated timestamp,
  and per-row `Apply` / `Duplicate` / `Delete`. Header carries `New profile`, `Import`, `Backups`.
- `ProfileEditor` - right column; name and note fields, then `Agents` and `Categories` sections
  of `AssignmentRow`, with add controls and a save button plus unsaved-changes marker.
- `AssignmentRow` - key, model (via `ModelPicker`), reasoning `Select`, fallback models list,
  and an extra-JSON `TextArea` that reports parse failures inline.
- `ModelPicker` - hand-rolled combobox: filterable `list_models` listbox with
  `aria-activedescendant`, arrow/Enter/Esc keys, free text always accepted, a refresh button, and
  the `omoNotFound` hint when `omo` is unavailable.
- `SwitchPreview` - dialog with before/after `[native]` text side by side in `font-mono`,
  changed/unchanged badge, confirm applies with the preview `baseHash` as `expectedHash`.
- `ImportDialog` - source radio group (`opencode` | `native`), name field, renamed-keys notice.
- `BackupsDialog` - backup list with created time and size, `Restore` per row.
- `ErrorBanner` - localized per `AppError.kind`; for `changedOnDisk` it offers reload preview.

## 6. Accessibility constraints

Every input has a visible associated `<label>`; icon-only controls carry `aria-label`. Dialogs
are keyboard-operable (Esc, focus trap, restore). Status changes announce through
`aria-live="polite"`; errors use `role="alert"`. Focus rings are never removed. Contrast target
is WCAG AA: body text uses `ink-700`+ on light and `ink-200`+ on dark.

## 7. Responsive

Fixed desktop window is the primary target (1280px). Below 900px the two columns stack, the
profile list first. Dialogs cap at `max-w-3xl` and scroll internally rather than growing the page.

## 8. Accepted debt

- No component unit tests: the 33 existing lib/i18n tests plus browser QA cover T7.
- Preview shows before/after blocks, not a line-level diff; the plan only requires the two texts.
- The mock backend is the only backend until T8, so all QA evidence is mock-driven.
