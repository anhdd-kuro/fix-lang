/**
 * @file userGuideView.ts
 * @description PURE view model for the About tab's User guide sub-tab. Same
 * split as `usage/usageTabs.ts`: the component renders, this decides — so the
 * guide's derivations are unit-testable without a DOM testing library.
 *
 * The guide reads the user's REAL configuration (presets, hotkeys, output mode,
 * connected providers) rather than describing defaults, so it cannot drift from
 * what the app actually does after the user edits a preset or a shortcut.
 */
import { PROVIDER_ORDER, type ProviderId } from "~/features/providers/shared/providers";
import { DASHBOARD_TABS, type DashboardTabId } from "../../MainWindow/dashboardTabs";
import { PROVIDER_LABEL_KEYS } from "../modelSelectOptions";
import type { SettingsTabId } from "../SettingsModal";
import type { CorrectionOutputMode } from "~/features/correction/shared/outputMode";
import type { MessageKey } from "~/features/i18n/shared/message";

/** Minimal preset shape the guide reads — deliberately narrower than `CorrectionPreset`. */
export type GuidePresetInput = {
  id: string;
  name: string;
  hotkey: string;
};

export type GuidePresetRow = {
  id: string;
  name: string;
  /** One chip per key, in the order the user must press them. Empty = no shortcut. */
  keys: string[];
};

/** Connection flags the guide reads — narrower than the full `ProviderState`. */
export type GuideProviderInput = { connected: boolean };

export type GuideProviderRow = {
  provider: ProviderId;
  labelKey: MessageKey;
};

/**
 * Split a stored accelerator ("Control+Shift+F") into display chips. Blank and
 * whitespace-only values yield an empty list, which is what the panel renders
 * its "no shortcut assigned" state from — a preset with a cleared hotkey is a
 * legitimate state, not a data error.
 */
export const splitHotkey = (hotkey: string | undefined): string[] =>
  (hotkey ?? "")
    .split("+")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

/** Presets in configured order, each with its shortcut split into chips. */
export const buildPresetRows = (
  presets: readonly GuidePresetInput[],
): GuidePresetRow[] =>
  presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    keys: splitHotkey(preset.hotkey),
  }));

/**
 * Connected providers in `PROVIDER_ORDER`, so the guide lists them in the same
 * order as the Settings cards and the model picker.
 */
export const buildProviderRows = (
  states: Partial<Record<ProviderId, GuideProviderInput>>,
): GuideProviderRow[] =>
  PROVIDER_ORDER.filter((provider) => states[provider]?.connected === true).map(
    (provider) => ({ provider, labelKey: PROVIDER_LABEL_KEYS[provider] }),
  );

export type OutputModeDescriptor = {
  labelKey: MessageKey;
  descriptionKey: MessageKey;
};

/**
 * The two output modes reuse the Settings radio's own strings, so the guide can
 * never describe a mode differently from the control that changes it.
 */
const OUTPUT_MODE_DESCRIPTORS: Readonly<
  Record<CorrectionOutputMode, OutputModeDescriptor>
> = Object.freeze({
  paste: {
    labelKey: "settings.general.correctionOutput.paste.label",
    descriptionKey: "settings.general.correctionOutput.paste.description",
  },
  popup: {
    labelKey: "settings.general.correctionOutput.popup.label",
    descriptionKey: "settings.general.correctionOutput.popup.description",
  },
});

/** `null` for an unread/unknown mode — the panel then shows its unknown state. */
export const outputModeDescriptor = (
  mode: CorrectionOutputMode | null,
): OutputModeDescriptor | null =>
  mode === null ? null : (OUTPUT_MODE_DESCRIPTORS[mode] ?? null);

/**
 * One-line description per dashboard tab, so the guide can point a new user at
 * the right tab. Keyed by `DashboardTabId` and consumed through
 * `buildDashboardRows` below, which walks `DASHBOARD_TABS` — a renamed or
 * removed tab therefore drops out of the guide instead of describing something
 * that is no longer there.
 */
const DASHBOARD_BODY_KEYS: Readonly<Record<DashboardTabId, MessageKey | null>> =
  Object.freeze({
    overview: "guide.dashboard.overview",
    history: "guide.dashboard.history",
    models: "guide.dashboard.models",
    usage: "guide.dashboard.usage",
    logs: "guide.dashboard.logs",
    security: "guide.dashboard.security",
    // The reader is already on About; describing it back to them is noise.
    about: null,
  });

export type GuideDashboardRow = {
  id: DashboardTabId;
  /** The tab's own label key — reused so the guide always names the live tab. */
  labelKey: MessageKey;
  bodyKey: MessageKey;
};

export const buildDashboardRows = (): GuideDashboardRow[] =>
  DASHBOARD_TABS.flatMap((tab) => {
    const bodyKey = DASHBOARD_BODY_KEYS[tab.id];
    return bodyKey === null
      ? []
      : [{ id: tab.id, labelKey: tab.labelKey, bodyKey }];
  });

export type GuideTopic = {
  id: string;
  titleKey: MessageKey;
  bodyKey: MessageKey;
  /** Settings tab the topic's title opens when clicked. */
  settingsTab: SettingsTabId;
  /** Set when the body interpolates the user's live profile-switch shortcut. */
  interpolatesHotkey?: true;
};

/**
 * "Settings worth knowing" — ordered by how likely a first-time user is to need
 * it, not by where it sits in the Settings modal. Each title is a link to the
 * `settingsTab` that actually holds the control it describes.
 */
export const GUIDE_TOPICS: readonly GuideTopic[] = Object.freeze([
  {
    id: "output",
    titleKey: "guide.topic.output.title",
    bodyKey: "guide.topic.output.body",
    settingsTab: "general",
  },
  {
    id: "presets",
    titleKey: "guide.topic.presets.title",
    bodyKey: "guide.topic.presets.body",
    settingsTab: "correction",
  },
  {
    id: "models",
    titleKey: "guide.topic.models.title",
    bodyKey: "guide.topic.models.body",
    settingsTab: "correction",
  },
  {
    id: "profiles",
    titleKey: "guide.topic.profiles.title",
    bodyKey: "guide.topic.profiles.body",
    settingsTab: "profiles",
    interpolatesHotkey: true,
  },
  {
    id: "language",
    titleKey: "guide.topic.language.title",
    bodyKey: "guide.topic.language.body",
    settingsTab: "general",
  },
  {
    id: "theme",
    titleKey: "guide.topic.theme.title",
    bodyKey: "guide.topic.theme.body",
    settingsTab: "appearance",
  },
  {
    id: "adminKey",
    titleKey: "guide.topic.adminKey.title",
    bodyKey: "guide.topic.adminKey.body",
    settingsTab: "general",
  },
  {
    id: "combo",
    titleKey: "guide.topic.combo.title",
    bodyKey: "guide.topic.combo.body",
    settingsTab: "combos",
  },
] satisfies GuideTopic[]);
