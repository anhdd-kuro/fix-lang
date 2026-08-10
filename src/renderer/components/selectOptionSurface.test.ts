import { describe, expect, it } from "vitest";
import {
  selectOptionClassName,
  selectOptionHoverClassName,
  selectOptionStyle,
  selectOptionSurface,
  withThemeColors,
} from "./selectOptionSurface";
import type { CSSObjectWithLabel, Theme } from "react-select";

describe("option surface", () => {
  const REACT_SELECT_BLUES = ["#DEEBFF", "#B2D4FF", "#2684FF", "hsl(0, 0%, 20%)"];
  const base = { label: "option" } as CSSObjectWithLabel;

  it("themes the focused row instead of react-select's hardcoded light blue", () => {
    const focused = selectOptionStyle(base, { isFocused: true, isSelected: false });
    expect(focused.backgroundColor).toBe("var(--secondary)");
    expect(focused.color).toBe("var(--secondary-foreground)");
    expect(REACT_SELECT_BLUES).not.toContain(focused.backgroundColor);
  });

  it("themes the selected row, and keeps it on press", () => {
    const selected = selectOptionStyle(base, { isFocused: true, isSelected: true });
    expect(selected.backgroundColor).toBe("var(--primary)");
    expect(selected.color).toBe("var(--primary-foreground)");
    // react-select's `:active` affordance is its own blue (`primary50`) unless
    // overridden, so the pressed row is asserted too.
    expect(selected[":active"]).toEqual({
      backgroundColor: "var(--primary)",
      color: "var(--primary-foreground)",
    });
  });

  it("keeps a hovered-but-unselected press themed", () => {
    const focused = selectOptionStyle(base, { isFocused: true, isSelected: false });
    expect(focused[":active"]).toEqual({
      backgroundColor: "var(--secondary)",
      color: "var(--secondary-foreground)",
    });
  });

  it("leaves a resting row transparent over the menu's own foreground", () => {
    const resting = selectOptionStyle(base, { isFocused: false, isSelected: false });
    expect(resting.backgroundColor).toBe("transparent");
    expect(resting.color).toBe("var(--popover-foreground)");
    expect(resting.cursor).toBe("pointer");
  });

  it("mutes a disabled row and refuses the pointer", () => {
    const disabled = selectOptionStyle(base, {
      isFocused: false,
      isSelected: false,
      isDisabled: true,
    });
    expect(disabled.color).toBe("var(--muted-foreground)");
    expect(disabled.cursor).toBe("not-allowed");
    expect(disabled[":active"]).toEqual({ backgroundColor: undefined });
  });

  it("flattens a disabled row whatever else it is, in both representations", () => {
    // A stored value can point AT a disabled option (an unavailable model), so
    // `isDisabled` + `isSelected` is reachable — and used to paint `primary`
    // under muted text on the default `Option` while the class variant said
    // transparent. Every combination is pinned so the two cannot diverge again.
    for (const isFocused of [false, true]) {
      for (const isSelected of [false, true]) {
        const state = { isFocused, isSelected, isDisabled: true };
        const style = selectOptionStyle(base, state);

        expect(style.backgroundColor, `bg for ${JSON.stringify(state)}`).toBe(
          "transparent",
        );
        expect(style.color, `color for ${JSON.stringify(state)}`).toBe(
          "var(--muted-foreground)",
        );
        expect(style.cursor).toBe("not-allowed");
        expect(style[":active"]).toEqual({ backgroundColor: undefined });
        expect(selectOptionClassName(state)).toBe(
          "bg-transparent text-muted-foreground",
        );
      }
    }
  });

  it("pairs every background with its own foreground token, never the ambient one", () => {
    // `foreground` over `secondary` is identical in `tc-night-owl-light` and
    // under 3:1 in 36 of the 149 themes; over `primary` it fails in 123.
    const pairs = [
      { state: { isFocused: true, isSelected: false }, bg: "secondary" },
      { state: { isFocused: false, isSelected: true }, bg: "primary" },
      { state: { isFocused: false, isSelected: false }, bg: "popover" },
    ];
    for (const { state, bg } of pairs) {
      expect(selectOptionSurface(state).color).toBe(`var(--${bg}-foreground)`);
      expect(selectOptionSurface(state).className).toContain(`text-${bg}-foreground`);
    }
  });

  it("gives a custom Option renderer the same surface as the default one", () => {
    // `ModelSelect` renders its own rows; both must resolve through this.
    expect(selectOptionClassName({ isFocused: true, isSelected: false })).toBe(
      "bg-secondary text-secondary-foreground",
    );
    expect(selectOptionClassName({ isFocused: false, isSelected: true })).toBe(
      "bg-primary text-primary-foreground",
    );
    expect(selectOptionClassName({ isFocused: false, isSelected: false })).toBe(
      "bg-transparent text-popover-foreground",
    );
    expect(
      selectOptionClassName({ isFocused: true, isSelected: true, isDisabled: true }),
    ).toBe("bg-transparent text-muted-foreground");
  });

  it("prefers selected over focused in both representations", () => {
    const state = { isFocused: true, isSelected: true };
    expect(selectOptionSurface(state).backgroundColor).toBe("var(--primary)");
    expect(selectOptionSurface(state).className).toBe(
      "bg-primary text-primary-foreground",
    );
  });

  it("keeps the hand-written hover class in step with the focused surface", () => {
    // Tailwind never emits a class built at runtime, so the literal is checked
    // against the table it mirrors.
    const focused = selectOptionSurface({ isFocused: true, isSelected: false });
    for (const className of focused.className.split(" ")) {
      expect(selectOptionHoverClassName).toContain(`hover:${className}`);
    }
  });
});

describe("withThemeColors", () => {
  const reactSelectTheme = {
    colors: {
      primary: "#2684FF",
      primary75: "#4C9AFF",
      primary50: "#B2D4FF",
      primary25: "#DEEBFF",
      neutral0: "hsl(0, 0%, 100%)",
      danger: "#DE350B",
    },
  } as unknown as Theme;

  it("remaps every react-select blue onto a theme var", () => {
    const { colors } = withThemeColors(reactSelectTheme);
    expect(colors.primary).toBe("var(--primary)");
    expect(colors.primary75).toBe("var(--secondary)");
    expect(colors.primary50).toBe("var(--secondary)");
    expect(colors.primary25).toBe("var(--secondary)");
    expect(colors.neutral0).toBe("var(--popover)");
    expect(colors.danger).toBe("var(--destructive)");
  });
});

