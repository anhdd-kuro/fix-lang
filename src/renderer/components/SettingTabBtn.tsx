import { twJoin } from "tailwind-merge";

export type SettingTabBtnProps = {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  ariaControls: string;
  tabIndex: number;
  id: string;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

export const SettingTabBtn = ({
  icon,
  label,
  active,
  ariaControls,
  tabIndex,
  id,
  onClick,
}: SettingTabBtnProps) => {
  const className = twJoin(
    `tab transition-all duration-200 rounded-md font-medium text-sm flex items-center justify-center gap-1 py-1 min-w-min`,
    active
      ? "bg-primary text-primary-foreground shadow-md"
      : "text-card-foreground hover:bg-secondary hover:text-foreground bg-muted/50"
  );

  return (
    <button
      role="tab"
      aria-selected={active ? "true" : "false"}
      aria-controls={ariaControls}
      tabIndex={tabIndex}
      className={className}
      onClick={onClick}
      type="button"
      id={id}
    >
      {icon}
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
};
