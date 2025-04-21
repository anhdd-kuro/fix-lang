import React, { useState, useEffect } from "react";

export const SettingPromptGen: React.FC = () => {
  const [minLength, setMinLength] = useState(0);
  const [maxLength, setMaxLength] = useState(0);
  const [nsfw, setNsfw] = useState(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    window.electronAPI.getPromptgenSettings().then((settings) => {
      setMinLength(settings.minLength);
      setMaxLength(settings.maxLength);
      setNsfw(settings.nsfw);
    });
  }, []);

  useEffect(() => {
    const off = window.electronAPI.onSettingsUpdated?.(() => {
      window.electronAPI.getPromptgenSettings().then((settings) => {
        setMinLength(settings.minLength);
        setMaxLength(settings.maxLength);
        setNsfw(settings.nsfw);
      });
    });
    return () => off?.();
  }, []);

  const handleSave = async () => {
    const result = await window.electronAPI.setPromptgenSettings({ minLength, maxLength, nsfw });
    if (result.success) {
      setStatus("Saved!");
      setTimeout(() => setStatus(""), 2000);
    } else setStatus("Error");
  };

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-lg font-medium text-gray-300">PromptGen Settings</h3>
      <div className="flex gap-2">
        <div>
          <label htmlFor="promptgen-min" className="block text-gray-300 text-sm">Min Length</label>
          <input
            id="promptgen-min"
            type="number"
            aria-label="PromptGen minimum length"
            value={minLength}
            onChange={(e) => setMinLength(Number(e.target.value))}
            className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
            placeholder="Min"
          />
        </div>
        <div>
          <label htmlFor="promptgen-max" className="block text-gray-300 text-sm">Max Length</label>
          <input
            id="promptgen-max"
            type="number"
            aria-label="PromptGen maximum length"
            value={maxLength}
            onChange={(e) => setMaxLength(Number(e.target.value))}
            className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
            placeholder="Max"
          />
        </div>
      </div>
      <label className="inline-flex items-center text-gray-300">
        <input type="checkbox" checked={nsfw} onChange={()=>setNsfw(!nsfw)} className="form-checkbox h-4 w-4 text-blue-500" />
        <span className="ml-2">Allow NSFW</span>
      </label>
      <button onClick={handleSave} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
        {status || "Save"}
      </button>
    </section>
  );
};
