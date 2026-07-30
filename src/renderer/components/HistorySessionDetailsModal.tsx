import React, { useRef, useState } from "react";
import { Button } from "./Button";
import CopyButton from "./CopyButton";
import {
  displayHistoryMessageContent,
  formatHistorySessionJson,
  historyChatMessages,
  historyChatSessionMeta,
  HISTORY_SESSION_DETAILS_TABS,
  reasoningEffortDisplayKey,
  type HistorySessionDetailsTab,
} from "./historySessionDetailsView";
import { useI18n } from "../i18n/useI18n";
import type { TKey } from "~/shared/i18n/translate";

type HistorySessionDetailsModalProps = {
  isOpen: boolean;
  sessionJson: string;
  onClose: () => void;
};

const ROLE_LABEL_KEYS: Record<string, TKey> = {
  assistant: "history.details.role.assistant",
  reasoning: "history.details.role.reasoning",
  system: "history.details.role.system",
  tool: "history.details.role.tool",
  user: "history.details.role.user",
};

export const HistorySessionDetailsModal: React.FC<
  HistorySessionDetailsModalProps
> = ({ isOpen, sessionJson, onClose }) => {
  const { t } = useI18n();
  const [activeTab, setActiveTab] = useState<HistorySessionDetailsTab>("json");
  const tabRefs = useRef<Partial<Record<HistorySessionDetailsTab, HTMLButtonElement>>>(
    {},
  );
  const pretty = formatHistorySessionJson(sessionJson);
  const chatMessages = historyChatMessages(sessionJson);
  const chatMeta = historyChatSessionMeta(sessionJson);

  const selectTab = (tab: HistorySessionDetailsTab) => {
    setActiveTab(tab);
    tabRefs.current[tab]?.focus();
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    const currentIndex = HISTORY_SESSION_DETAILS_TABS.findIndex(
      (tab) => tab.id === activeTab,
    );
    const lastIndex = HISTORY_SESSION_DETAILS_TABS.length - 1;
    const indexByKey: Partial<Record<string, number>> = {
      ArrowLeft: currentIndex === 0 ? lastIndex : currentIndex - 1,
      ArrowRight: currentIndex === lastIndex ? 0 : currentIndex + 1,
      End: lastIndex,
      Home: 0,
    };
    const nextIndex = indexByKey[event.key];
    if (nextIndex === undefined) return;

    event.preventDefault();
    selectTab(HISTORY_SESSION_DETAILS_TABS[nextIndex].id);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay-backdrop">
      <div className="flex max-h-[90vh] w-2/3 max-w-3xl flex-col overflow-hidden rounded-lg bg-card p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl text-card-foreground">
            {t("history.details.title")}
          </h2>
          {activeTab === "json" ? (
            <CopyButton
              value={pretty}
              label={t("history.details.copy")}
              className="shrink-0"
            />
          ) : null}
        </div>
        <nav
          className="mb-3 flex gap-1"
          role="tablist"
          aria-label={t("history.details.tabsAriaLabel")}
          onKeyDown={handleTabKeyDown}
        >
          {HISTORY_SESSION_DETAILS_TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            return (
              <Button
                key={tab.id}
                ref={(element) => {
                  tabRefs.current[tab.id] = element;
                }}
                type="button"
                variant={isActive ? "primary" : "ghost"}
                role="tab"
                id={`history-details-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls={`history-details-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => selectTab(tab.id)}
                className="rounded-md px-3 py-1 text-sm"
              >
                {t(tab.labelKey)}
              </Button>
            );
          })}
        </nav>
        <div
          className="min-h-0 flex-1 overflow-auto rounded-md bg-secondary p-3"
          role="tabpanel"
          id={`history-details-panel-${activeTab}`}
          aria-labelledby={`history-details-tab-${activeTab}`}
          tabIndex={0}
        >
          {activeTab === "json" ? (
            <pre
              className="text-xs text-foreground whitespace-pre-wrap break-words"
              aria-label={t("history.details.ariaLabel")}
            >
              {pretty}
            </pre>
          ) : chatMessages.length > 0 ? (
            <div className="flex flex-col gap-3">
              {chatMeta ? (
                <dl className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-card-control-border bg-card px-3 py-2 text-xs text-muted-foreground">
                  <div>
                    <dt className="sr-only">{t("common.promptTokens", { count: 0 })}</dt>
                    <dd>
                      {chatMeta.promptTokens === null
                        ? t("history.details.promptTokens.na")
                        : t("common.promptTokens", { count: chatMeta.promptTokens })}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">{t("common.completionTokens", { count: 0 })}</dt>
                    <dd>
                      {chatMeta.completionTokens === null
                        ? t("history.details.completionTokens.na")
                        : t("common.completionTokens", {
                            count: chatMeta.completionTokens,
                          })}
                    </dd>
                  </div>
                  {chatMeta.reasoningEffort ? (
                    <div>
                      <dt className="sr-only">{t("settings.correction.reasoning.label")}</dt>
                      <dd>
                        {t("history.details.reasoningLabel", {
                          effort: t(reasoningEffortDisplayKey(chatMeta.reasoningEffort)),
                        })}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : null}
              <ol
                className="flex flex-col gap-3"
                aria-label={t("history.details.chatAriaLabel")}
              >
                {chatMessages.map((message, index) => {
                  const labelKey = ROLE_LABEL_KEYS[message.role];
                  const roleLabel = labelKey ? t(labelKey) : message.role;
                  const content = displayHistoryMessageContent(message.content);

                  if (message.role === "system") {
                    return (
                      <li key={`${message.role}-${index}`}>
                        <details className="rounded-md border border-card-control-border bg-card p-3">
                          <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            {roleLabel} …
                          </summary>
                          <pre className="mt-2 text-sm text-foreground whitespace-pre-wrap break-words">
                            {content}
                          </pre>
                        </details>
                      </li>
                    );
                  }

                  const isUser = message.role === "user";
                  return (
                    <li
                      key={`${message.role}-${index}`}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[80%] rounded-lg p-3 ${
                          isUser
                            ? "bg-primary text-primary-foreground"
                            : "border border-card-control-border bg-card text-card-foreground"
                        }`}
                      >
                        <h3 className="mb-1 text-xs font-medium uppercase tracking-wide opacity-70">
                          {roleLabel}
                        </h3>
                        <pre className="text-sm whitespace-pre-wrap break-words">
                          {content}
                        </pre>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("history.details.chatUnavailable")}
            </p>
          )}
        </div>
        <div className="mt-4 text-right">
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setActiveTab("json");
              onClose();
            }}
            className="rounded px-4 py-2"
            aria-label={t("history.details.closeAriaLabel")}
          >
            {t("common.close")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default HistorySessionDetailsModal;
