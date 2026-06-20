import React, { useEffect, useState } from "react";
import "../main.css"; // Import Tailwind CSS entry point
import ReactDOM from "react-dom/client";
import CopyButton from "../components/CopyButton";
import { TextArea } from "../components/TextArea";
import type { TranslationPayload } from "~/main/webViewWindows/translationWindow";

const App: React.FC = () => {
  const [data, setData] = useState<TranslationPayload | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onTranslationData((payload) => {
      console.log("onTranslationData received");
      setData(payload);
    });
    return () => unsubscribe();
  }, []);

  return (
    <div
      data-testid="translation-window-root"
      className="flex flex-col h-screen bg-window text-label-primary px-4 py-3"
    >
      {/* Main content */}
      <div className="flex flex-col flex-1 overflow-auto gap-2">
        <TextArea
          value={data?.translatedText ?? ""}
          readOnly
          placeholder="Translated Text"
          rows={8}
          className="flex-1"
          textareaClassName="h-full resize-none"
          headerAction={
            data ? (
              <CopyButton
                value={data.translatedText}
                label="Copy translation"
              />
            ) : undefined
          }
          footer={
            data ? (
              <>
                <span className="text-label-tertiary text-[0.769rem]">
                  Prompt: {data.promptTokens ?? "-"}
                </span>
                <span className="mx-1 text-separator">·</span>
                <span className="text-label-tertiary text-[0.769rem]">
                  Completion: {data.completionTokens ?? "-"}
                </span>
              </>
            ) : undefined
          }
        />
      </div>
    </div>
  );
};

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Could not find root element with id 'root'");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
