import { Action, ActionPanel, Icon, Keyboard, List, LocalStorage, Toast, showToast, useNavigation } from "@raycast/api";
import { useEffect, useMemo, useState } from "react";
import { Shortcut, parseShortcuts } from "./utils/config-parser";
import { aerospace, errorMessage } from "./utils/aerospace";
import { coloredIcon, PALETTE } from "./utils/theme";

const FAVORITE_SHORTCUTS_KEY = "aerospace-control-center.favorite-shortcuts-v1";
const DEFAULT_FAVORITE_LIMIT = 8;

const CATEGORY_ICONS: Record<string, Icon> = {
  Focus: Icon.Eye,
  "Move Window": Icon.ArrowRight,
  Workspace: Icon.AppWindowGrid2x2,
  "Move to Workspace": Icon.ArrowUpCircle,
  Layout: Icon.AppWindowGrid3x3,
  Resize: Icon.ArrowsExpand,
  Join: Icon.Link,
  Service: Icon.Gear,
  Launch: Icon.Terminal,
  Other: Icon.CommandSymbol,
};

type ShortcutData = {
  shortcuts: Shortcut[];
  configPath: string | null;
  favoriteIds: string[];
};

function categoryIcon(shortcut: Shortcut): Icon {
  const category = shortcut.category.replace(/^\[.*?\]\s*/, "");
  return CATEGORY_ICONS[category] ?? Icon.CommandSymbol;
}

function recommendedFavorites(shortcuts: Shortcut[]): string[] {
  const priorities = [
    /workspace-back-and-forth/,
    /^workspace\s+/,
    /layout floating tiling/,
    /^layout\s+/,
    /reload-config/,
    /flatten-workspace-tree/,
  ];
  const selected: string[] = [];
  for (const pattern of priorities) {
    const match = shortcuts.find((shortcut) => !selected.includes(shortcut.id) && pattern.test(shortcut.command));
    if (match) selected.push(match.id);
  }
  for (const shortcut of shortcuts) {
    if (selected.length >= DEFAULT_FAVORITE_LIMIT) break;
    if (!selected.includes(shortcut.id)) selected.push(shortcut.id);
  }
  return selected;
}

async function loadShortcutData(): Promise<ShortcutData> {
  const { shortcuts, configPath } = await parseShortcuts();
  const availableIds = new Set(shortcuts.map((shortcut) => shortcut.id));
  const stored = await LocalStorage.getItem<string>(FAVORITE_SHORTCUTS_KEY);
  let favoriteIds: string[];
  if (stored === undefined) {
    favoriteIds = recommendedFavorites(shortcuts);
  } else {
    try {
      favoriteIds = (JSON.parse(stored) as string[]).filter((id) => availableIds.has(id));
    } catch {
      favoriteIds = recommendedFavorites(shortcuts);
    }
  }
  await LocalStorage.setItem(FAVORITE_SHORTCUTS_KEY, JSON.stringify(favoriteIds));
  return { shortcuts, configPath, favoriteIds };
}

async function runShortcut(shortcut: Shortcut): Promise<void> {
  const toast = await showToast({ style: Toast.Style.Animated, title: shortcut.description });
  try {
    await aerospace(["trigger-binding", shortcut.key, "--mode", shortcut.mode]);
    toast.style = Toast.Style.Success;
    toast.title = "Shortcut Run";
    toast.message = `${shortcut.keyDisplay} · ${shortcut.command}`;
  } catch (error) {
    toast.style = Toast.Style.Failure;
    toast.title = "Shortcut Failed";
    toast.message = errorMessage(error);
  }
}

function ShortcutActions({
  shortcut,
  configPath,
  isFavorite,
  onToggleFavorite,
  onManage,
  onRefresh,
}: {
  shortcut: Shortcut;
  configPath: string | null;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onManage?: () => void;
  onRefresh: () => void;
}) {
  return (
    <ActionPanel>
      <Action title="Run Shortcut" icon={Icon.Play} onAction={() => runShortcut(shortcut)} />
      {onManage ? <Action title="Manage Common Shortcuts" icon={Icon.CheckList} onAction={onManage} /> : null}
      <Action
        title={isFavorite ? "Remove from Common Shortcuts" : "Add to Common Shortcuts"}
        icon={isFavorite ? Icon.MinusCircle : Icon.PlusCircle}
        onAction={onToggleFavorite}
      />
      {configPath ? (
        <Action.Open title="Edit Shortcut in AeroSpace Config" target={configPath} icon={Icon.Document} />
      ) : null}
      <Action
        title="Refresh from Active Config"
        icon={Icon.ArrowClockwise}
        shortcut={Keyboard.Shortcut.Common.Refresh}
        onAction={onRefresh}
      />
      <Action.CopyToClipboard title="Copy Command" content={shortcut.command} />
    </ActionPanel>
  );
}

