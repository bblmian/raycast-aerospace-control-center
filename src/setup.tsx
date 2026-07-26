import {
  Action,
  ActionPanel,
  Icon,
  Keyboard,
  List,
  LocalStorage,
  Toast,
  confirmAlert,
  open,
  openExtensionPreferences,
  popToRoot,
  showToast,
} from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import {
  InstallationInfo,
  CommandResult,
  createDefaultConfig,
  diagnoseInstallation,
  existingConfigPaths,
  findHomebrewBinary,
  installAerospaceWithHomebrew,
  reloadAerospace,
  startAerospace,
} from "./utils/aerospace";
import { coloredIcon, PALETTE } from "./utils/theme";

export const SETUP_COMPLETE_KEY = "aerospace-control-center.setup-complete-v1";

type SetupSnapshot = {
  installation: InstallationInfo;
  brewPath: string | null;
  configPaths: string[];
};

type SetupStep = {
  id: string;
  title: string;
  subtitle: string;
  status: "ready" | "action" | "warning" | "manual";
  markdown: string;
};

async function inspectSetup(): Promise<SetupSnapshot> {
  const [installation, brewPath, configPaths] = await Promise.all([
    diagnoseInstallation(),
    findHomebrewBinary(),
    existingConfigPaths(),
  ]);
  return { installation, brewPath, configPaths };
}

function statusAppearance(status: SetupStep["status"]) {
  switch (status) {
    case "ready":
      return { label: "Ready", icon: Icon.CheckCircle, color: PALETTE.green };
    case "action":
      return { label: "Action Needed", icon: Icon.Circle, color: PALETTE.amber };
    case "warning":
      return { label: "Review", icon: Icon.ExclamationMark, color: PALETTE.coral };
    case "manual":
      return { label: "User Check", icon: Icon.Person, color: PALETTE.indigo };
  }
}

function nextStepAction(steps: SetupStep[], index: number, setSelectedId: (id: string) => void) {
  const next = steps[index + 1];
  return next ? (
    <Action
      title={`Next: ${next.title}`}
      icon={Icon.ArrowDown}
      shortcut={{ modifiers: ["cmd"], key: "return" }}
      onAction={() => setSelectedId(next.id)}
    />
  ) : null;
}

