import React from "react";
import { twJoin } from "tailwind-merge";
import { SettingsButton } from "../../components/SettingsIcon";

type TrayIconButtonProps = {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  children: React.ReactNode;
};

const TrayIconButton: React.FC<TrayIconButtonProps> = ({
  onClick,
  title,
  ariaLabel,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    aria-label={ariaLabel}
    className={twJoin(
      "text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2",
      "focus:ring-ring rounded-md p-1.5 cursor-pointer"
    )}
  >
    {children}
  </button>
);

const RestartIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={twJoin("size-5", className)}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const QuitIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={twJoin("size-5", className)}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
    />
  </svg>
);

const DashboardIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={twJoin("size-5", className)}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z"
    />
  </svg>
);

const openDashboard = (): void => {
  window.electronAPI.hideTray();
  window.electronAPI.showMainWindowTab("overview");
};

export const TrayToolbar: React.FC = () => {
  const handleQuit = async (): Promise<void> => {
    const { response } = await window.electronAPI.showMessageBox({
      type: "question",
      buttons: ["Cancel", "Quit"],
      defaultId: 0,
      cancelId: 0,
      message: "Quit FixLang?",
      detail: "The application will close.",
    });
    if (response === 1) {
      window.electronAPI.quitApp();
    }
  };

  return (
    <div className="flex items-center justify-end gap-4 mb-3">
      <TrayIconButton
        onClick={openDashboard}
        title="Open dashboard"
        ariaLabel="Open dashboard"
      >
        <DashboardIcon />
      </TrayIconButton>
      <SettingsButton
        onClick={() => window.electronAPI.showMainWindowSettings()}
        className="text-muted-foreground hover:text-foreground p-1.5"
        iconClassName="size-5"
      />
      <TrayIconButton
        onClick={() => window.electronAPI.restartApp()}
        title="Restart application"
        ariaLabel="Restart application"
      >
        <RestartIcon />
      </TrayIconButton>
      <TrayIconButton
        onClick={() => {
          void handleQuit();
        }}
        title="Quit application"
        ariaLabel="Quit application"
      >
        <QuitIcon />
      </TrayIconButton>
    </div>
  );
};
