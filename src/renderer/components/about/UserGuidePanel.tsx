/**
 * @file UserGuidePanel.tsx
 * @description The About tab's User guide sub-tab: a short onboarding read for
 * a first-time user — what FixLang is for, how to run one transform, and which
 * settings are worth touching.
 *
 * Everything the guide states about THIS install is read live (presets and
 * their shortcuts, output mode, connected providers, the profile-switch
 * shortcut) instead of being written into the copy, so an edited preset or a
 * rebound hotkey cannot leave the guide describing something the app no longer
 * does. All derivations live in the pure `userGuideView.ts`.
 *
 * Re-reads on `settings-updated` AND on a profile switch: presets, providers
 * and output mode are all profile-scoped, and a profile switch does not emit
 * `settings-updated`.
 */
import { useEffect, useState, type ReactNode } from "react";
import { isPromptGenEnabled } from "~/shared/features";
import {
  buildDashboardRows,
  buildPresetRows,
  buildProviderRows,
  GUIDE_TOPICS,
  outputModeDescriptor,
  splitHotkey,
  type GuidePresetRow,
  type GuideProviderRow,
} from "./userGuideView";
import { useI18n } from "../../i18n/useI18n";
import { Button } from "../Button";
import { Spinner } from "../Spinner";
import type { DashboardTabId } from "../../MainWindow/dashboardTabs";
import type { SettingsTabId } from "../SettingsModal";
import type { CorrectionOutputMode } from "~/shared/outputMode";

/** Repository README — the long-form reference this guide deliberately is not. */
const DOCS_URL = "https://github.com/anhdd-kuro/fix-lang";

/**
 * Primary-link styling for a guide title that navigates elsewhere (a Settings
 * tab or a dashboard tab), matching the docs link at the bottom of this panel.
 * Rendered on a `variant="ghost"` `Button` — this overrides its hover fill so
 * the result reads as a plain link, not a ghost button.
 */
const GUIDE_LINK_CLASS = "text-primary underline hover:bg-transparent hover:no-underline";

type LoadPhase = "loading" | "ready" | "error";

type GuideSnapshot = {
  presets: GuidePresetRow[];
  providers: GuideProviderRow[];
  outputMode: CorrectionOutputMode | null;
  profileSwitchKeys: string[];
  promptGenKeys: string[];
};

const EMPTY_SNAPSHOT: GuideSnapshot = {
  presets: [],
  providers: [],
  outputMode: null,
  profileSwitchKeys: [],
  promptGenKeys: [],
};

/**
 * Read-only shortcut chips. Styled like the chips in `KeyBinding.tsx`, which is
 * not reused here because it carries an editing button this panel must not show.
 */
const HotkeyChips = ({ keys, fallback }: { keys: string[]; fallback: string }) => {
  if (keys.length === 0) {
    return <span className="text-xs text-muted-foreground">{fallback}</span>;
  }
  return (
    <ul className="inline-flex flex-wrap items-center gap-1">
      {/* Index-keyed: a combo can legitimately repeat a token, and a duplicate
          React key would drop a chip the user has to press. */}
      {keys.map((key, index) => (
        <li
          key={`${String(index)}-${key}`}
          className="inline-block rounded-lg border border-control-border bg-muted px-2 py-1 text-xs font-semibold text-foreground"
        >
          {key}
        </li>
      ))}
    </ul>
  );
};

