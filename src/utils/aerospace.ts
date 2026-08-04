import { getApplications, getPreferenceValues } from "@raycast/api";
import { createHash } from "crypto";
import { constants } from "fs";
import {
  access,
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  open as openFile,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "fs/promises";
import { homedir, tmpdir } from "os";
import { basename, delimiter, dirname, join, resolve } from "path";
import { execFile, spawn } from "child_process";
import { parse } from "smol-toml";
import { promisify } from "util";
import { recommendedFloatingRules } from "./rule-config";

const execFileAsync = promisify(execFile);

export type CommandResult = { stdout: string; stderr: string };
export type InstallationProgress = {
  phase: "checking" | "downloading" | "verifying" | "extracting" | "installing" | "restarting" | "complete";
  message: string;
  percent?: number;
};
export type AeroSpaceRelease = {
  version: string;
  tag: string;
  downloadUrl: string;
  size: number;
  digest: string | null;
  publishedAt: string;
  prerelease: boolean;
};
export type ConfigurationProfile = "recommended" | "official";
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
const MONITOR_LIST_FORMAT = "%{monitor-id} %{monitor-name} %{monitor-appkit-nsscreen-screens-id} %{monitor-is-main}";
const PAUSE_AGENT_LABEL = "com.bblmian.raycast-aerospace-resume";
const PAUSE_SUPPORT_DIRECTORY = join(homedir(), "Library", "Application Support", "AeroSpace Control Center");
const PAUSE_AGENT_PATH = join(homedir(), "Library", "LaunchAgents", `${PAUSE_AGENT_LABEL}.plist`);
const PAUSE_SCRIPT_PATH = join(PAUSE_SUPPORT_DIRECTORY, "resume-aerospace.sh");
const PAUSE_STATE_PATH = join(PAUSE_SUPPORT_DIRECTORY, "pause-schedule.json");

const RECOMMENDED_FLOATING_BUNDLE_IDS = [
  ["Messages", "com.apple.MobileSMS"],
  ["FaceTime", "com.apple.FaceTime"],
  ["Slack", "com.tinyspeck.slackmacgap"],
  ["Discord", "com.hnc.Discord"],
  ["Microsoft Teams", "com.microsoft.teams2"],
  ["Microsoft Teams Classic", "com.microsoft.teams"],
  ["WeChat", "com.tencent.xinWeChat"],
  ["WeCom", "com.tencent.WeWorkMac"],
  ["DingTalk", "com.alibaba.DingTalkMac"],
  ["Telegram", "ru.keepcoder.Telegram"],
  ["WhatsApp", "net.whatsapp.WhatsApp"],
  ["Signal", "org.whispersystems.signal-desktop"],
  ["ChatGPT", "com.openai.chat"],
  ["ChatGPT", "com.openai.codex"],
  ["Claude", "com.anthropic.claudefordesktop"],
] as const;

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

export type PauseSchedule = {
  pausedAt: string;
  resumeAt: string;
  days: number;
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
      .sort((left, right) => compareAeroSpaceVersions(right, left))
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

export async function isAeroSpaceManagedByHomebrew(): Promise<boolean> {
  const brew = await findHomebrewBinary();
  if (!brew) return false;
  try {
    await execFileAsync(brew, ["list", "--cask", "aerospace"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    return true;
  } catch {
    return false;
  }
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

  const application = (await getApplications()).find((candidate) => candidate.bundleId === "bobko.aerospace");
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

async function runProcessWithProgress(
  command: string,
  args: string[],
  onProgress?: (progress: InstallationProgress) => void,
): Promise<CommandResult> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(
      () => {
        timedOut = true;
        child.kill("SIGTERM");
      },
      15 * 60 * 1000,
    );

    const report = (chunk: Buffer, stream: "stdout" | "stderr") => {
      const text = chunk.toString();
      if (stream === "stdout") stdout += text;
      else stderr += text;
      const message = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1);
      if (message) onProgress?.({ phase: "installing", message });
    };

    child.stdout.on("data", (chunk: Buffer) => report(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => report(chunk, "stderr"));
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const result = { stdout: stdout.trim(), stderr: stderr.trim() };
      if (timedOut) {
        rejectPromise(
          new Error(
            `${basename(command)} did not finish within 15 minutes. The process was stopped; check your network connection and Homebrew status before trying again.`,
          ),
        );
      } else if (code === 0) resolvePromise(result);
      else
        rejectPromise(
          new Error(result.stderr || result.stdout || `${basename(command)} exited with status ${code ?? "unknown"}.`),
        );
    });
  });
}

