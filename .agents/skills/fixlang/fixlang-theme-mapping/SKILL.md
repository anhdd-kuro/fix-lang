---
name: fixlang-theme-mapping
description: "Use when editing theme color derivation, semantic tokens, contrast adjustment, or adding new themes. Examples: \"add Nord theme support\", \"why are card backgrounds washing out\", \"how to increase surface contrast\", \"adjust theme contrast floors\". Covers src/themes/ (compositeColor.ts, tmThemeToSemanticTokens.ts, adjustSemanticTokenContrast.ts) and src/renderer/themes/generated/."
---

# FixLang — Theme Color Mapping & Semantic Tokens

Code: `src/themes/` (`compositeColor.ts`, `tmThemeToSemanticTokens.ts`, `adjustSemanticTokenContrast.ts`, `tmThemeTypes.ts`, `normalizeColor.ts`), `src/renderer/themes/generated/` (preset CSS), `scripts/generate-theme-css.ts`.

## Architecture: Derive Ladder + Composite Alpha

### Problem Statement (Why This Exists)

Previously, FixLang mapped each semantic role (`--card`, `--border`, `--primary`, etc.) to a single VS Code theme key. This failed because:

1. **Translucent overlay colors**: VS Code theme JSON contains many translucent colors (e.g. `editorGroup.border = #00000030`) designed to be **composited over a base** surface. When used as raw solid CSS colors, they produce ugly results: pure-black borders, washed accents, invisible hover states.

2. **Color collapse**: Multiple semantic roles often mapped to identical theme keys (e.g., `sideBar.background`, `tab.inactiveBackground`, `editor.background` all equal the same color in many themes), collapsing card/popover/secondary/muted/accent to a single flat color → no surface elevation hierarchy.

### New Solution

**Three-anchor extraction + elevation ladder derivation:**

1. **Extract stable anchors** from the theme:
   - `background` ← composited editor background (stable & central)
   - `foreground` ← composited editor foreground (primary text color)
   - `accent` ← the most vivid non-neutral solid color in the theme's status keys (e.g., `editorError.foreground`, `editorWarning.foreground`), with saturation ≥ 0.18

2. **Compose all colors to opaque**: Use `composite(raw, base)` to flatten translucent VS Code colors into solid hex values that match what the eye sees.

3. **Derive a monotonic surface elevation ladder** with guaranteed brightness separation:
   - `--background` (base)
   - `--muted` (slightly lifted from base)
   - `--input` (slightly more lifted)
   - `--secondary` (mid-elevation)
   - `--card` (higher elevation, **must differ from background by ≥ 0.075 brightness**)
   - `--popover` (topmost surface, ≥ 0.045 delta from card)
   - `--accent` (saturated, vivified primary color)

   Each surface is either honored from the theme's own key (if it is already distinct from base) or derived by lifting/lowering until the `minDelta` brightness separation is achieved. This guarantees a visible elevation hierarchy even when the theme reuses editor.background for multiple roles.

4. **Foreground ramp** from primary text:
   - `--foreground` ← primary text
   - `--muted-foreground` ← text blended 40% toward background (desaturated, secondary labels)
   - `--card-foreground` ← text blended 20% toward card background (readable on elevated surfaces)

5. **Borders**: Derived by blending foreground into background (never a raw `#00000030` overlay) → subtle, theme-aware hairlines.

## Key Invariants (Test-Enforced)

**All invariants below are validated by `src/themes/adjustSemanticTokenContrast.test.ts` across every theme in `src/themes/json/`:**

- **Contrast floors**:
  - `--foreground` on `--background`: ≥ 4.5 (WCAG AA large text)
  - `--muted-foreground` on `--card`: ≥ 3.5 (secondary labels)
  - `--card-foreground` on `--card`: ≥ 4.5 (headings/primary content on cards)

- **Surface elevation**:
  - `--card` brightness delta from `--background`: > 0.075 (2.7% of perceptual range) — enforces visible card "lift"
  - `--popover` brightness delta from `--card`: ≥ 0.045 (maintains modal elevation)

- **Saturation floor**:
  - `--accent` saturation ≥ 0.35 (via `vivify`), even for muted themes like Nord — ensures buttons and highlights read as intentional accents, not just variations of gray

- **Transparency**:
  - `--overlay-backdrop` is an `rgba(...)` overlay (never solid), rendered at app-controlled opacity for modals

## Workflow: Making Theme Changes

### Adding a new theme

