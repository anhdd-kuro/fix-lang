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
    <div className="flex gap-2 text-sm text-label-secondary">
      <span>{label}:</span>
      <ul className="inline-flex gap-1">
        {keysBinding.map((key, index) => (
          <li
            key={index}
            className="inline-block px-2 py-1.5 text-xs font-semibold text-label-primary bg-separator/20 border border-separator/40 rounded-lg"
          >
            {key}
          </li>
        ))}
      </ul>
      {/* TODO: Add functionality to change key bindings */}
      <button
        type="button"
        className="ml-auto px-2 py-1.5 text-xs font-semibold bg-accent text-label-primary rounded-lg"
        onClick={() => onChange([])}
      >
        Change
      </button>
    </div>
  );
};