function clearInstallationCaches() {
  binaryCache = undefined;
  appCache = undefined;
  configCache = undefined;
}

async function isAeroSpaceRunning(): Promise<boolean> {
  try {
    await execFileAsync("/usr/bin/pgrep", ["-x", "AeroSpace"]);
    return true;
  } catch {
    return false;
  }
}

async function waitForAeroSpaceToQuit(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!(await isAeroSpaceRunning())) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("The older AeroSpace background service did not quit. Quit AeroSpace manually, then try again.");
}

export async function restartAerospace(onProgress?: (progress: InstallationProgress) => void): Promise<CommandResult> {
  const app = await findAerospaceApp(true);
  if (!app) throw new Error("AeroSpace.app was not found. Set its path in extension preferences.");

  onProgress?.({ phase: "restarting", message: "Restarting AeroSpace with the updated version…" });
  if (await isAeroSpaceRunning()) {
    await execFileAsync("/usr/bin/osascript", ["-e", 'tell application id "bobko.aerospace" to quit']);
    await waitForAeroSpaceToQuit();
  }
  clearInstallationCaches();
  await execFileAsync("/usr/bin/open", [app]);
  await waitForServer();
  await verifyServerCompatibility();
  return { stdout: "AeroSpace restarted and is ready", stderr: "" };
}

export async function installAerospaceWithHomebrew(
  reinstall = false,
  onProgress?: (progress: InstallationProgress) => void,
): Promise<CommandResult> {
  const brew = await findHomebrewBinary();
  if (!brew) {
    throw new Error("Homebrew was not found. Install Homebrew first, then return to Setup & Repair.");
  }
  onProgress?.({
    phase: "checking",
    message: reinstall ? "Preparing Homebrew repair…" : "Preparing Homebrew installation…",
  });
  const result = await runProcessWithProgress(
    brew,
    [reinstall ? "reinstall" : "install", "--cask", "nikitabobko/tap/aerospace"],
    onProgress,
  );
  clearInstallationCaches();
  await restartAerospace(onProgress);
  onProgress?.({ phase: "complete", message: "AeroSpace installation completed.", percent: 100 });
  return { stdout: "AeroSpace installed, restarted, and verified.", stderr: result.stderr };
}

export async function updateAerospaceWithHomebrew(
  onProgress?: (progress: InstallationProgress) => void,
): Promise<CommandResult> {
  const brew = await findHomebrewBinary();
  if (!brew) throw new Error("Homebrew was not found, so this installation cannot be updated here.");
  const wasRunning = await isAeroSpaceRunning();
  onProgress?.({ phase: "checking", message: "Checking the Homebrew cask…" });
  const result = await runProcessWithProgress(brew, ["upgrade", "--cask", "nikitabobko/tap/aerospace"], onProgress);
  clearInstallationCaches();
  if (wasRunning) {
    await restartAerospace(onProgress);
  } else {
    onProgress?.({ phase: "verifying", message: "Verifying the installed AeroSpace files…" });
    const [binary, app] = await Promise.all([findAerospaceBinary(true), findAerospaceApp(true)]);
    if (!binary || !app) {
      throw new Error("Homebrew finished, but the AeroSpace application and CLI could not both be detected.");
    }
    const [clientVersion, appVersion] = await Promise.all([
      installedClientVersion(binary, app),
      installedAppVersion(app),
    ]);
    if (!clientVersion || !appVersion) {
      throw new Error("Homebrew finished, but the installed AeroSpace versions could not be verified.");
    }
    if (clientVersion !== appVersion) {
      throw new Error(`Homebrew finished, but CLI ${clientVersion} and app ${appVersion} do not match.`);
    }
  }
  onProgress?.({
    phase: "complete",
    message: wasRunning ? "AeroSpace updated and restarted." : "AeroSpace updated. Its stopped state was preserved.",
    percent: 100,
  });
  return {
    stdout: wasRunning
      ? "AeroSpace updated, restarted, and verified."
      : "AeroSpace updated and verified. It remains stopped because it was not running before the update.",
    stderr: result.stderr,
  };
}

