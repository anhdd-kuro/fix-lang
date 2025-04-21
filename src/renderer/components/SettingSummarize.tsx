import React, { useState, useEffect } from "react";

export const SettingSummarize: React.FC = () => {
  const [minLength, setMinLength] = useState(0);
  const [maxLength, setMaxLength] = useState(0);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    window.electronAPI.getSummarizeSettings().then((settings) => {
      setMinLength(settings.minLength);
      setMaxLength(settings.maxLength);
    });
  }, []);

  useEffect(() => {
    const off = window.electronAPI.onSettingsUpdated?.(() => {
      window.electronAPI.getSummarizeSettings().then(({ minLength, maxLength }) => {
        setMinLength(minLength);
        setMaxLength(maxLength);
      });
    });
    return () => off?.();
  }, []);

  const handleSave = async () => {
    const result = await window.electronAPI.setSummarizeSettings({
      minLength,
      maxLength,
    });
    if (result.success) {
      setStatus("Saved!");
      setTimeout(() => setStatus(""), 2000);
    } else {
      setStatus("Error");
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-lg font-medium text-gray-300">Summarize Settings</h3>
      <div className="flex gap-2">
        <div>
          <label
            htmlFor="summarize-min-length"
            className="block text-gray-300 text-sm"
          >
            Min Length
          </label>
          <input
            id="summarize-min-length"
            title="Minimum summary length"
            placeholder="Enter min length"
            type="number"
            value={minLength}
            onChange={(e) => setMinLength(Number(e.target.value))}
            className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
          />
        </div>
        <div>
          <label
            htmlFor="summarize-max-length"
            className="block text-gray-300 text-sm"
          >
            Max Length
          </label>
          <input
            id="summarize-max-length"
            title="Maximum summary length"
            placeholder="Enter max length"
            type="number"
            value={maxLength}
            onChange={(e) => setMaxLength(Number(e.target.value))}
            className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
          />
        </div>
      </div>
      <button
        onClick={handleSave}
        className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
      >
        {status || "Save"}
      </button>
    </section>
  );
};
