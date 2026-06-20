import React from "react";
import { twJoin } from "tailwind-merge";

// ---------- SettingsButton Component ----------
type SettingsButtonProps = {
  className?: string;
  iconClassName?: string;
  onClick?: () => void;
  title?: string;
};

/**
 * Shared settings button component that uses the GearIcon
 * Provides a consistent button wrapper with appropriate aria labels and styling
 */
export const SettingsButton: React.FC<SettingsButtonProps> = ({
  className = "",
  iconClassName = "size-6",
  onClick,
  title = "Open settings",
}) => (
  <button
    type="button"
    onClick={onClick}
    className={twJoin(
      "text-label-secondary hover:text-label-primary focus-visible:outline-none rounded-[6px] cursor-pointer transition-colors",
      className
    )}
    aria-label={title}
    title={title}
  >
    <GearIcon className={iconClassName} />
  </button>
);

export default SettingsButton;

// ---------- GearIcon Component ----------
type GearIconProps = {
  className?: string;
};

/**
 * Gear/Settings SVG icon component
 * Provides just the SVG icon without any container or click handlers
 */
export const GearIcon: React.FC<GearIconProps> = ({ className }) => (
  <svg
    className={twJoin("size-6", className)}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
    />
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
    />
  </svg>
);