export async function getLatestAeroSpaceRelease(): Promise<AeroSpaceRelease> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let response: Response;
  try {
    response = await fetch("https://api.github.com/repos/nikitabobko/AeroSpace/releases?per_page=10", {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "raycast-aerospace-control-center",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new Error("The official AeroSpace release check timed out.");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) {
    throw new Error(`GitHub release check failed (${response.status}).`);
  }

  type GitHubAsset = {
    name: string;
    browser_download_url: string;
    size: number;
    digest?: string | null;
    updated_at: string;
  };
  type GitHubRelease = {
    tag_name: string;
    draft: boolean;
    prerelease: boolean;
    published_at: string;
    assets: GitHubAsset[];
  };
  const releases = (await response.json()) as GitHubRelease[];
  for (const release of releases) {
    if (release.draft) continue;
    const asset = release.assets.find((candidate) => /^AeroSpace-v.+\.zip$/i.test(candidate.name));
    if (!asset) continue;
    return {
      version: release.tag_name.replace(/^v/, ""),
      tag: release.tag_name,
      downloadUrl: asset.browser_download_url,
      size: asset.size,
      digest: asset.digest || null,
      publishedAt: release.published_at || asset.updated_at,
      prerelease: release.prerelease,
    };
  }
  throw new Error("No downloadable AeroSpace release was found on the official GitHub repository.");
}

function numericVersion(version: string): number[] {
  return (version.match(/\d+/g) || []).slice(0, 4).map(Number);
}

export function compareAeroSpaceVersions(local: string | null, remote: string | null): number {
  if (!local || !remote) return 0;
  const left = numericVersion(local);
  const right = numericVersion(remote);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] || 0) - (right[index] || 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

export async function installLatestAeroSpaceDirect(
  release: AeroSpaceRelease,
  onProgress?: (progress: InstallationProgress) => void,
): Promise<CommandResult> {
  if (!release.digest?.toLowerCase().startsWith("sha256:")) {
    throw new Error(
      "The official release did not provide a SHA-256 digest. Direct installation was stopped; use Homebrew or install it manually.",
    );
  }
  if ((await findAerospaceApp(true)) || (await findAerospaceBinary(true))) {
    throw new Error(
      "An AeroSpace installation already exists. Direct download is disabled to prevent duplicate installations; use its original update method instead.",
    );
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "raycast-aerospace-"));
  const archivePath = join(temporaryRoot, "AeroSpace.zip");
  const extractionPath = join(temporaryRoot, "extracted");
  const userApplications = join(homedir(), "Applications");
  const userBin = join(homedir(), ".local", "bin");
  const destinationApp = join(userApplications, "AeroSpace.app");
  const destinationBinary = join(userBin, "aerospace");
  let createdApp = false;
  let createdBinary = false;
  const downloadController = new AbortController();
  const downloadTimeout = setTimeout(() => downloadController.abort(), 15 * 60 * 1000);

  try {
    onProgress?.({ phase: "downloading", message: `Downloading AeroSpace ${release.version}…` });
    const response = await fetch(release.downloadUrl, {
      headers: { "User-Agent": "raycast-aerospace-control-center" },
      signal: downloadController.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Official download failed (${response.status}).`);
    }

    const handle = await openFile(archivePath, "wx");
    const hash = createHash("sha256");
    const reader = response.body.getReader() as unknown as {
      read: () => Promise<{ done: boolean; value?: Uint8Array }>;
    };
    let received = 0;
    let streamDone = false;
    try {
      while (!streamDone) {
        const result = await reader.read();
        streamDone = result.done;
        if (result.done) continue;
        if (!result.value) throw new Error("The official download stream ended unexpectedly.");
        const chunk = Buffer.from(result.value);
        await handle.write(chunk);
        hash.update(chunk);
        received += chunk.length;
        const percent = release.size ? Math.min(100, Math.round((received / release.size) * 100)) : undefined;
        onProgress?.({
          phase: "downloading",
          message: percent ? `Downloading official release… ${percent}%` : "Downloading official release…",
          percent,
        });
      }
    } finally {
      await handle.close();
    }

    onProgress?.({ phase: "verifying", message: "Verifying the official SHA-256 checksum…" });
    const actualDigest = hash.digest("hex");
    const expectedDigest = release.digest?.replace(/^sha256:/i, "");
    if (expectedDigest && actualDigest.toLowerCase() !== expectedDigest.toLowerCase()) {
      throw new Error("The downloaded archive failed SHA-256 verification and was not installed.");
    }

    await mkdir(extractionPath, { recursive: true });
    onProgress?.({ phase: "extracting", message: "Extracting the signed AeroSpace package…" });
    await execFileAsync("/usr/bin/ditto", ["-x", "-k", archivePath, extractionPath]);
    const extractedEntries = await readdir(extractionPath);
    const releaseDirectory = extractedEntries.find((entry) => entry.startsWith("AeroSpace-v"));
    if (!releaseDirectory) throw new Error("The official archive has an unexpected structure.");
    const sourceRoot = join(extractionPath, releaseDirectory);
    const sourceApp = join(sourceRoot, "AeroSpace.app");
    const sourceBinary = join(sourceRoot, "bin", "aerospace");
    if (!(await isReadable(join(sourceApp, "Contents", "Info.plist"))) || !(await canExecute(sourceBinary))) {
      throw new Error("The official archive does not contain a valid AeroSpace app and CLI.");
    }
    if ((await isReadable(destinationApp)) || (await isReadable(destinationBinary))) {
      throw new Error("A destination file appeared during installation. Nothing was overwritten.");
    }

    await mkdir(userApplications, { recursive: true });
    await mkdir(userBin, { recursive: true });
    onProgress?.({ phase: "installing", message: "Installing in your user Applications folder…" });
    await execFileAsync("/usr/bin/ditto", [sourceApp, destinationApp]);
    createdApp = true;
    await copyFile(sourceBinary, destinationBinary, constants.COPYFILE_EXCL);
    createdBinary = true;
    await chmod(destinationBinary, 0o755);
    await execFileAsync("/usr/bin/xattr", ["-dr", "com.apple.quarantine", destinationApp]);
    clearInstallationCaches();
    onProgress?.({
      phase: "complete",
      message: `AeroSpace ${release.version} installed.`,
      percent: 100,
    });
    return {
      stdout: `Installed AeroSpace ${release.version} in ${destinationApp} and ${destinationBinary}.`,
      stderr: "",
    };
  } catch (error) {
    if (createdBinary) await rm(destinationBinary, { force: true });
    if (createdApp) await rm(destinationApp, { recursive: true, force: true });
    clearInstallationCaches();
    if (downloadController.signal.aborted) {
      throw new Error("The AeroSpace download did not finish within 15 minutes. No partial installation was kept.");
    }
    throw error;
  } finally {
    clearTimeout(downloadTimeout);
    await rm(temporaryRoot, { recursive: true, force: true });
  }
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

export async function createDefaultConfig(profile: ConfigurationProfile = "official"): Promise<CommandResult> {
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
  let content = await readFile(source, "utf8");
  if (profile === "recommended") {
    const block = recommendedFloatingRules(RECOMMENDED_FLOATING_BUNDLE_IDS);
    const firstTable = content.search(/^\s*\[/m);
    content =
      firstTable >= 0 ? `${content.slice(0, firstTable)}${block}${content.slice(firstTable)}` : `${content}\n${block}`;
    parse(content);
  }

  const destination = join(homedir(), ".aerospace.toml");
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content, { encoding: "utf8", flag: "wx" });
  configCache = destination;
  return {
    stdout:
      profile === "recommended"
        ? `Created ${destination} with the official defaults plus floating rules for common chat apps.`
        : `Created ${destination} from AeroSpace's official default config.`,
    stderr: "",
  };
}

export async function jsonCommand<T>(args: string[]): Promise<T> {
  const { stdout } = await aerospace(args);
  return JSON.parse(stdout) as T;
}

export function listWorkspaces(): Promise<WorkspaceInfo[]> {
  return jsonCommand<WorkspaceInfo[]>(["list-workspaces", "--all", "--json", "--format", WORKSPACE_LIST_FORMAT]);
}

export function listWindows(): Promise<WindowInfo[]> {
  return jsonCommand<WindowInfo[]>(["list-windows", "--all", "--json", "--format", WINDOW_LIST_FORMAT]);
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
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const state = await getServiceState();
    if (state === "enabled" || state === "disabled") return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error("AeroSpace started, but its CLI server did not become ready.");
}

async function verifyServerCompatibility(): Promise<void> {
  let result: CommandResult;
  try {
    result = await aerospace(["--version"]);
  } catch (error) {
    if (/client and server versions are incompatible/i.test(commandFailureOutput(error))) {
      throw new Error(
        "AeroSpace restarted, but an incompatible background service is still responding. Quit AeroSpace from Activity Monitor, reopen it, and try again.",
      );
    }
    throw error;
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const clientVersion = versionLine(output, "aerospace CLI client version:");
  const serverVersion = versionLine(output, "AeroSpace.app server version:");
  if (!clientVersion || !serverVersion) {
    throw new Error("AeroSpace restarted, but the extension could not verify both installed and running versions.");
  }
  if (clientVersion !== serverVersion) {
    throw new Error(`AeroSpace restarted, but CLI ${clientVersion} and app ${serverVersion} still do not match.`);
  }
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
  if (await getPauseSchedule()) return resumeAeroSpaceNow();
  return startAerospace();
}

export async function reloadAerospace(): Promise<CommandResult> {
  await aerospace(["reload-config"]);
  return { stdout: "Configuration reloaded", stderr: "" };
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function unloadPauseAgent(): Promise<void> {
  const domain = `gui/${process.getuid?.() ?? 501}`;
  try {
    await execFileAsync("/bin/launchctl", ["bootout", `${domain}/${PAUSE_AGENT_LABEL}`]);
  } catch {
    // The agent is already unloaded.
  }
}

export async function cancelScheduledResume(): Promise<void> {
  await unloadPauseAgent();
  await Promise.all([
    rm(PAUSE_AGENT_PATH, { force: true }),
    rm(PAUSE_SCRIPT_PATH, { force: true }),
    rm(PAUSE_STATE_PATH, { force: true }),
  ]);
}

export async function getPauseSchedule(): Promise<PauseSchedule | null> {
  try {
    const schedule = JSON.parse(await readFile(PAUSE_STATE_PATH, "utf8")) as PauseSchedule;
    if (!schedule.resumeAt || !Number.isFinite(Date.parse(schedule.resumeAt))) return null;
    return schedule;
  } catch {
    return null;
  }
}

export async function pauseAeroSpaceForDays(days: number): Promise<CommandResult> {
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error("Choose a whole number of days between 1 and 365.");
  }
  const binary = await findAerospaceBinary(true);
  if (!binary) throw new Error("AeroSpace CLI was not found.");
  const state = await getServiceState();
  if (state === "not-installed" || state === "stopped") {
    throw new Error("AeroSpace must be running before it can be paused for a scheduled period.");
  }

  const pausedAt = new Date();
  const resumeAt = new Date(pausedAt.getTime() + days * 24 * 60 * 60 * 1000);
  const targetEpoch = Math.floor(resumeAt.getTime() / 1000);
  const domain = `gui/${process.getuid?.() ?? 501}`;
  const script = `#!/bin/sh
if [ "$(/bin/date +%s)" -lt "${targetEpoch}" ]; then
  exit 0
fi
if ${shellQuote(binary)} enable on >/dev/null 2>&1; then
  /bin/rm -f ${shellQuote(PAUSE_AGENT_PATH)} ${shellQuote(PAUSE_STATE_PATH)} ${shellQuote(PAUSE_SCRIPT_PATH)}
  /usr/bin/osascript -e 'display notification "AeroSpace window management is active again." with title "AeroSpace Resumed"' >/dev/null 2>&1
  /bin/launchctl bootout ${shellQuote(`${domain}/${PAUSE_AGENT_LABEL}`)} >/dev/null 2>&1
fi
`;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PAUSE_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xmlEscape(PAUSE_SCRIPT_PATH)}</string></array>
  <key>RunAtLoad</key><true/>
  <key>StartInterval</key><integer>300</integer>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
  const schedule: PauseSchedule = {
    pausedAt: pausedAt.toISOString(),
    resumeAt: resumeAt.toISOString(),
    days,
  };

  await cancelScheduledResume();
  await mkdir(PAUSE_SUPPORT_DIRECTORY, { recursive: true });
  await mkdir(dirname(PAUSE_AGENT_PATH), { recursive: true });
  await writeFile(PAUSE_SCRIPT_PATH, script, { encoding: "utf8", mode: 0o700 });
  await chmod(PAUSE_SCRIPT_PATH, 0o700);
  await writeFile(PAUSE_STATE_PATH, JSON.stringify(schedule, null, 2), { encoding: "utf8", mode: 0o600 });
  await writeFile(PAUSE_AGENT_PATH, plist, { encoding: "utf8", mode: 0o600 });

  try {
    await execFileAsync("/bin/launchctl", ["bootstrap", domain, PAUSE_AGENT_PATH]);
    if (state === "enabled") await aerospace(["enable", "off"]);
  } catch (error) {
    await cancelScheduledResume();
    throw error;
  }

  return {
    stdout: `AeroSpace paused until ${resumeAt.toLocaleString()}`,
    stderr: "",
  };
}

export async function resumeAeroSpaceNow(): Promise<CommandResult> {
  await startAerospace();
  await cancelScheduledResume();
  return { stdout: "AeroSpace resumed and the scheduled pause was cleared", stderr: "" };
}

export async function quitAerospace(): Promise<CommandResult> {
  const state = await getServiceState();
  if (state === "stopped") return { stdout: "AeroSpace is not running", stderr: "" };
  await execFileAsync("/usr/bin/osascript", ["-e", 'tell application id "bobko.aerospace" to quit']);
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
  const candidates = [join(homedir(), ".aerospace.toml"), join(xdgConfigHome, "aerospace", "aerospace.toml")];
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
  const line = output
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(prefix));
  return line ? line.slice(prefix.length).trim().split(/\s+/)[0] : null;
}

function commandFailureOutput(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const candidate = error as { stdout?: string; stderr?: string; message?: string };
  return [candidate.stdout, candidate.stderr, candidate.message].filter(Boolean).join("\n");
}

async function installedClientVersion(binaryPath: string, appPath: string | null): Promise<string | null> {
  try {
    const resolvedBinary = await realpath(binaryPath);
    const pathVersion =
      resolvedBinary.match(/\/AeroSpace-v([^/]+)\/bin\/aerospace$/)?.[1] ||
      resolvedBinary.match(/\/Caskroom\/aerospace\/([^/]+)\//)?.[1];
    if (pathVersion) return pathVersion;
  } catch {
    // Fall back to the installed app bundle for non-Homebrew installations.
  }
  return appPath ? installedAppVersion(appPath) : null;
}

async function installedAppVersion(appPath: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("/usr/libexec/PlistBuddy", [
      "-c",
      "Print :CFBundleShortVersionString",
      join(appPath, "Contents", "Info.plist"),
    ]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
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
  let versionFailure = "";
  if (binaryPath) {
    try {
      const result = await aerospace(["--version"]);
      const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
      clientVersion = versionLine(output, "aerospace CLI client version:");
      serverVersion = versionLine(output, "AeroSpace.app server version:");
    } catch (error) {
      versionFailure = commandFailureOutput(error);
      clientVersion = versionLine(versionFailure, "aerospace CLI client version:");
      serverVersion = versionLine(versionFailure, "AeroSpace.app server version:");
    }
    clientVersion ||= await installedClientVersion(binaryPath, appPath);
  }

  const issues: string[] = [];
  if (!binaryPath) issues.push("AeroSpace CLI was not found.");
  if (!appPath) issues.push("AeroSpace.app was not found.");
  if (!configPath) issues.push("No custom configuration was found. AeroSpace may be using its built-in defaults.");
  if (/client and server versions are incompatible/i.test(versionFailure)) {
    issues.push(
      "AeroSpace was updated, but an older background service is still running. Restart AeroSpace to activate the installed version.",
    );
  }
  if (clientVersion && serverVersion && clientVersion !== serverVersion) {
    issues.push(
      `CLI ${clientVersion} and app ${serverVersion} do not match. Restart AeroSpace to activate the update.`,
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
    if (/client and server versions are incompatible/i.test(commandFailureOutput(error))) {
      return "AeroSpace was updated, but its older background service is still running. Open Setup & Repair and restart AeroSpace.";
    }
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