1. Place the VS Code theme JSON in `src/themes/json/yourtheme.json`
2. Run `bun run themes:generate` — this:
   - Parses each theme in `src/themes/json/`
   - Calls `tmThemeToSemanticTokens()` to extract anchors and derive the ladder
   - Calls `adjustSemanticTokenContrast()` to enforce contrast/saturation floors
   - Writes the CSS variable map to `src/renderer/themes/generated/preset-yourtheme.css`
3. Run `bun run test` — the contrast test suite validates your theme:
   - Checks all contrast floors (foreground, muted-foreground, card-foreground)
   - Checks card/popover brightness deltas
   - Fails if any invariant is violated

### Modifying theme derivation logic

1. Edit one of the three core theme files:
   - `compositeColor.ts` ← color math (composite, elevate, blend, ensureBrightnessDelta, vivify, etc.)
   - `tmThemeToSemanticTokens.ts` ← anchor extraction and surface ladder derivation
   - `adjustSemanticTokenContrast.ts` ← contrast/saturation enforcement (safety net only, not re-derivation)

2. Run `bun run themes:generate` to rebuild all 149 preset CSS files
3. Run `bun run test` to validate the new logic across all themes
4. If tests fail:
   - **Contrast floor fail**: adjust `adjustSemanticTokenContrast.ts` thresholds or tweak the surface ladder `minDelta` values
   - **Brightness delta fail**: surfaces are collapsing; increase the `minDelta` in `tmThemeToSemanticTokens.ts`
   - **Saturation fail**: `vivify` not aggressive enough; increase the floor or trace `deriveAccent`

5. Visually test in `bun run dev`:
   - Open Settings → Appearance → Theme
   - Toggle between themes
   - Check that cards, popovers, and accents read correctly (no washed colors, no flat hierarchy)

## Implementation Details

### `compositeColor.ts`

Helper functions for color math:

- `composite(input: string, base: string) → string` — flatten a translucent color onto an opaque base (reproduces VS Code's rendering)
- `elevate(base: string, amount: number, isDark: boolean) → string` — lift (dark theme) or lower (light theme) a color to separate it from background
- `blend(from: string, toward: string, ratio: number) → string` — mix two colors
- `ensureBrightnessDelta(surface: string, base: string, minDelta: number, isDark: boolean) → string` — push surface away from base until perceptual brightness differs by ≥ minDelta
- `brightnessDelta(a: string, b: string) → number` — measure perceptual brightness difference (0–1)
- `vivify(color: string, minSaturation: number) → string` — raise saturation to a floor without changing hue
- `readableOn(fg: string, bg: string) → boolean` — check if foreground is readable on background (contrast ≥ 4.5)
- `saturation(color: string) → number` — extract saturation (0–1)
- `isDarkColor(color: string) → boolean` — is this a dark theme?
- `isFullyTransparent(color: string) → boolean` — skip `#FFFFFF00`-style fully transparent colors

### `tmThemeToSemanticTokens.ts`

Main derivation pipeline:

1. **Anchor extraction**: Pick `editor.background`, composite it to opaque. Similarly for foreground and accent.
2. **Determine theme darkness**: Is background perceptually dark?
3. **Derive surfaces**: For each role (muted, input, secondary, card, popover, accent), either honor the theme's own key (if distinct from base) or derive by lifting/lowering until `minDelta` is met.
4. **Derive foreground ramp**: Blend primary foreground toward background to create secondary/muted text.
5. **Derive borders**: Blend foreground toward background.
6. **Return `SemanticTokens`**: A map of CSS variable names to hex/rgba values (e.g. `{ "--foreground": "#...", "--card": "#..." }`)

Crucially: `tmThemeToSemanticTokens` does **not** re-enforce contrast. It trusts the ladder is correct and honors authentic theme colors; contrast adjustment happens in the next step.

### `adjustSemanticTokenContrast.ts`

**Safety net only** — adjusts foreground colors (and only foreground, not surfaces) to meet contrast floors **after** the ladder is derived. This prevents re-collapsing the elevation ladder:

- Ensures `--foreground` is readable on `--background`
- Ensures `--muted-foreground` is readable on `--card` (and stays desaturated)
- Ensures `--card-foreground` is readable on `--card`
- Derives `--overlay-backdrop` (semi-transparent overlay for modals)

**Does NOT:**
- Re-derive surfaces — that breaks the carefully-built elevation ladder
- Re-adjust accent saturation — that already happened in `tmThemeToSemanticTokens`

### `src/renderer/themes/generated/preset-*.css`

Generated at build time. Each file contains a `:root` CSS var declaration:

```css
:root {
  --background: #1e1e1e;
  --foreground: #d4d4d4;
  --card: #252526;
  --accent: #5e9ccc;
  /* ... */
}
```

**Do not hand-edit.** These are re-generated on every `bun run themes:generate`. Edit the theme JSON in `src/themes/json/` or the derivation logic in `src/themes/*.ts`.

## Checklist Before Finishing Theme Work

- [ ] Theme JSON placed in `src/themes/json/`
- [ ] Ran `bun run themes:generate`
- [ ] Ran `bun run test` — all theme tests pass
- [ ] Visually tested in `bun run dev` (Settings → Appearance → Theme)
- [ ] If modifying derivation logic: no re-collapsing of surfaces, no hardcoding of contrast in `tmThemeToSemanticTokens`
- [ ] If modifying `adjustSemanticTokenContrast.ts`: only touch foreground/contrast, never re-derive surfaces
- [ ] Checked that muted-accent themes (Nord, One Dark) still render accent buttons as saturated, not gray

## Common Pitfalls

### Pitfall: Using raw translucent colors as solid CSS values

❌ **WRONG**: Store `#00000030` directly in `--border`
✅ **CORRECT**: `composite("#00000030", background)` to get the solid color VS Code renders

### Pitfall: Mapping multiple semantic roles to the same theme key without delta guarantee

❌ **WRONG**: `--card`, `--secondary`, `--popover` all become `editor.background` (flat hierarchy)
✅ **CORRECT**: Use `ensureBrightnessDelta` to separate them, even if the theme reuses the same key

### Pitfall: Re-deriving surfaces in `adjustSemanticTokenContrast`

❌ **WRONG**: Modify `--card` in the contrast adjuster to meet a contrast floor
✅ **CORRECT**: Adjust `--card-foreground` or `--muted-foreground` to be readable on the card (surfaces are off-limits)

### Pitfall: Forgetting to run `bun run themes:generate` after editing theme .ts files

❌ **WRONG**: Edit `tmThemeToSemanticTokens.ts`, then test in `bun run dev`
✅ **CORRECT**: Edit, run `bun run themes:generate`, then test in `bun run dev`

### Pitfall: Not validating across all 149 themes

❌ **WRONG**: Tune a threshold for one theme in `adjustSemanticTokenContrast`, assume it works
✅ **CORRECT**: Run `bun run test` to validate the change across all themes; adjust if needed

### Pitfall: Text token not paired with the background it sits on

Every surface ships its own foreground (`secondary`/`secondary-foreground`,
`primary`/`primary-foreground`, `card`/`card-foreground`, `popover`/`popover-foreground`,
`success`/`success-foreground`). The derive ladder guarantees contrast **within a
pair**, and nothing else. Measured across all 149 presets:

| pairing | below 3:1 | worst |
|---|---|---|
| `foreground` on `secondary` | 36 | **1.00** (`tc-night-owl-light`: both `#403f53`) |
| `foreground` on `primary` | 123 | 1.01 (`ayu-dark`) |
| `foreground` on `card` | 37 | 1.00 |
| `foreground` on `success` | 133 | 1.01 |
| each `X` + `X-foreground` | **0** | ≥ 4.27 |

❌ **WRONG**: `className="bg-secondary text-foreground"` — reads fine in the theme
you happened to be running, invisible in `tc-night-owl-light`
✅ **CORRECT**: `className="bg-secondary text-secondary-foreground"`

A hover/selected state is exactly where this bites, because the background
changes underneath text whose token did not.

### Pitfall: Third-party components with their own hardcoded palette

react-select's `optionCSS` hardcodes `colors.primary25` (`#DEEBFF`) for the
focused menu row and merely *inherits* the text colour, so a themed foreground
landed on a light blue nothing in the theme chose. `styles.option` had never been
supplied, so every select on the default `Option` had an unreadable hover;
`ModelSelect` looked correct only because it renders a custom `Option`.

Both representations now come from one table, `src/renderer/components/selectOptionSurface.ts`
(CSS values for react-select's emotion styles, Tailwind classes for a custom
`Option` or a non-react-select popover), and `withThemeColors` remaps the
library's remaining blues so no unthemed highlight returns through a
sub-component added later. `selectOptionSurface.test.ts` pins the pairings;
`SearchableSelect.test.ts` opens a real menu in jsdom and asserts the computed
background is the theme var and not `rgb(222, 235, 255)`.

## Related Code Locations

- **Renderer theme consumer**: `src/renderer/MainWindow/MainWindow.tsx` (applies `preset-*.css` to the DOM)
- **Theme discovery/switching**: `src/features/ui/main/ui.ts` (handles Settings → Appearance → Theme)
- **Test setup**: `src/themes/adjustSemanticTokenContrast.test.ts` (where contrast invariants are defined and validated)
