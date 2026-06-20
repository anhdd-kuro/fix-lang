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
  model,
}: {
  label: string;
  value: string;
  textCount?: number | null;
  onChange?: (value: string) => void;
  className?: string;
  placeholder?: string;
  rows?: number;
  readOnly?: boolean;
  model?: string;
}) => {
  const id = useId();

  return (
    <div className={`relative flex flex-col text-[0.846rem] ${className}`}>
      <div className="flex justify-between items-center">
        <label htmlFor={id} className="block text-label-secondary mb-1 font-medium">
          {label}
        </label>
        <CopyButton value={value} label="Copy result text" />
      </div>
      <textarea
        id={id}
        rows={rows ?? 4}
        className="w-full flex-1 mt-2 p-2 bg-control border border-separator/60 rounded-[6px] text-label-primary resize-none focus-visible:outline-none"
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        aria-label={label}
        onChange={(e) => onChange?.(e.target.value)}
      />
      <div className="flex justify-between items-center text-[0.769rem] text-label-secondary">
        {model && <p>Model: {model}</p>}

        {/* Prompt token count display for original text */}
        <TextCount
          textOrCount={textCount}
          className="ml-auto"
          aria-live="polite"
          aria-label="Prompt tokens for original text"
          titleAttribute="Input + Prompt tokens"
        />
      </div>
    </div>
  );
};

const TextCount = ({
  textOrCount,
  className,
  label = "Tokens used:",
  titleAttribute,
}: {
  textOrCount: string | number | null | undefined;
  className?: string;
  label?: string;
  titleAttribute?: string;
}) => {
  return (
    <span
      className={`text-[0.769rem] text-label-secondary p-1 rounded cursor-help ${className}`}
      aria-live="polite"
      aria-label="Text length"
      title={titleAttribute}
    >
      {label}{" "}
      {typeof textOrCount === "number" ? textOrCount : textOrCount?.length || 0}
    </span>
  );
};
