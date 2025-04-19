import React, { useEffect, useState } from "react";
import "../main.css"; // Import Tailwind CSS entry point
import ReactDOM from "react-dom/client";
import CopyButton from "../components/CopyButton";
import type { TranslationPayload } from "~/main/partials/translationWindow";

const App: React.FC = () => {
  const [data, setData] = useState<TranslationPayload | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onTranslationData((payload) => {
      setData(payload);
    });
    return () => unsubscribe();
  }, []);

  console.log("Translation window data:", data);
  if (!data) return null;

  // Loading state
  if (data.loading) {
    return (
      <div className="flex items-center justify-center  w-screen h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500"></div>
      </div>
    );
  }

  return (
    <div className="flex flex-col relative px-2 pb-2 backdrop-blur-2xl shadow-lg overflow-auto w-screen h-screen text-white">
      <textarea
        className="prose dark:prose-invert text-xs whitespace-pre-wrap overflow-auto w-full flex-1 p-1 focus:outline-none focus:border-none mt-8"
        value={data.translatedText}
        readOnly
        placeholder="Translated Text"
      />
      <div className="flex justify-between mt-2 text-xs text-gray-500">
        <p>Prompt Tokens: {data.promptTokens ?? "-"}</p>
        <p>Completion Tokens: {data.completionTokens ?? "-"}</p>
      </div>
      <div className="flex absolute top-2 right-2 gap-1">
        <CopyButton
          value={data.translatedText}
          label="Copy translated text size-6"
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
