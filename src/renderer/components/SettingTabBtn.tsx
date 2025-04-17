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
  const className = `tab flex-1 transition-all duration-200 rounded-md font-medium text-sm flex items-center justify-center gap-1 py-1 ${
    active
      ? "bg-blue-600 text-white shadow-md"
      : "text-gray-300 hover:bg-gray-600 hover:text-gray-100"
  }`;

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
      <span>{label}</span>
    </button>
  );
};
