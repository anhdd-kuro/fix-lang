import React, { useEffect, useState } from "react";
import "../main.css"; // Import Tailwind CSS entry point
import ReactDOM from "react-dom/client";
import CopyButton from "../components/CopyButton";
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

  console.log("Translation window data:", data);
  if (!data) return null;

  return (
    <div className="flex flex-col h-screen text-white px-4 py-2">
      {/* Main content */}
      <div className="flex flex-col mt-2 flex-1 overflow-auto">
        <textarea
          className="prose dark:prose-invert text-xs whitespace-pre-wrap overflow-auto w-full flex-1 p-2 bg-gray-800 rounded border border-gray-700 focus:outline-none focus:border-blue-500"
          value={data.translatedText}
          readOnly
          placeholder="Translated Text"
        />

        <div className="flex justify-between mt-2 text-xs text-gray-500">
          <p>Prompt Tokens: {data.promptTokens ?? "-"}</p>
          <p>Completion Tokens: {data.completionTokens ?? "-"}</p>
        </div>
      </div>

      <CopyButton
        value={data.translatedText}
        label="Copy"
        className="absolute top-2 right-4"
      />
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
