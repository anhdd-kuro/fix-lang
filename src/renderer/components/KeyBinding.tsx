export const KeyBinding = ({
  label,
  keysBinding,
  onChange,
}: {
  label: string;
  keysBinding: string[];
  onChange: (keysBinding: string[]) => void;
}) => {
  return (
    <div className="flex gap-2 text-sm text-gray-400">
      <span>{label}:</span>
      <ul className="inline-flex gap-1">
        {keysBinding.map((key, index) => (
          <li
            key={index}
            className="inline-block px-2 py-1.5 text-xs font-semibold text-gray-800 bg-gray-100 border border-gray-200 rounded-lg"
          >
            {key}
          </li>
        ))}
      </ul>
      {/* TODO: Add functionality to change key bindings */}
      <button
        type="button"
        className="ml-auto px-2 py-1.5 text-xs font-semibold bg-blue-500 text-white rounded-lg"
        onClick={() => onChange([])}
      >
        Change
      </button>
    </div>
  );
};
