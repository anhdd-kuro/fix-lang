import React, { useMemo, useState } from "react";
import { twJoin } from "tailwind-merge";
import { useTheme } from "../hooks/useTheme";
import { THEME_PRESETS } from "../themes";
import type { ThemeId } from "~/stores/themeIds";

const THEME_CARD_MIN = "9.5rem";
const THEME_CARD_MAX = "13rem";

/**
 * Appearance settings — searchable theme preset picker with square preview cards.
 */
export const SettingAppearance: React.FC = () => {
  const { themeId, setTheme, isLoading } = useTheme();
  const [query, setQuery] = useState("");

  const filteredPresets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return THEME_PRESETS;
    }

    return THEME_PRESETS.filter(
      (preset) =>
        preset.label.toLowerCase().includes(normalized) ||
        preset.id.toLowerCase().includes(normalized) ||
        preset.description.toLowerCase().includes(normalized),
    );
  }, [query]);

  const handleSelect = async (nextThemeId: ThemeId) => {
    if (nextThemeId === themeId) {
      return;
    }
    await setTheme(nextThemeId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0">
        <h3 className="text-lg font-medium text-foreground">Theme</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Choose from {THEME_PRESETS.length} bundled themes. Changes apply
          instantly across all windows.
        </p>
      </div>

      <label className="block shrink-0">
        <span className="sr-only">Search themes</span>
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
          }}
          placeholder="Search themes…"
          className="w-full rounded-md border border-input bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </label>

      {filteredPresets.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No themes match &ldquo;{query}&rdquo;
        </p>
      ) : (
        <div
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-1"
          role="radiogroup"
          aria-label="Theme preset"
        >
          <div
            className="grid gap-3"
            style={{
              gridTemplateColumns: `repeat(auto-fill, minmax(min(100%, ${THEME_CARD_MIN}), 1fr))`,
            }}
          >
            {filteredPresets.map((preset) => {
              const isSelected = preset.id === themeId;

              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isSelected}
                  aria-label={preset.label}
                  disabled={isLoading}
                  onClick={() => {
                    void handleSelect(preset.id);
                  }}
                  style={{ maxWidth: THEME_CARD_MAX }}
                  className={twJoin(
                    "group mx-auto flex w-full min-w-0 flex-col rounded-lg border text-left transition-colors",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    isSelected
                      ? "border-primary ring-2 ring-ring"
                      : "border-border hover:border-primary/50 hover:bg-accent/40",
                  )}
                >
                  <div
                    className="relative aspect-square w-full overflow-hidden rounded-t-[calc(0.5rem-1px)]"
                    style={{ backgroundColor: preset.swatch.background }}
                    aria-hidden="true"
                  >
                    <div
                      className="absolute inset-x-3 top-3 h-3 rounded-sm"
                      style={{ backgroundColor: preset.swatch.primary }}
                    />
                    <div
                      className="absolute inset-x-3 bottom-3 h-8 rounded-sm"
                      style={{ backgroundColor: preset.swatch.accent }}
                    />
                  </div>
                  <div className="px-2.5 py-2">
                    <div className="truncate text-sm font-medium text-foreground">
                      {preset.label}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {preset.description}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
