import { useId } from "react";
import CopyButton from "./CopyButton";
import { useI18n } from "../i18n/useI18n";

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
  const { t } = useI18n();

  return (
    <div className={`relative flex flex-col text-xs md:text-base ${className}`}>
      <div className="flex justify-between items-center">
        <label htmlFor={id} className="block text-muted-foreground mb-1 font-bold">
          {label}
        </label>
        <CopyButton value={value} label={t("common.textAreaBox.copyResultText")} />
      </div>
      <textarea
        id={id}
        rows={rows ?? 4}
        className="w-full flex-1 mt-2 p-2 bg-card border border-card-control-border rounded text-foreground resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={placeholder}
        value={value}
        readOnly={readOnly}
        aria-label={label}
        onChange={(e) => onChange?.(e.target.value)}
      />
      <div className="flex justify-between items-center text-xs text-muted-foreground">
        {model && <p>{t("common.modelLabel", { model })}</p>}

        {/* Prompt token count display for original text */}
        <TextCount
          textOrCount={textCount}
          className="text-shadow-white ml-auto"
          aria-live="polite"
          aria-label={t("common.textAreaBox.promptTokensAriaLabel")}
          titleAttribute={t("common.textAreaBox.promptTokensTitle")}
        />
      </div>
    </div>
  );
};

const TextCount = ({
  textOrCount,
  className,
  label,
  titleAttribute,
}: {
  textOrCount: string | number | null | undefined;
  className?: string;
  label?: string;
  titleAttribute?: string;
}) => {
  const { t } = useI18n();
  const resolvedLabel = label ?? t("common.textAreaBox.tokensUsedLabel");

  return (
    <span
      className={`text-xs text-muted-foreground p-1 rounded cursor-help ${className}`}
      aria-live="polite"
      aria-label={t("common.textAreaBox.textLengthAriaLabel")}
      title={titleAttribute}
    >
      {resolvedLabel}{" "}
      {typeof textOrCount === "number" ? textOrCount : textOrCount?.length || 0}
    </span>
  );
};
