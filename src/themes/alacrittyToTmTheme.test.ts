/**
 * @file alacrittyToTmTheme.test.ts
 */
import { describe, expect, it } from "vitest";
import { alacrittyToTmTheme, parseAlacrittyToml } from "./alacrittyToTmTheme";

const SAMPLE_TOML = `[colors.primary]
foreground = "#f8f8f2"
background = "#282a36"

[colors.cursor]
text = "#282a36"
cursor = "#f8f8f2"

[colors.selection]
text = "#f8f8f2"
background = "#44475a"

[colors.normal]
black = "#21222c"
red = "#ff5555"
green = "#50fa7b"
yellow = "#f1fa8c"
blue = "#bd93f9"
magenta = "#ff79c6"
cyan = "#8be9fd"
white = "#f8f8f2"

[colors.bright]
black = "#6272a4"
red = "#ff6e6e"
green = "#69ff94"
yellow = "#ffffa5"
blue = "#d6acff"
magenta = "#ff92df"
cyan = "#a4ffff"
white = "#ffffff"
`;

describe("alacrittyToTmTheme", () => {
  it("parses alacritty toml and maps editor colors", () => {
    const palette = parseAlacrittyToml(SAMPLE_TOML);
    const theme = alacrittyToTmTheme("dracula-default", palette, "#ff79c6");

    expect(theme.name).toBe("tc-dracula-default");
    expect(theme.type).toBe("dark");
    expect(theme.colors?.["editor.background"]).toBe("#282a36");
    expect(theme.colors?.["button.background"]).toBe("#ff79c6");
  });
});
