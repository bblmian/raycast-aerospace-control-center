import { Action, ActionPanel, Color, Icon, List, showToast, Toast } from "@raycast/api";
import { useEffect, useState } from "react";
import { parseShortcuts, Shortcut } from "./utils/config-parser";
import { aerospace } from "./utils/aerospace";

const CATEGORY_CONFIG: Record<string, { icon: Icon; color: Color }> = {
  Focus: { icon: Icon.Eye, color: Color.Blue },
  "Move Window": { icon: Icon.ArrowRight, color: Color.Green },
  Workspace: { icon: Icon.Window, color: Color.Purple },
  "Move to Workspace": { icon: Icon.ArrowUpCircleFilled, color: Color.Orange },
  Layout: { icon: Icon.AppWindowGrid3x3, color: Color.Yellow },
  Resize: { icon: Icon.FullSignal, color: Color.Magenta },
  Join: { icon: Icon.Link, color: Color.Red },
  Service: { icon: Icon.Gear, color: Color.SecondaryText },
  Launch: { icon: Icon.Terminal, color: Color.SecondaryText },
  Other: { icon: Icon.Dot, color: Color.SecondaryText },
};

async function triggerShortcut(shortcut: Shortcut): Promise<void> {
  await aerospace(["trigger-binding", shortcut.key, "--mode", shortcut.mode]);
}

function getCategoryConfig(category: string): { icon: Icon; color: Color } {
  const base = category.replace(/^\[.*?\]\s*/, "");
  return CATEGORY_CONFIG[base] ?? CATEGORY_CONFIG["Other"];
}

export default function BrowseShortcuts() {
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [configPath, setConfigPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    parseShortcuts()
      .then(({ shortcuts, configPath }) => {
        setShortcuts(shortcuts);
        setConfigPath(configPath);
        setIsLoading(false);
        if (!configPath) {
          setError(
            "No custom AeroSpace configuration was found. Check extension preferences or use AeroSpace's documented config locations.",
          );
        }
      })
      .catch((err) => {
        setError(String(err));
        setIsLoading(false);
      });
  }, []);

  const grouped = shortcuts.reduce<Record<string, Shortcut[]>>((acc, item) => {
    (acc[item.category] = acc[item.category] || []).push(item);
    return acc;
  }, {});

  if (!isLoading && error && shortcuts.length === 0) {
    return (
      <List>
        <List.EmptyView
          icon={Icon.ExclamationMark}
          title="AeroSpace config not found"
          description={error}
        />
      </List>
    );
  }

  return (
    <List isLoading={isLoading} searchBarPlaceholder="Search shortcuts…">
      {Object.entries(grouped).map(([category, items]) => {
        const { icon, color } = getCategoryConfig(category);
        return (
          <List.Section key={category} title={category} subtitle={`${items.length}`}>
            {items.map((item) => (
              <List.Item
                key={item.id}
                icon={{ source: icon, tintColor: color }}
                title={item.description}
                subtitle={item.command !== item.description ? item.command : undefined}
                accessories={[
                  {
                    tag: {
                      value: item.keyDisplay,
                      color: item.mode === "main" ? Color.Blue : Color.Orange,
                    },
                  },
                ]}
                actions={
                  <ActionPanel>
                    <ActionPanel.Section>
                      <Action
                        title="Run Command"
                        icon={Icon.Terminal}
                        onAction={async () => {
                          try {
                            await triggerShortcut(item);
                            await showToast({
                              style: Toast.Style.Success,
                              title: "Done",
                              message: item.command,
                            });
                          } catch (err) {
                            await showToast({
                              style: Toast.Style.Failure,
                              title: "Failed",
                              message: String(err),
                            });
                          }
                        }}
                      />
                    </ActionPanel.Section>
                    <ActionPanel.Section>
                      <Action.CopyToClipboard
                        title="Copy Command"
                        content={item.command}
                        shortcut={{ modifiers: ["cmd"], key: "c" }}
                      />
                      <Action.CopyToClipboard
                        title="Copy Shortcut Key"
                        content={item.key}
                        shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
                      />
                    </ActionPanel.Section>
                    {configPath && (
                      <ActionPanel.Section>
                        <Action.Open
                          title="Open Config File"
                          target={configPath}
                          icon={Icon.Document}
                          shortcut={{ modifiers: ["cmd"], key: "o" }}
                        />
                      </ActionPanel.Section>
                    )}
                  </ActionPanel>
                }
              />
            ))}
          </List.Section>
        );
      })}
    </List>
  );
}
