# Design: "Ember"

A redesign of the web client for use on a phone, one-handed, with the soft
keyboard up half the time. Desktop keeps working with the same components.

## Direction

A calm instrument, not a dashboard. Warm neutrals instead of the usual
blue-black "developer dark", one ember accent that is spent only where it
means something, and the terminal's own monospace as the voice for anything
that is an identifier.

| | Dark ("charcoal") | Light ("paper") |
|---|---|---|
| Background / surface | `#141312` / `#1c1a18` | `#f5f2eb` / `#fdfbf7` |
| Text / muted / faint | `#ece7df` / `#a9a196` / `#857d72` | `#1e1b17` / `#5c554b` / `#756d61` |
| Accent (ember) | `#f5a04a` | `#ae4a0a` |
| Working / finished / danger | `#74b4e8` / `#86c47c` / `#f07a68` | `#1d68ad` / `#2e7d38` / `#bd3a2b` |

All body text clears 4.5:1 on its background in both themes; both terminal
palettes are tuned against their backgrounds (every ANSI colour except black
clears 4:1), and xterm's `minimumContrastRatio` lifts whatever a program
picks below that (4.5 on paper, 3 on charcoal).

- **Colour means state.** The accent marks what needs the user: a session
  *waiting for you*, an armed modifier key, a pending share request, the
  primary action. *Working* is blue and animated, *finished* green, *idle*
  grey. Every state also has its own glyph, so nothing relies on hue alone.
- **Type.** Geist (variable) for interface text; JetBrains Mono for session
  names, paths, ports, key caps and the terminal. Both are bundled, so there
  is no font CDN in the loop, and the mono ships with its full glyph set
  (box drawing, arrows, powerline) instead of the Latin subset.
- **Shape and spacing.** 4px grid, 44px minimum touch targets (key-bar keys
  are 40px tall, keyboard-style), radii 9/12/16/22. Hairline borders, almost
  no shadows; elevation is reserved for things that float (sheets, the jump
  pill, the new-session button).
- **Icons.** Lucide, 1.75–2px stroke, always paired with a label or an
  accessible name.
- **Motion.** 110–280ms, one easing curve. Sheets slide, panes fade, keys
  depress. Nothing loops except "working". `prefers-reduced-motion` turns it
  all off.

## What changed for the user

**Thumb-first terminal.** The key bar moved from the top of the screen to the
bottom edge, directly above the soft keyboard (or the home indicator). Two
rows of nine on a phone, one row of eighteen in landscape and on desktop:

```
esc  tab  ⇧tab  ctrl  alt   /   -   |   ⏎
^C   compose  paste  copy   ←   ↓   ↑   →   keyboard
```

- `ctrl` and `alt` are sticky modifiers: tap arms one for the next key,
  double-tap locks it, tap again releases. They apply to bar keys
  (ctrl+arrow, alt+enter) and to whatever is typed on the soft keyboard
  (ctrl then `r`).
- Keys never take focus: pressing one neither dismisses the keyboard nor
  summons it. Arrows auto-repeat while held.
- *Compose* opens a real text field above the bar for dictation and long
  prompts, with **Send** (text + Enter, as one bracketed paste) and
  **Insert** (text only).
- The terminal follows the cursor as output arrives and when the keyboard
  opens; scroll away and a "Cursor" pill brings you back.
- Connection loss shows a banner with a Retry button; the app reconnects on
  its own, immediately when it returns to the foreground or the network
  comes back.

**Viewport and keyboard.** The app is sized from `window.visualViewport`, so
the layout ends exactly at the top of the keyboard on iOS (which never
resizes the layout viewport) and on Android alike. The bottom safe-area
padding collapses while the keyboard is up, and in landscape with the
keyboard open the header gives its row back to the terminal.

**Home.** A large-title header that doubles as the switch between *Sessions*
and *Ports*; a one-line summary ("4 sessions · 1 waiting for you"); session
rows with a status glyph, mono name, status + task summary and last-activity
time; long-press, right-click or `…` for actions (open, kill); new session
in a bottom sheet with a live preview of the sanitised name. Pending share
requests appear on both panes.

**Settings** (home header and the terminal's `…`): theme (system / light /
dark), keep the terminal dark in the light theme, terminal text size,
unwrap-on-copy, key haptics, notifications, reload.

**Files.** Breadcrumb that keeps the current folder in view, two-line rows
(name; size and age), labelled actions in a bottom bar, theme-aware code
viewer.

## Engineering notes

- Tokens are CSS custom properties on `:root[data-theme]` (set before first
  paint by an inline script), mapped into Tailwind via `@theme inline`, so
  utilities like `bg-surface` / `text-ink-2` follow the theme.
- Design-system classes live in the `base` / `components` cascade layers so
  Tailwind utilities can override them.
- The app works under a path prefix (`src/lib/base.ts`); see the
  "mount-path aware" commit.
- The main bundle went from 1.85 MB to about 0.63 MB (canvas, file viewer and
  chat are lazy chunks; highlight.js uses the common-languages build).