function ManageCommonShortcuts({ data, onChange }: { data: ShortcutData; onChange: (ids: string[]) => void }) {
  const [currentData, setCurrentData] = useState(data);
  const selected = new Set(currentData.favoriteIds);
  const grouped = useMemo(
    () =>
      currentData.shortcuts.reduce<Record<string, Shortcut[]>>((result, shortcut) => {
        (result[shortcut.category] ||= []).push(shortcut);
        return result;
      }, {}),
    [currentData.shortcuts],
  );

  const toggle = async (id: string) => {
    const next = selected.has(id)
      ? currentData.favoriteIds.filter((candidate) => candidate !== id)
      : [...currentData.favoriteIds, id];
    await LocalStorage.setItem(FAVORITE_SHORTCUTS_KEY, JSON.stringify(next));
    setCurrentData((current) => ({ ...current, favoriteIds: next }));
    onChange(next);
  };

  const refresh = async () => {
    const next = await loadShortcutData();
    setCurrentData(next);
    onChange(next.favoriteIds);
  };

  return (
    <List navigationTitle="Manage Common Shortcuts" searchBarPlaceholder="Search active AeroSpace shortcuts…">
      {Object.entries(grouped).map(([category, shortcuts]) => (
        <List.Section key={category} title={category} subtitle={`${shortcuts.length} active`}>
          {shortcuts.map((shortcut) => (
            <List.Item
              key={shortcut.id}
              icon={coloredIcon(categoryIcon(shortcut), PALETTE.secondary)}
              title={shortcut.description}
              subtitle={shortcut.command}
              accessories={[
                { text: shortcut.keyDisplay },
                ...(selected.has(shortcut.id) ? [{ icon: Icon.Check, tooltip: "Shown in Common Shortcuts" }] : []),
              ]}
              actions={
                <ShortcutActions
                  shortcut={shortcut}
                  configPath={currentData.configPath}
                  isFavorite={selected.has(shortcut.id)}
                  onToggleFavorite={() => toggle(shortcut.id)}
                  onRefresh={refresh}
                />
              }
            />
          ))}
        </List.Section>
      ))}
    </List>
  );
}

export function CommonShortcuts() {
  const { push } = useNavigation();
  const [data, setData] = useState<ShortcutData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      setError(null);
      setData(await loadShortcutData());
    } catch (loadError) {
      setError(errorMessage(loadError));
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const updateFavorites = (favoriteIds: string[]) => {
    setData((current) => (current ? { ...current, favoriteIds } : current));
  };
  const favoriteSet = new Set(data?.favoriteIds ?? []);
  const favorites = data?.shortcuts.filter((shortcut) => favoriteSet.has(shortcut.id)) ?? [];
  const manage = () => {
    if (data) push(<ManageCommonShortcuts data={data} onChange={updateFavorites} />);
  };

  return (
    <List
      isLoading={!data && !error}
      navigationTitle="Common Shortcuts"
      searchBarPlaceholder="Search common shortcuts…"
    >
      {error ? (
        <List.EmptyView icon={Icon.ExclamationMark} title="Unable to Read Active Shortcuts" description={error} />
      ) : null}
      {!error && data && favorites.length === 0 ? (
        <List.EmptyView
          icon={Icon.Keyboard}
          title="Choose Your Common Shortcuts"
          description="Only shortcuts from the active AeroSpace configuration can be added."
          actions={
            <ActionPanel>
              <Action title="Manage Common Shortcuts" icon={Icon.CheckList} onAction={manage} />
              {data.configPath ? (
                <Action.Open title="Edit AeroSpace Config" target={data.configPath} icon={Icon.Document} />
              ) : null}
            </ActionPanel>
          }
        />
      ) : null}
      {favorites.length ? (
        <List.Section title="Common Shortcuts" subtitle={`${favorites.length} from active config`}>
          {favorites.map((shortcut) => (
            <List.Item
              key={shortcut.id}
              icon={coloredIcon(categoryIcon(shortcut), PALETTE.secondary)}
              title={shortcut.description}
              subtitle={shortcut.command}
              accessories={[{ text: shortcut.keyDisplay, icon: Icon.CommandSymbol }]}
              actions={
                <ShortcutActions
                  shortcut={shortcut}
                  configPath={data?.configPath ?? null}
                  isFavorite
                  onToggleFavorite={async () => {
                    const next = (data?.favoriteIds ?? []).filter((id) => id !== shortcut.id);
                    await LocalStorage.setItem(FAVORITE_SHORTCUTS_KEY, JSON.stringify(next));
                    updateFavorites(next);
                  }}
                  onManage={manage}
                  onRefresh={refresh}
                />
              }
            />
          ))}
        </List.Section>
      ) : null}
    </List>
  );
}

export default function Command() {
  return <CommonShortcuts />;
}
