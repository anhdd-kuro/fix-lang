import React, { useState, useEffect } from "react";

export const SettingCorrect: React.FC = () => {
  const [tone, setTone] = useState<string>("");
  const [paraphrase, setParaphrase] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    window.electronAPI.getCorrectSettings().then((settings) => {
      setTone(settings.tone);
      setParaphrase(settings.paraphrase);
    });
  }, []);

  // Sync settings on updates
  useEffect(() => {
    const off = window.electronAPI.onSettingsUpdated?.(() => {
      window.electronAPI.getCorrectSettings().then((settings) => {
        setTone(settings.tone);
        setParaphrase(settings.paraphrase);
      });
    });
    return () => off?.();
  }, []);

  const handleSave = async () => {
    const result = await window.electronAPI.setCorrectSettings({
      tone,
      paraphrase,
    });
    if (result.success) {
      setStatus("Saved!");
      setTimeout(() => setStatus(""), 2000);
    } else {
      setStatus("Error saving settings");
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <label className="text-gray-300 text-sm">Tone</label>
        <textarea
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Enter desired tone"
          aria-label="Tone"
        />
      </div>
      <label className="inline-flex items-center text-gray-300">
        <input
          type="checkbox"
          checked={paraphrase}
          onChange={() => setParaphrase(!paraphrase)}
          className="form-checkbox h-4 w-4 text-blue-500"
        />
        <span className="ml-2">Paraphrase</span>
      </label>
      <button
        onClick={handleSave}
        className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        {status || "Save"}
      </button>
    </section>
  );
};
