import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import CopyButton from "../components/CopyButton";
import { useTheme } from "../hooks/useTheme";
import "../main.css";
import type { CorrectionResultPayload } from "~/shared/correctionResult";

const CorrectionResultWindow = () => {
  useTheme();
  const [payload, setPayload] = useState<CorrectionResultPayload | null>(null);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onCorrectionResultData(setPayload);
    // Signal after the listener is installed so the first payload is not lost.
    window.electronAPI.signalCorrectionResultReady();
    return unsubscribe;
  }, []);

  if (!payload) return null;

  return (
    <main className="flex h-screen flex-col gap-3 bg-background p-4 text-foreground">
      <header>
        <h1 className="text-base font-semibold">{payload.title}</h1>
        <p className="text-xs text-muted-foreground">
          Result only — the source text was not changed.
        </p>
      </header>

      <section className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-card p-4">
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
          {payload.text}
        </p>
      </section>

      <footer className="flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-sm hover:bg-secondary"
          onClick={() => window.electronAPI.closeCorrectionResultWindow()}
        >
          Close
        </button>
        <CopyButton value={payload.text} label="Copy" showLabel />
      </footer>
    </main>
  );
};

const container = document.getElementById("root");
if (container) {
  createRoot(container).render(<CorrectionResultWindow />);
}
