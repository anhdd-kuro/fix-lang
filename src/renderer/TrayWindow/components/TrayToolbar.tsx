import React, { useState } from "react";
import { twJoin } from "tailwind-merge";
import { SettingsButton } from "../../components/SettingsIcon";
import { Spinner } from "../../components/Spinner";
import { useI18n } from "../../i18n/useI18n";

type TrayIconButtonProps = {
  onClick: () => void;
  title: string;
  ariaLabel: string;
  disabled?: boolean;
  children: React.ReactNode;
};

const TrayIconButton: React.FC<TrayIconButtonProps> = ({
  onClick,
  title,
  ariaLabel,
  disabled = false,
  children,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={ariaLabel}
    className={twJoin(
      "text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2",
      "focus:ring-ring rounded-md p-1.5 cursor-pointer",
      "disabled:cursor-not-allowed disabled:opacity-50"
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

const UpdateIcon: React.FC<{ className?: string }> = ({ className }) => (
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
      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"
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
  const { t } = useI18n();
  const [checkingForUpdates, setCheckingForUpdates] = useState(false);

  const handleQuit = async (): Promise<void> => {
    const { response } = await window.electronAPI.showMessageBox({
      type: "question",
      buttons: [t("common.cancel"), t("tray.toolbar.quitConfirm.confirmButton")],
      defaultId: 0,
      cancelId: 0,
      message: t("tray.toolbar.quitConfirm.message"),
      detail: t("tray.toolbar.quitConfirm.detail"),
    });
    if (response === 1) {
      window.electronAPI.quitApp();
    }
  };

  // Checks for updates and surfaces the result via a native message box —
  // never opens the main window or navigates tabs (tray stays lightweight).
  const handleCheckForUpdates = async (): Promise<void> => {
    if (checkingForUpdates) return;

    setCheckingForUpdates(true);
    try {
      const state = await window.electronAPI.checkForUpdates();

      switch (state.phase) {
        case "up-to-date":
          await window.electronAPI.showMessageBox({
            type: "info",
            buttons: [t("common.ok")],
            defaultId: 0,
            cancelId: 0,
            message: t("tray.toolbar.updateCheck.upToDate", {
              version: state.currentVersion,
            }),
          });
          break;

        case "available": {
          const availableVersion = state.availableVersion ?? t("common.unknown");
          const { response } = await window.electronAPI.showMessageBox({
            type: "info",
            buttons: [t("tray.toolbar.updateCheck.viewRelease"), t("common.close")],
            defaultId: 0,
            cancelId: 1,
            message: t("tray.toolbar.updateCheck.available", {
              availableVersion,
              currentVersion: state.currentVersion,
            }),
          });
          if (response === 0) {
            window.electronAPI.openUpdateRelease();
          }
          break;
        }

        case "error":
          await window.electronAPI.showMessageBox({
            type: "error",
            buttons: [t("common.ok")],
            defaultId: 0,
            cancelId: 0,
            message: t("tray.toolbar.updateCheck.failed", {
              reason: state.message ?? t("tray.toolbar.updateCheck.genericFailure"),
            }),
          });
          break;

        case "unsupported":
          await window.electronAPI.showMessageBox({
            type: "info",
            buttons: [t("common.ok")],
            defaultId: 0,
            cancelId: 0,
            message: t("tray.toolbar.updateCheck.unsupported"),
          });
          break;

        // "checking"/"idle" should not be the resolved state; no dialog to show.
        case "checking":
        case "idle":
          break;
      }
    } catch {
      // IPC-layer rejection (e.g. preload validation throwing on a malformed
      // update state) — surface the same generic failure as the error phase
      // rather than letting this become an unhandled rejection.
      await window.electronAPI.showMessageBox({
        type: "error",
        buttons: [t("common.ok")],
        defaultId: 0,
        cancelId: 0,
        message: t("tray.toolbar.updateCheck.failed", {
          reason: t("tray.toolbar.updateCheck.genericFailure"),
        }),
      });
    } finally {
      setCheckingForUpdates(false);
    }
  };

  return (
    <div className="flex items-center justify-end gap-4 mb-3">
      <TrayIconButton
        onClick={openDashboard}
        title={t("tray.toolbar.openDashboard")}
        ariaLabel={t("tray.toolbar.openDashboard")}
      >
        <DashboardIcon />
      </TrayIconButton>
      <TrayIconButton
        onClick={() => {
          void handleCheckForUpdates();
        }}
        title={
          checkingForUpdates
            ? t("tray.toolbar.checkingForUpdates")
            : t("tray.toolbar.checkForUpdates")
        }
        ariaLabel={t("tray.toolbar.checkForUpdates")}
        disabled={checkingForUpdates}
      >
        {checkingForUpdates ? (
          <Spinner className="size-5 text-foreground" />
        ) : (
          <UpdateIcon />
        )}
      </TrayIconButton>
      <SettingsButton
        onClick={() => window.electronAPI.showMainWindowSettings()}
        className="text-muted-foreground hover:text-foreground p-1.5"
        iconClassName="size-5"
        title={t("tray.toolbar.openSettings")}
      />
      <TrayIconButton
        onClick={() => window.electronAPI.restartApp()}
        title={t("tray.toolbar.restartApp")}
        ariaLabel={t("tray.toolbar.restartApp")}
      >
        <RestartIcon />
      </TrayIconButton>
      <TrayIconButton
        onClick={() => {
          void handleQuit();
        }}
        title={t("tray.toolbar.quitApp")}
        ariaLabel={t("tray.toolbar.quitApp")}
      >
        <QuitIcon />
      </TrayIconButton>
    </div>
  );
};
