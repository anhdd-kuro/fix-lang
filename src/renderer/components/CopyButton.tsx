import React from "react";
import { twJoin } from "tailwind-merge";

const CopyButton: React.FC<{
  value: string;
  label: string;
  className?: string;
  showLabel?: boolean;
}> = ({ value, label, className = "", showLabel = false }) => {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  const positionClass = className.includes("absolute") ? "" : "relative";

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={label}
      title={label}
      className={`${className} cursor-pointer ${positionClass} min-w-6 min-h-6`}
    >
      {showLabel && (
        <span className="whitespace-nowrap mr-8 text-xs">{label}</span>
      )}
      <ClipboardIcon
        className={twJoin(
          "stroke-label-secondary transition-all duration-300 ease-in-out absolute top-0 right-0 size-6"
        )}
        style={{
          strokeDasharray: 50,
          strokeDashoffset: copied ? -50 : 0,
        }}
      />
      <CheckIcon
        className={twJoin(
          "stroke-accent transition-all duration-300 ease-in-out absolute top-0 right-0 size-6"
        )}
        style={{
          strokeDasharray: 50,
          strokeDashoffset: copied ? 0 : -50,
        }}
      />
    </button>
  );
};

export default CopyButton;

const ClipboardIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M5.75 4.75H10.25V1.75H5.75V4.75Z" />
      <path d="M3.25 2.88379C2.9511 3.05669 2.75 3.37987 2.75 3.75001V13.25C2.75 13.8023 3.19772 14.25 3.75 14.25H12.25C12.8023 14.25 13.25 13.8023 13.25 13.25V3.75001C13.25 3.37987 13.0489 3.05669 12.75 2.88379" />
    </svg>
  );
};

const CheckIcon = (props: React.SVGProps<SVGSVGElement>) => {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M13.25 4.75L6 12L2.75 8.75" />
    </svg>
  );
};
