/**
 * @file ReasoningEffortSlider.test.ts
 * @description Mapping and rendered-label coverage for the reasoning slider.
 */
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createFormatters } from "~/shared/i18n/format";
import { createTranslator } from "~/shared/i18n/translate";
import {
  DEFAULT_REASONING_EFFORT,
  REASONING_EFFORT_SLIDER_STEPS,
  reasoningEffortToStepIndex,
  stepIndexToReasoningEffort,
} from "~/shared/reasoningEffort";
import { ReasoningEffortSlider } from "./ReasoningEffortSlider";
import { I18nContext } from "../../i18n/I18nProvider";

describe("ReasoningEffortSlider contract", () => {
  const t = createTranslator("en");

  it("exposes five None→Smarter steps ending at high", () => {
    expect(REASONING_EFFORT_SLIDER_STEPS).toHaveLength(5);
    expect(REASONING_EFFORT_SLIDER_STEPS[0]).toBe("none");
    expect(REASONING_EFFORT_SLIDER_STEPS[4]).toBe("high");
  });

  it("starts unset presets on None", () => {
    expect(reasoningEffortToStepIndex(undefined)).toBe(0);
    expect(stepIndexToReasoningEffort(0)).toBe(DEFAULT_REASONING_EFFORT);
  });

  it("renders every effort label beneath its matching slider stop", () => {
    const markup = renderToStaticMarkup(
      React.createElement(
        I18nContext.Provider,
        {
          value: {
            ...createFormatters("en"),
            locale: "en",
            dir: "ltr",
            t,
            setLocale: () => Promise.resolve(),
          },
        },
        React.createElement(ReasoningEffortSlider, {
          value: "medium",
          onChange: () => undefined,
        }),
      ),
    );

    for (const step of REASONING_EFFORT_SLIDER_STEPS) {
      expect(markup).toContain(`data-reasoning-step="${step}"`);
    }
    expect(markup.indexOf('type="range"')).toBeLessThan(
      markup.indexOf('data-reasoning-step="none"'),
    );
    expect(markup).not.toContain(
      `>${t("settings.correction.reasoning.faster")}<`,
    );
    expect(markup).not.toContain(
      `>${t("settings.correction.reasoning.smarter")}<`,
    );
  });
});
