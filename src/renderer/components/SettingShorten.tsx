import React, { useState, useEffect } from "react";

export const SettingShorten: React.FC = () => {
  const [minLength, setMinLength] = useState(0);
  const [maxLength, setMaxLength] = useState(0);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    window.electronAPI.getShortenSettings().then((settings) => {
      setMinLength(settings.minLength);
      setMaxLength(settings.maxLength);
    });
  }, []);

  const handleSave = async () => {
    const result = await window.electronAPI.setShortenSettings({ minLength, maxLength });
    if (result.success) { setStatus("Saved!"); setTimeout(() => setStatus(""), 2000); }
    else { setStatus("Error"); }
  };

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-lg font-medium text-gray-300">Shorten Settings</h3>
      <div className="flex gap-2">
        <div>
          <label htmlFor="shorten-min" className="block text-gray-300 text-sm">Min Length</label>
          <input
            id="shorten-min"
            type="number"
            aria-label="Shorten minimum length"
            value={minLength}
            onChange={(e) => setMinLength(Number(e.target.value))}
            className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
            placeholder="Min"
          />
        </div>
        <div>
          <label htmlFor="shorten-max" className="block text-gray-300 text-sm">Max Length</label>
          <input
            id="shorten-max"
            type="number"
            aria-label="Shorten maximum length"
            value={maxLength}
            onChange={(e) => setMaxLength(Number(e.target.value))}
            className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
            placeholder="Max"
          />
        </div>
      </div>
      <button onClick={handleSave} className="px-3 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
        {status || "Save"}
      </button>
    </section>
  );
};