export function SetupWizard({ onExit = popToRoot }: { onExit?: () => void }) {
  const [snapshot, setSnapshot] = useState<SetupSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("welcome");

  const refresh = async () => {
    setLoading(true);
    try {
      setSnapshot(await inspectSetup());
    } catch (error) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Setup Check Failed",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const steps = useMemo<SetupStep[]>(() => {
    if (!snapshot) {
      return [
        {
          id: "welcome",
          title: "Welcome",
          subtitle: "Preparing the setup check…",
          status: "action",
          markdown: "## Aerospace Control Center Setup\n\nChecking this Mac…",
        },
      ];
    }

    const { installation, brewPath, configPaths } = snapshot;
    const installed = Boolean(installation.binaryPath && installation.appPath);
    const configStatus =
      configPaths.length === 1 ? "ready" : configPaths.length > 1 ? "warning" : "action";
    const serviceReady = installation.state === "enabled";
    const versionsMatch =
      Boolean(installation.clientVersion) &&
      Boolean(installation.serverVersion) &&
      installation.clientVersion === installation.serverVersion;
    const completedChecks = [
      installed,
      configPaths.length === 1,
      serviceReady,
      versionsMatch,
    ].filter(Boolean).length;

    return [
      {
        id: "welcome",
        title: "Welcome",
        subtitle: `${completedChecks} of 4 automatic checks ready`,
        status: completedChecks === 4 ? "ready" : "action",
        markdown:
          "## Guided Setup\n\nUse **Return** for the recommended action and **⌘ Return** to move to the next step.\n\nNothing is installed or changed without confirmation.",
      },
      {
        id: "installation",
        title: "AeroSpace Installation",
        subtitle: installed
          ? `${installation.clientVersion || "Installed"} · CLI and application detected`
          : brewPath
            ? "AeroSpace can be installed with Homebrew"
            : "Install Homebrew or use the AeroSpace manual installer",
        status: installed ? "ready" : "action",
        markdown: installed
          ? `## Installation Ready\n\n- CLI: \`${installation.binaryPath}\`\n- App: \`${installation.appPath}\`\n- Homebrew: ${brewPath ? `\`${brewPath}\`` : "Not required"}`
          : `## Installation Required\n\n${
              brewPath
                ? "The extension can run the official Homebrew installation after you confirm."
                : "Homebrew is not installed. Open the installation guide, install AeroSpace, then return and refresh."
            }\n\nOfficial command:\n\n\`\`\`sh\nbrew install --cask nikitabobko/tap/aerospace\n\`\`\``,
      },
      {
        id: "configuration",
        title: "Configuration",
        subtitle:
          configPaths.length === 1
            ? configPaths[0]
            : configPaths.length > 1
              ? `${configPaths.length} configurations found; AeroSpace requires one`
              : installed
                ? "Create the official default configuration"
                : "Install AeroSpace before creating its configuration",
        status: configStatus,
        markdown:
          configPaths.length === 1
            ? `## Configuration Ready\n\nUsing:\n\n\`${configPaths[0]}\`\n\nExisting rules are preserved. Automated repairs never overwrite this file.`
            : configPaths.length > 1
              ? `## Configuration Conflict\n\nAeroSpace searches these locations in order, but reports an ambiguity when both exist:\n\n${configPaths.map((path) => `- \`${path}\``).join("\n")}\n\nChoose which file to keep, back up the other, then refresh this check.`
              : "## Create a Starter Configuration\n\nThe extension can copy `default-config.toml` from the installed AeroSpace app to `~/.aerospace.toml`.\n\nThe operation uses create-only semantics and will never overwrite a file.",
      },
      {
        id: "service",
        title: "Service",
        subtitle:
          installation.state === "enabled"
            ? "AeroSpace is running and managing windows"
            : installation.state === "disabled"
              ? "AeroSpace is paused"
              : "AeroSpace is not running",
        status: serviceReady ? "ready" : "action",
        markdown: `## Service Status\n\nCurrent state: **${installation.state}**\n\nStarting AeroSpace launches the detected application, enables its service, waits for the CLI server, and reloads the active configuration.`,
      },
      {
        id: "compatibility",
        title: "Compatibility",
        subtitle: versionsMatch
          ? `Client and app match · ${installation.clientVersion}`
          : installation.clientVersion && installation.serverVersion
            ? `Client ${installation.clientVersion} · App ${installation.serverVersion}`
            : "Start AeroSpace to compare client and app versions",
        status: versionsMatch ? "ready" : serviceReady ? "warning" : "action",
        markdown: `## Compatibility\n\n- CLI version: **${installation.clientVersion || "Unknown"}**\n- App version: **${installation.serverVersion || "Not running"}**\n\n${
          versionsMatch
            ? "The CLI and running application use the same version."
            : "If versions differ, reinstall AeroSpace with Homebrew and restart the application."
        }`,
      },
      {
        id: "permissions",
        title: "Accessibility Permission",
        subtitle: "Confirm AeroSpace is enabled in macOS Accessibility settings",
        status: "manual",
        markdown:
          "## Accessibility Permission\n\nAeroSpace needs macOS Accessibility permission to manage windows. macOS does not provide a reliable third-party API for reading this permission, so this remains a user-confirmed check.\n\nOpen System Settings and ensure **AeroSpace** is enabled under **Privacy & Security → Accessibility**.",
      },
      {
        id: "finish",
        title: "Finish Setup",
        subtitle:
          completedChecks === 4
            ? "All automatic checks passed"
            : `${4 - completedChecks} automatic check${4 - completedChecks === 1 ? "" : "s"} remaining`,
        status: completedChecks === 4 ? "ready" : "action",
        markdown:
          completedChecks === 4
            ? "## Ready to Go\n\nAeroSpace, its CLI, configuration, service, and versions are ready. Finish setup to open the Control Center."
            : "## Almost There\n\nReturn to the earlier steps marked **Action Needed** or **Review**, complete them, then refresh.",
      },
    ];
  }, [snapshot]);

  const runTask = async (title: string, task: () => Promise<CommandResult>) => {
    const toast = await showToast({ style: Toast.Style.Animated, title });
    try {
      const result = await task();
      toast.style = Toast.Style.Success;
      toast.title = "Done";
      toast.message = result.stdout || result.stderr || title;
      await refresh();
    } catch (error) {
      toast.style = Toast.Style.Failure;
      toast.title = `${title} Failed`;
      toast.message = error instanceof Error ? error.message : String(error);
    }
  };

  const coreReady = snapshot
    ? Boolean(
        snapshot.installation.binaryPath &&
        snapshot.installation.appPath &&
        snapshot.configPaths.length === 1 &&
        snapshot.installation.state === "enabled" &&
        snapshot.installation.clientVersion &&
        snapshot.installation.clientVersion === snapshot.installation.serverVersion,
      )
    : false;

  return (
    <List
      isLoading={loading}
      isShowingDetail
      navigationTitle="AeroSpace Setup & Repair"
      searchBarPlaceholder="Search setup steps…"
      selectedItemId={selectedId}
      onSelectionChange={(id) => id && setSelectedId(id)}
    >
      <List.Section title="Guided Setup" subtitle="Follow the steps from top to bottom">
        {steps.map((step, index) => {
          const appearance = statusAppearance(step.status);
          const isInstallStep = step.id === "installation";
          const isConfigStep = step.id === "configuration";
          const isServiceStep = step.id === "service";
          const isCompatibilityStep = step.id === "compatibility";
          const isPermissionsStep = step.id === "permissions";
          const isFinishStep = step.id === "finish";

          return (
            <List.Item
              key={step.id}
              id={step.id}
              icon={coloredIcon(appearance.icon, appearance.color)}
              title={`${index + 1}. ${step.title}`}
              subtitle={step.subtitle}
              accessories={[{ tag: { value: appearance.label, color: appearance.color } }]}
              detail={<List.Item.Detail markdown={step.markdown} />}
              actions={
                <ActionPanel>
                  {isInstallStep &&
                  (!snapshot?.installation.appPath || !snapshot.installation.binaryPath) ? (
                    snapshot?.brewPath ? (
                      <Action
                        title={
                          snapshot.installation.appPath || snapshot.installation.binaryPath
                            ? "Repair AeroSpace with Homebrew"
                            : "Install AeroSpace with Homebrew"
                        }
                        icon={Icon.Download}
                        onAction={async () => {
                          const repair = Boolean(
                            snapshot.installation.appPath || snapshot.installation.binaryPath,
                          );
                          const confirmed = await confirmAlert({
                            title: repair ? "Repair AeroSpace?" : "Install AeroSpace?",
                            message: `This runs: brew ${
                              repair ? "reinstall" : "install"
                            } --cask nikitabobko/tap/aerospace`,
                            primaryAction: { title: repair ? "Repair" : "Install" },
                          });
                          if (confirmed)
                            await runTask(repair ? "Repair AeroSpace" : "Install AeroSpace", () =>
                              installAerospaceWithHomebrew(repair),
                            );
                        }}
                      />
                    ) : (
                      <Action.OpenInBrowser
                        title="Open Homebrew Installation"
                        url="https://brew.sh/"
                        icon={Icon.Globe}
                      />
                    )
                  ) : null}
                  {isConfigStep &&
                  snapshot?.configPaths.length === 0 &&
                  snapshot.installation.appPath ? (
                    <Action
                      title="Create Official Default Configuration"
                      icon={Icon.Document}
                      onAction={async () => {
                        const confirmed = await confirmAlert({
                          title: "Create ~/.aerospace.toml?",
                          message:
                            "The file will be copied from AeroSpace.app. Existing files are never overwritten.",
                          primaryAction: { title: "Create Configuration" },
                        });
                        if (confirmed) await runTask("Create Configuration", createDefaultConfig);
                      }}
                    />
                  ) : null}
                  {isConfigStep && snapshot?.configPaths.length ? (
                    <>
                      {snapshot.configPaths.map((path) => (
                        <Action.Open
                          key={path}
                          title={`Open ${path.split("/").pop()}`}
                          target={path}
                          icon={Icon.Document}
                        />
                      ))}
                      <Action
                        title="Validate and Reload Configuration"
                        icon={Icon.RotateClockwise}
                        onAction={() => runTask("Reload Configuration", reloadAerospace)}
                      />
                    </>
                  ) : null}
                  {isServiceStep && snapshot?.installation.state !== "enabled" ? (
                    <Action
                      title="Start and Enable AeroSpace"
                      icon={Icon.Play}
                      onAction={() => runTask("Start AeroSpace", startAerospace)}
                    />
                  ) : null}
                  {isCompatibilityStep &&
                  snapshot?.brewPath &&
                  snapshot.installation.clientVersion &&
                  snapshot.installation.serverVersion &&
                  snapshot.installation.clientVersion !== snapshot.installation.serverVersion ? (
                    <Action
                      title="Repair with Homebrew"
                      icon={Icon.WrenchScrewdriver}
                      onAction={async () => {
                        const confirmed = await confirmAlert({
                          title: "Repair AeroSpace?",
                          message:
                            "This runs the official Homebrew installation and may update AeroSpace.",
                          primaryAction: { title: "Repair" },
                        });
                        if (confirmed)
                          await runTask("Repair AeroSpace", () =>
                            installAerospaceWithHomebrew(true),
                          );
                      }}
                    />
                  ) : null}
                  {isPermissionsStep ? (
                    <Action
                      title="Open Accessibility Settings"
                      icon={Icon.Gear}
                      onAction={() =>
                        open(
                          "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
                        )
                      }
                    />
                  ) : null}
                  {isFinishStep && coreReady ? (
                    <Action
                      title="Finish Setup"
                      icon={Icon.CheckCircle}
                      onAction={async () => {
                        await LocalStorage.setItem(SETUP_COMPLETE_KEY, "true");
                        await showToast({
                          style: Toast.Style.Success,
                          title: "AeroSpace Control Center Is Ready",
                        });
                        onExit();
                      }}
                    />
                  ) : null}
                  {!isFinishStep ? nextStepAction(steps, index, setSelectedId) : null}
                  <Action
                    title="Refresh All Checks"
                    icon={Icon.RotateClockwise}
                    shortcut={Keyboard.Shortcut.Common.Refresh}
                    onAction={refresh}
                  />
                  <Action.OpenInBrowser
                    title="Open AeroSpace Installation Guide"
                    url="https://nikitabobko.github.io/AeroSpace/guide#installation"
                  />
                  <Action
                    title="Open Extension Preferences"
                    icon={Icon.Gear}
                    onAction={openExtensionPreferences}
                  />
                  <Action title="Skip for Now" icon={Icon.ArrowLeft} onAction={onExit} />
                </ActionPanel>
              }
            />
          );
        })}
      </List.Section>
    </List>
  );
}

export default function SetupCommand() {
  return <SetupWizard />;
}
