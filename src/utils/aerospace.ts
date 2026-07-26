import { getApplications, getPreferenceValues } from "@raycast/api";
import { constants } from "fs";
import { access, copyFile, mkdir, readFile, readdir } from "fs/promises";
import { homedir } from "os";
import { basename, delimiter, dirname, join, resolve } from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export type CommandResult = { stdout: string; stderr: string };
export type ServiceState = "enabled" | "disabled" | "stopped" | "not-installed";
export type WorkspaceInfo = {
  workspace: string;
  "monitor-id": number;
  "monitor-name": string;
  "workspace-is-focused": boolean;
  "workspace-is-visible": boolean;
};
export type WindowInfo = {
  "window-id": number;
  "app-name": string;
  "app-bundle-id": string;
  "window-title": string;
  workspace: string;
  "monitor-id": number;
  "monitor-name": string;
  "window-layout": string;
};
export type MonitorInfo = {
  "monitor-id": number;
  "monitor-name": string;
  "monitor-appkit-nsscreen-screens-id": number;
  "monitor-is-main": boolean;
};

const WORKSPACE_LIST_FORMAT =
  "%{workspace} %{monitor-id} %{monitor-name} %{workspace-is-focused} %{workspace-is-visible}";
const WINDOW_LIST_FORMAT =
  "%{window-id} %{app-name} %{app-bundle-id} %{window-title} %{workspace} %{monitor-id} %{monitor-name} %{window-layout}";
const MONITOR_LIST_FORMAT =
  "%{monitor-id} %{monitor-name} %{monitor-appkit-nsscreen-screens-id} %{monitor-is-main}";

type Preferences = {
  aerospaceBinaryPath?: string;
  aerospaceAppPath?: string;
  aerospaceConfigPath?: string;
};

export type InstallationInfo = {
  binaryPath: string | null;
  appPath: string | null;
  configPath: string | null;
  clientVersion: string | null;
  serverVersion: string | null;
  state: ServiceState;
  issues: string[];
};

let binaryCache: string | null | undefined;
let appCache: string | null | undefined;
let configCache: string | null | undefined;

function preferences(): Preferences {
  return getPreferenceValues<Preferences>();
}

export function expandPath(input: string): string {
  const trimmed = input.trim();
  if (trimmed === "~") return homedir();
  if (trimmed.startsWith("~/")) return join(homedir(), trimmed.slice(2));
  return resolve(trimmed);
}

