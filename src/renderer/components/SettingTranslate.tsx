import React, { useState, useEffect } from "react";

export const SettingTranslate: React.FC = () => {
  const [destinationLang, setDestinationLang] = useState("");
  const [includeExplanation, setIncludeExplanation] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    window.electronAPI.getTranslateSettings().then((settings) => {
      setDestinationLang(settings.destinationLang);
      setIncludeExplanation(settings.includeExplanation);
    });
  }, []);

  useEffect(() => {
    const off = window.electronAPI.onSettingsUpdated?.(() => {
      window.electronAPI.getTranslateSettings().then((settings) => {
        setDestinationLang(settings.destinationLang);
        setIncludeExplanation(settings.includeExplanation);
      });
    });
    return () => off?.();
  }, []);

  const handleSave = async () => {
    const result = await window.electronAPI.setTranslateSettings({
      destinationLang,
      includeExplanation,
    });
    if (result.success) {
      setStatus("Saved!");
      setTimeout(() => setStatus(""), 2000);
    } else setStatus("Error");
  };

  return (
    <section className="flex flex-col gap-4">
      <div>
        <label
          htmlFor="translate-destination-lang"
          className="block text-gray-300 text-sm mb-2"
        >
          Destination Language
        </label>
        <input
          id="translate-destination-lang"
          title="Destination language for translation"
          placeholder="Enter target language"
          type="text"
          value={destinationLang}
          onChange={(e) => setDestinationLang(e.target.value)}
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100"
        />
      </div>
      <label className="inline-flex items-center text-gray-300">
        <input
          type="checkbox"
          checked={includeExplanation}
          onChange={() => setIncludeExplanation(!includeExplanation)}
          className="form-checkbox"
        />
        <span className="ml-2">Include Explanation</span>
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
