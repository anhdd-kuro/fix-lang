import React, { useCallback, useRef, useState } from "react";
import { Button } from "./Button";
import {
  ChatTranscript,
  type ChatTranscriptMetaItem,
} from "./ChatTranscript";
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
import { useModalDismiss } from "../hooks/useModalDismiss";
import { useI18n } from "../i18n/useI18n";
import type { TKey } from "~/features/i18n/shared/translate";

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
  const closeModal = useCallback(() => {
    setActiveTab("json");
    onClose();
  }, [onClose]);
  const modalRef = useModalDismiss<HTMLDivElement>(isOpen, closeModal);
  const pretty = formatHistorySessionJson(sessionJson);
  const chatMessages = historyChatMessages(sessionJson);
  const chatMeta = historyChatSessionMeta(sessionJson);
  // Built here rather than inside `ChatTranscript` because the strip states
  // TOKENS, which only a stored session has — the Ask windows show the same
  // transcript with no meta strip at all.
  const metaItems: ChatTranscriptMetaItem[] = chatMeta
    ? [
        {
          term: t("common.promptTokens", { count: 0 }),
          description:
            chatMeta.promptTokens === null
              ? t("history.details.promptTokens.na")
              : t("common.promptTokens", { count: chatMeta.promptTokens }),
        },
        {
          term: t("common.completionTokens", { count: 0 }),
          description:
            chatMeta.completionTokens === null
              ? t("history.details.completionTokens.na")
              : t("common.completionTokens", {
                  count: chatMeta.completionTokens,
                }),
        },
        ...(chatMeta.reasoningEffort
          ? [
              {
                term: t("settings.correction.reasoning.label"),
                description: t("history.details.reasoningLabel", {
                  effort: t(
                    reasoningEffortDisplayKey(chatMeta.reasoningEffort),
                  ),
                }),
              },
            ]
          : []),
      ]
    : [];

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
      <div
        ref={modalRef}
        className="flex h-[80vh] max-h-[80vh] w-2/3 max-w-3xl flex-col overflow-hidden rounded-lg bg-card p-6 shadow-xl"
      >
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
            <ChatTranscript
              ariaLabel={t("history.details.chatAriaLabel")}
              meta={chatMeta ? metaItems : undefined}
              messages={chatMessages.map((message) => ({
                role: message.role,
                label: ROLE_LABEL_KEYS[message.role]
                  ? t(ROLE_LABEL_KEYS[message.role])
                  : message.role,
                content: displayHistoryMessageContent(message.content),
              }))}
            />
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
            onClick={closeModal}
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
