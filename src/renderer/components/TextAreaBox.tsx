import { useId } from "react";
import CopyButton from "./CopyButton";

export const TextAreaBox = ({
  label,
  value,
  onChange,
  textCount,
  className,
  placeholder,
  rows,
  readOnly,
}: {
  label: string;
  value: string;
  textCount?: number | null;
  onChange?: (value: string) => void;
  className?: string;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
}) => {
  const id = useId();

  return (
    <div className={`relative flex flex-col ${className}`}>
      <div className="flex justify-between items-center">
        <label htmlFor={id} className="block text-gray-400 mb-2 font-bold">
          {label}
        </label>
        <CopyButton value={value} label="Copy result text" />
      </div>
      <textarea
        id={id}
        rows={rows ?? 8}
        className={`w-full flex-1 mt-4 pt-2 px-2 pb-4 bg-gray-800 border border-gray-700 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500 text-gray-100 resize-none`}
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        aria-label={label}
        onChange={(e) => onChange?.(e.target.value)}
      />
      {/* Prompt token count display for original text */}
      {textCount && (
        <TextCount
          textOrCount={textCount}
          className="absolute bottom-0 right-0"
          aria-live="polite"
          aria-label="Prompt tokens for original text"
          titleAttribute="Input + Prompt tokens"
        />
      )}
    </div>
  );
};

const TextCount = ({
  textOrCount,
  className,
  label = "Tokens used:",
  titleAttribute,
}: {
  textOrCount: string | number | null;
  className?: string;
  label?: string;
  titleAttribute?: string;
}) => {
  if (textOrCount === null) {
    return null;
  }

  return (
    <span
      className={`text-xs text-gray-400 p-2 rounded-md cursor-help ${className}`}
      aria-live="polite"
      aria-label="Text length"
      title={titleAttribute}
    >
      {label}{" "}
      {typeof textOrCount === "number" ? textOrCount : textOrCount.length}
    </span>
  );
};
