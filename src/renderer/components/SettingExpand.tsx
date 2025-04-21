import React, { useState, useEffect } from "react";

export const SettingExpand: React.FC = () => {
  const [minLength, setMinLength] = useState(0);
  const [maxLength, setMaxLength] = useState(0);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    window.electronAPI.getExpandSettings().then((settings) => {
      setMinLength(settings.minLength);
      setMaxLength(settings.maxLength);
    });
  }, []);

  const handleSave = async () => {
    const result = await window.electronAPI.setExpandSettings({ minLength, maxLength });
    if (result.success) { setStatus("Saved!"); setTimeout(() => setStatus(""), 2000); }
    else { setStatus("Error"); }
  };

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-lg font-medium text-gray-300">Expand Settings</h3>
      <div className="flex gap-2">
        <div>
          <label htmlFor="expand-min" className="block text-gray-300 text-sm">Min Length</label>
          <input
            id="expand-min"
            type="number"
            aria-label="Expand minimum length"
            value={minLength}
            onChange={(e) => setMinLength(Number(e.target.value))}
            className="w-20 p-1 bg-gray-700 border border-gray-600 rounded text-gray-100"
            placeholder="Min"
          />
        </div>
        <div>
          <label htmlFor="expand-max" className="block text-gray-300 text-sm">Max Length</label>
          <input
            id="expand-max"
            type="number"
            aria-label="Expand maximum length"
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