const GuideSection = ({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) => (
  <section aria-labelledby={id} className="mt-6 first:mt-0">
    <h3 id={id} className="text-base font-medium text-card-foreground">
      {title}
    </h3>
    {children}
  </section>
);

export const UserGuidePanel = ({
  onOpenSettings,
  onNavigateToTab,
}: {
  /**
   * Opens the Settings modal — every "change this in Settings" affordance.
   * Pass a tab id to land on that tab directly (used by the "Settings worth
   * knowing" topic links); omit it to open on whatever tab was last active.
   */
  onOpenSettings: (tabId?: SettingsTabId) => void;
  /** Switches the dashboard to `tabId` — used by the "Where to look afterwards" links. */
  onNavigateToTab: (tabId: DashboardTabId) => void;
}) => {
  const { t } = useI18n();
  const [phase, setPhase] = useState<LoadPhase>("loading");
  const [snapshot, setSnapshot] = useState<GuideSnapshot>(EMPTY_SNAPSHOT);

  useEffect(() => {
    let mounted = true;

    const load = (): void => {
      void Promise.all([
        Promise.resolve(window.electronAPI.getCorrectSettings()),
        Promise.resolve(window.electronAPI.getKeyBindings()),
        Promise.resolve(window.electronAPI.getCorrectionOutputMode()),
        Promise.resolve(window.electronAPI.getProviderStates?.()),
      ])
        .then(([correction, keyBindings, outputMode, providerStates]) => {
          if (!mounted) return;
          setSnapshot({
            presets: buildPresetRows(correction?.presets ?? []),
            providers: buildProviderRows(providerStates ?? {}),
            outputMode: outputMode ?? null,
            profileSwitchKeys: splitHotkey(keyBindings?.profileSwitch),
            promptGenKeys: splitHotkey(keyBindings?.promptGen),
          });
          setPhase("ready");
        })
        .catch(() => {
          // The written guidance below does not depend on any of this, so a
          // failed read degrades to "we could not read your setup" rather than
          // blanking the whole tab.
          if (!mounted) return;
          setSnapshot(EMPTY_SNAPSHOT);
          setPhase("error");
        });
    };

    load();
    const offSettingsUpdated = window.electronAPI.onSettingsUpdated(load);
    const offProfileChanged = window.electronAPI.onActiveProfileChanged?.(load);

    return () => {
      mounted = false;
      offSettingsUpdated();
      offProfileChanged?.();
    };
  }, []);

  const noHotkeyText = t("guide.presets.noHotkey");
  const output = outputModeDescriptor(snapshot.outputMode);
  const dashboardRows = buildDashboardRows();
  const profileSwitchText =
    snapshot.profileSwitchKeys.length === 0
      ? noHotkeyText
      : snapshot.profileSwitchKeys.join(" + ");

  return (
    <div className="mx-auto max-w-3xl pb-2">
      <h2 className="text-base font-medium text-card-foreground">
        {t("guide.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("guide.intro")}</p>

      {phase === "loading" && (
        <p
          className="mt-2 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <Spinner className="mr-2 inline size-4 align-[-2px]" />
          {t("guide.loading")}
        </p>
      )}
      {phase === "error" && (
        <p className="mt-2 text-sm text-warning" role="status" aria-live="polite">
          {t("guide.loadError")}
        </p>
      )}

      <GuideSection id="guide-setup-heading" title={t("guide.setup.title")}>
        <ol className="mt-2 list-decimal space-y-3 pl-5">
          <li className="text-sm text-muted-foreground">
            <span className="font-semibold text-card-foreground">
              {t("guide.setup.provider.title")}
            </span>
            <p className="mt-0.5">{t("guide.setup.provider.body")}</p>
            {phase === "ready" &&
              (snapshot.providers.length === 0 ? (
                <p className="mt-1 text-warning">
                  {t("guide.setup.provider.none")}
                </p>
              ) : (
                <p className="mt-1">
                  {t("guide.setup.provider.connected", {
                    providers: snapshot.providers
                      .map((row) => t(row.labelKey))
                      .join(", "),
                  })}
                </p>
              ))}
          </li>
          <li className="text-sm text-muted-foreground">
            <span className="font-semibold text-card-foreground">
              {t("guide.setup.model.title")}
            </span>
            <p className="mt-0.5">{t("guide.setup.model.body")}</p>
          </li>
          <li className="text-sm text-muted-foreground">
            <span className="font-semibold text-card-foreground">
              {t("guide.setup.permission.title")}
            </span>
            <p className="mt-0.5">{t("guide.setup.permission.body")}</p>
          </li>
        </ol>
        <Button
          onClick={() => onOpenSettings()}
          className="mt-3 rounded px-3 py-1.5 text-sm"
        >
          {t("guide.openSettings")}
        </Button>
      </GuideSection>

      <GuideSection id="guide-transform-heading" title={t("guide.transform.title")}>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>{t("guide.transform.select")}</li>
          <li>{t("guide.transform.press")}</li>
          <li>{t("guide.transform.receive")}</li>
        </ol>

        <h4 className="mt-3 text-sm font-semibold text-card-foreground">
          {t("guide.presets.heading")}
        </h4>
        {/* Loading gets skeleton rows rather than an empty bordered box, which
            would read as "you have no presets" for as long as the IPC takes.
            On `error` the banner above is the whole explanation — inventing an
            empty state here would say the user has no presets when what failed
            was reading them. */}
        {phase === "loading" && (
          <ul
            className="mt-1 divide-y divide-card-control-border rounded border border-card-control-border"
            aria-hidden="true"
          >
            {[0, 1, 2].map((row) => (
              <li key={row} className="px-3 py-2">
                <div className="h-4 w-40 animate-pulse rounded bg-muted" />
              </li>
            ))}
          </ul>
        )}
        {phase === "ready" &&
          (snapshot.presets.length === 0 ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {t("guide.presets.empty")}
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-card-control-border rounded border border-card-control-border">
              {snapshot.presets.map((preset) => (
                <li
                  key={preset.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <span className="min-w-0 break-words text-sm text-card-foreground">
                    {preset.name}
                  </span>
                  <HotkeyChips keys={preset.keys} fallback={noHotkeyText} />
                </li>
              ))}
            </ul>
          ))}

        <h4 className="mt-3 text-sm font-semibold text-card-foreground">
          {t("guide.output.heading")}
        </h4>
        <p className="mt-1 text-sm text-muted-foreground">
          {output === null
            ? t("guide.output.unknown")
            : t("guide.output.current", {
                mode: t(output.labelKey),
                description: t(output.descriptionKey),
              })}
        </p>
      </GuideSection>

      <GuideSection id="guide-topics-heading" title={t("guide.topics.title")}>
        <dl className="mt-2 grid gap-3 sm:grid-cols-2">
          {GUIDE_TOPICS.map((topic) => (
            <div key={topic.id}>
              <dt className="text-sm font-semibold">
                <Button
                  variant="ghost"
                  onClick={() => onOpenSettings(topic.settingsTab)}
                  className={GUIDE_LINK_CLASS}
                >
                  {t(topic.titleKey)}
                </Button>
              </dt>
              <dd className="mt-0.5 text-sm text-muted-foreground">
                {topic.interpolatesHotkey
                  ? t(topic.bodyKey, { hotkey: profileSwitchText })
                  : t(topic.bodyKey)}
              </dd>
            </div>
          ))}
          {isPromptGenEnabled() && (
            <div>
              <dt className="text-sm font-semibold">
                <Button
                  variant="ghost"
                  onClick={() => onOpenSettings("promptGen")}
                  className={GUIDE_LINK_CLASS}
                >
                  {t("guide.topic.promptGen.title")}
                </Button>
              </dt>
              <dd className="mt-0.5 text-sm text-muted-foreground">
                {t("guide.topic.promptGen.body", {
                  hotkey:
                    snapshot.promptGenKeys.length === 0
                      ? noHotkeyText
                      : snapshot.promptGenKeys.join(" + "),
                })}
              </dd>
            </div>
          )}
        </dl>
      </GuideSection>

      <GuideSection id="guide-dashboard-heading" title={t("guide.dashboard.title")}>
        <dl className="mt-2 space-y-1">
          {dashboardRows.map((row) => (
            <div key={row.id} className="flex flex-wrap gap-x-2 text-sm">
              <dt className="font-semibold">
                <Button
                  variant="ghost"
                  onClick={() => onNavigateToTab(row.id)}
                  className={GUIDE_LINK_CLASS}
                >
                  {t(row.labelKey)}
                </Button>
              </dt>
              <dd className="min-w-0 flex-1 text-muted-foreground">
                {t(row.bodyKey)}
              </dd>
            </div>
          ))}
        </dl>
      </GuideSection>

      <GuideSection id="guide-privacy-heading" title={t("guide.privacy.title")}>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("guide.privacy.body")}
        </p>
        <a
          href={DOCS_URL}
          onClick={(event) => {
            event.preventDefault();
            void window.electronAPI.openExternalLink(DOCS_URL);
          }}
          className="mt-2 inline-block text-sm text-primary underline hover:no-underline"
        >
          {t("guide.docsLink")}
        </a>
      </GuideSection>
    </div>
  );
};