async function canExecute(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function isReadable(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function caskBinaryCandidates(): Promise<string[]> {
  const root = "/opt/homebrew/Caskroom/aerospace";
  try {
    const versions = await readdir(root);
    return versions
      .sort()
      .reverse()
      .map((version) => join(root, version, `AeroSpace-v${version}`, "bin", "aerospace"));
  } catch {
    return [];
  }
}

export async function findAerospaceBinary(refresh = false): Promise<string | null> {
  if (!refresh && binaryCache !== undefined) return binaryCache;

  const configured = preferences().aerospaceBinaryPath?.trim();
  const pathCandidates = (process.env.PATH || "")
    .split(delimiter)
    .filter(Boolean)
    .map((path) => join(path, "aerospace"));
  const candidates = [
    ...(configured ? [expandPath(configured)] : []),
    ...pathCandidates,
    "/opt/homebrew/bin/aerospace",
    "/usr/local/bin/aerospace",
    join(homedir(), ".local", "bin", "aerospace"),
    join(homedir(), "bin", "aerospace"),
    ...(await caskBinaryCandidates()),
  ];

  for (const candidate of [...new Set(candidates)]) {
    if (await canExecute(candidate)) {
      binaryCache = candidate;
      return candidate;
    }
  }
  binaryCache = null;
  return null;
}

export async function findHomebrewBinary(): Promise<string | null> {
  const pathCandidates = (process.env.PATH || "")
    .split(delimiter)
    .filter(Boolean)
    .map((path) => join(path, "brew"));
  for (const candidate of [...pathCandidates, "/opt/homebrew/bin/brew", "/usr/local/bin/brew"]) {
    if (await canExecute(candidate)) return candidate;
  }
  return null;
}

export async function findAerospaceApp(refresh = false): Promise<string | null> {
  if (!refresh && appCache !== undefined) return appCache;

  const configured = preferences().aerospaceAppPath?.trim();
  const candidates = [
    ...(configured ? [expandPath(configured)] : []),
    "/Applications/AeroSpace.app",
    join(homedir(), "Applications", "AeroSpace.app"),
  ];
  for (const candidate of candidates) {
    if (await isReadable(join(candidate, "Contents", "Info.plist"))) {
      appCache = candidate;
      return candidate;
    }
  }

  const application = (await getApplications()).find(
    (candidate) => candidate.bundleId === "bobko.aerospace",
  );
  if (application?.path) {
    appCache = application.path;
    return application.path;
  }

  appCache = null;
  return null;
}

export async function aerospace(args: string[]): Promise<CommandResult> {
  const binary = await findAerospaceBinary();
  if (!binary) {
    throw new Error(
      "AeroSpace CLI was not found. Install AeroSpace with Homebrew or set the CLI path in extension preferences.",
    );
  }
  const { stdout, stderr } = await execFileAsync(binary, args, {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function installAerospaceWithHomebrew(reinstall = false): Promise<CommandResult> {
  const brew = await findHomebrewBinary();
  if (!brew) {
    throw new Error(
      "Homebrew was not found. Install Homebrew first, then return to Setup & Repair.",
    );
  }
  const { stdout, stderr } = await execFileAsync(
    brew,
    [reinstall ? "reinstall" : "install", "--cask", "nikitabobko/tap/aerospace"],
    {
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    },
  );
  binaryCache = undefined;
  appCache = undefined;
  configCache = undefined;
  return { stdout: stdout.trim(), stderr: stderr.trim() };
}

export async function existingConfigPaths(): Promise<string[]> {
  const configured = preferences().aerospaceConfigPath?.trim();
  const xdgRoot = process.env.XDG_CONFIG_HOME?.trim()
    ? expandPath(process.env.XDG_CONFIG_HOME)
    : join(homedir(), ".config");
  const candidates = [
    ...(configured ? [expandPath(configured)] : []),
    join(homedir(), ".aerospace.toml"),
    join(xdgRoot, "aerospace", "aerospace.toml"),
  ];
  const existing: string[] = [];
  for (const candidate of [...new Set(candidates)]) {
    if (await isReadable(candidate)) existing.push(candidate);
  }
  return existing;
}

export async function createDefaultConfig(): Promise<CommandResult> {
  const existing = await existingConfigPaths();
  if (existing.length > 0) {
    return { stdout: `Configuration already exists at ${existing[0]}`, stderr: "" };
  }
  const app = await findAerospaceApp(true);
  if (!app) throw new Error("AeroSpace.app is required before creating its default configuration.");

  const source = join(app, "Contents", "Resources", "default-config.toml");
  if (!(await isReadable(source))) {
    throw new Error(`The installed AeroSpace app does not contain ${source}.`);
  }
  const destination = join(homedir(), ".aerospace.toml");
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination, constants.COPYFILE_EXCL);
  configCache = destination;
  return { stdout: `Created ${destination} from AeroSpace's official default config.`, stderr: "" };
}

export async function jsonCommand<T>(args: string[]): Promise<T> {
  const { stdout } = await aerospace(args);
  return JSON.parse(stdout) as T;
}

export function listWorkspaces(): Promise<WorkspaceInfo[]> {
  return jsonCommand<WorkspaceInfo[]>([
    "list-workspaces",
    "--all",
    "--json",
    "--format",
    WORKSPACE_LIST_FORMAT,
  ]);
}

export function listWindows(): Promise<WindowInfo[]> {
  return jsonCommand<WindowInfo[]>([
    "list-windows",
    "--all",
    "--json",
    "--format",
    WINDOW_LIST_FORMAT,
  ]);
}

export function listMonitors(): Promise<MonitorInfo[]> {
  return jsonCommand<MonitorInfo[]>(["list-monitors", "--json", "--format", MONITOR_LIST_FORMAT]);
}

export async function getServiceState(): Promise<ServiceState> {
  if (!(await findAerospaceBinary())) return "not-installed";
  try {
    await aerospace(["list-workspaces", "--all"]);
    return "enabled";
  } catch (error) {
    return errorMessage(error).includes("server is disabled") ? "disabled" : "stopped";
  }
}

export async function getServiceSummary(): Promise<{
  state: ServiceState;
  label: string;
}> {
  const state = await getServiceState();
  return {
    state,
    label:
      state === "enabled"
        ? "Running"
        : state === "disabled"
          ? "Paused"
          : state === "stopped"
            ? "Not Running"
            : "AeroSpace Not Found",
  };
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = await getServiceState();
    if (state === "enabled" || state === "disabled") return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("AeroSpace started, but its CLI server did not become ready.");
}

export async function startAerospace(): Promise<CommandResult> {
  const binary = await findAerospaceBinary();
  if (!binary) {
    throw new Error("AeroSpace CLI was not found. Set its path in extension preferences.");
  }

  let state = await getServiceState();
  if (state === "stopped") {
    const app = await findAerospaceApp();
    if (!app) {
      throw new Error("AeroSpace.app was not found. Set its path in extension preferences.");
    }
    await execFileAsync("/usr/bin/open", [app]);
    await waitForServer();
    state = await getServiceState();
  }
  if (state === "disabled") await aerospace(["enable", "on"]);
  return { stdout: "AeroSpace is running", stderr: "" };
}

export async function toggleAerospace(): Promise<CommandResult> {
  const state = await getServiceState();
  if (state === "enabled") {
    await aerospace(["enable", "off"]);
    return { stdout: "AeroSpace paused", stderr: "" };
  }
  return startAerospace();
}

export async function reloadAerospace(): Promise<CommandResult> {
  await aerospace(["reload-config"]);
  return { stdout: "Configuration reloaded", stderr: "" };
}

export async function quitAerospace(): Promise<CommandResult> {
  const state = await getServiceState();
  if (state === "stopped") return { stdout: "AeroSpace is not running", stderr: "" };
  await execFileAsync("/usr/bin/osascript", [
    "-e",
    'tell application id "bobko.aerospace" to quit',
  ]);
  return { stdout: "AeroSpace quit", stderr: "" };
}

export async function resolveConfigPath(refresh = false): Promise<string | null> {
  if (!refresh && configCache !== undefined) return configCache;

  const configured = preferences().aerospaceConfigPath?.trim();
  if (configured) {
    const configuredPath = expandPath(configured);
    configCache = (await isReadable(configuredPath)) ? configuredPath : null;
    return configCache;
  }

  try {
    const result = await aerospace(["config", "--config-path"]);
    if (result.stdout && (await isReadable(result.stdout))) {
      configCache = result.stdout;
      return result.stdout;
    }
  } catch {
    // Disabled and stopped servers may reject config queries; use documented paths.
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME
    ? expandPath(process.env.XDG_CONFIG_HOME)
    : join(homedir(), ".config");
  const candidates = [
    join(homedir(), ".aerospace.toml"),
    join(xdgConfigHome, "aerospace", "aerospace.toml"),
  ];
  for (const candidate of candidates) {
    if (await isReadable(candidate)) {
      configCache = candidate;
      return candidate;
    }
  }
  configCache = null;
  return null;
}

function versionLine(
  output: string,
  prefix: "aerospace CLI client version:" | "AeroSpace.app server version:",
): string | null {
  const line = output.split("\n").find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length).trim().split(/\s+/)[0] : null;
}

export async function diagnoseInstallation(): Promise<InstallationInfo> {
  const [binaryPath, appPath, configPath] = await Promise.all([
    findAerospaceBinary(true),
    findAerospaceApp(true),
    resolveConfigPath(true),
  ]);
  const state = await getServiceState();
  let clientVersion: string | null = null;
  let serverVersion: string | null = null;
  if (binaryPath) {
    try {
      const result = await aerospace(["--version"]);
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      clientVersion = versionLine(output, "aerospace CLI client version:");
      serverVersion = versionLine(output, "AeroSpace.app server version:");
    } catch {
      // A broken or incompatible binary is reported below.
    }
  }

  const issues: string[] = [];
  if (!binaryPath) issues.push("AeroSpace CLI was not found.");
  if (!appPath) issues.push("AeroSpace.app was not found.");
  if (!configPath)
    issues.push("No custom configuration was found. AeroSpace may be using its built-in defaults.");
  if (clientVersion && serverVersion && clientVersion !== serverVersion) {
    issues.push(
      `CLI ${clientVersion} and app ${serverVersion} do not match. Reinstall or update AeroSpace.`,
    );
  }

  return {
    binaryPath,
    appPath,
    configPath,
    clientVersion,
    serverVersion,
    state,
    issues,
  };
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { stderr?: string; message?: string };
    if (candidate.stderr?.trim()) return candidate.stderr.trim();
    if (candidate.message?.startsWith("Command failed:")) {
      return "AeroSpace rejected the command without an explanation. The selected window may have changed or closed; refresh the list and try again.";
    }
    if (candidate.message) return candidate.message;
  }
  return String(error);
}

export function splitArguments(input: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const char of input.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else current += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (current) {
        result.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }
  if (escaped) current += "\\";
  if (quote) throw new Error("An argument contains an unclosed quote.");
  if (current) result.push(current);
  return result;
}

export const ALL_SUBCOMMANDS = [
  "balance-sizes",
  "close",
  "close-all-windows-but-current",
  "config",
  "enable",
  "flatten-workspace-tree",
  "focus",
  "focus-back-and-forth",
  "focus-monitor",
  "fullscreen",
  "join-with",
  "layout",
  "list-apps",
  "list-exec-env-vars",
  "list-modes",
  "list-monitors",
  "list-windows",
  "list-workspaces",
  "macos-native-fullscreen",
  "macos-native-minimize",
  "mode",
  "move",
  "move-mouse",
  "move-node-to-monitor",
  "move-node-to-workspace",
  "move-workspace-to-monitor",
  "reload-config",
  "resize",
  "split",
  "summon-workspace",
  "swap",
  "trigger-binding",
  "volume",
  "workspace",
  "workspace-back-and-forth",
] as const;

export async function listAvailableSubcommands(): Promise<string[]> {
  try {
    const result = await aerospace(["--help"]);
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    const commands = [...output.matchAll(/^\s{2}([a-z][a-z0-9-]+)\s+/gm)]
      .map((match) => match[1])
      .filter((command) => command !== "debug-windows");
    if (commands.length) return commands;
  } catch {
    // Use the known compatible command set when help output is unavailable.
  }
  return [...ALL_SUBCOMMANDS];
}

export function binaryName(path: string | null): string {
  return path ? basename(path) : "Not Found";
}

export async function readResolvedConfig(): Promise<{
  path: string;
  content: string;
}> {
  const path = await resolveConfigPath();
  if (!path) throw new Error("No AeroSpace configuration file was found.");
  return { path, content: await readFile(path, "utf8") };
}
