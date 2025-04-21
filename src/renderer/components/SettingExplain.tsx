import React, { useState, useEffect } from "react";

export const SettingExplain: React.FC = () => {
  const [level, setLevel] = useState<string>("Beginner");
  const [includeResources, setIncludeResources] = useState<boolean>(false);
  const [status, setStatus] = useState<string>("");

  useEffect(() => {
    window.electronAPI.getExplainSettings().then((settings) => {
      setLevel(settings.level);
      setIncludeResources(settings.includeResources);
    });
  }, []);

  const handleSave = async () => {
    const result = await window.electronAPI.setExplainSettings({ level, includeResources });
    if (result.success) {
      setStatus("Saved!");
      setTimeout(() => setStatus(""), 2000);
    } else {
      setStatus("Error saving settings");
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-lg font-medium text-gray-300">Explain Settings</h3>
      <div className="flex flex-col gap-2">
        <label htmlFor="explain-level" className="text-gray-300 text-sm">Response Level</label>
        <select
          id="explain-level"
          title="Select response level"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          className="w-full p-2 bg-gray-700 border border-gray-600 rounded text-gray-100"
        >
          <option>Expert</option>
          <option>Professional</option>
          <option>Casual</option>
          <option>Beginner</option>
          <option>Child</option>
        </select>
      </div>
      <label className="inline-flex items-center text-gray-300">
        <input
          type="checkbox"
          checked={includeResources}
          onChange={() => setIncludeResources(!includeResources)}
          className="form-checkbox h-4 w-4 text-blue-500"
        />
        <span className="ml-2">Include Resources</span>
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
