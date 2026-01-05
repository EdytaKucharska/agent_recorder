/**
 * Hooks management commands for Agent Recorder v2.
 *
 * Installs/uninstalls Claude Code hooks that send events to the Agent Recorder service.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

/** Claude Code settings structure */
interface ClaudeSettings {
  hooks?: {
    PreToolUse?: HookConfig[];
    PostToolUse?: HookConfig[];
    Stop?: HookConfig[];
    SubagentStop?: HookConfig[];
    SessionStart?: HookConfig[];
    SessionEnd?: HookConfig[];
    [key: string]: HookConfig[] | undefined;
  };
  [key: string]: unknown;
}

interface HookConfig {
  matcher?: string;
  hooks: HookEntry[];
}

interface HookEntry {
  type: "command";
  command: string;
}

/** Get path to Claude Code settings file */
function getClaudeSettingsPath(): string {
  const home = os.homedir();
  return path.join(home, ".claude", "settings.json");
}

/** Get path to the hook handler script */
function getHookHandlerPath(): string {
  // The handler is installed as part of agent-recorder package
  // Use npx to ensure it works regardless of installation method
  return "npx agent-recorder-hook";
}

/** Read Claude Code settings */
function readClaudeSettings(settingsPath: string): ClaudeSettings {
  if (!fs.existsSync(settingsPath)) {
    return {};
  }

  try {
    const content = fs.readFileSync(settingsPath, "utf-8");
    return JSON.parse(content) as ClaudeSettings;
  } catch {
    return {};
  }
}

/** Write Claude Code settings */
function writeClaudeSettings(
  settingsPath: string,
  settings: ClaudeSettings
): void {
  const dir = path.dirname(settingsPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
}

/** Check if our hook is already installed for a given event type */
function isHookInstalled(settings: ClaudeSettings, eventType: string): boolean {
  const hooks = settings.hooks?.[eventType];
  if (!hooks) return false;

  return hooks.some((config) =>
    config.hooks.some((hook) => hook.command.includes("agent-recorder-hook"))
  );
}

/** Create hook configuration for a given event type */
function createHookConfig(eventType: string): HookConfig {
  const handlerPath = getHookHandlerPath();

  return {
    matcher: "*",
    hooks: [
      {
        type: "command",
        command: `${handlerPath} ${eventType}`,
      },
    ],
  };
}

/** Install hooks into Claude Code settings */
export async function hooksInstallCommand(): Promise<void> {
  const settingsPath = getClaudeSettingsPath();
  const settings = readClaudeSettings(settingsPath);

  // Hook types we want to install
  const hookTypes = [
    "PostToolUse", // Main one - captures all tool calls with responses
    "SessionStart",
    "SessionEnd",
    "Stop",
    "SubagentStop",
  ];

  // Initialize hooks object if needed
  if (!settings.hooks) {
    settings.hooks = {};
  }

  let installedCount = 0;
  let skippedCount = 0;

  for (const eventType of hookTypes) {
    if (isHookInstalled(settings, eventType)) {
      console.log(`  ⏭ ${eventType}: already installed`);
      skippedCount++;
      continue;
    }

    // Initialize array if needed
    if (!settings.hooks[eventType]) {
      settings.hooks[eventType] = [];
    }

    // Add our hook
    settings.hooks[eventType]!.push(createHookConfig(eventType));
    console.log(`  ✓ ${eventType}: installed`);
    installedCount++;
  }

  // Write updated settings
  writeClaudeSettings(settingsPath, settings);

  console.log("");
  console.log(`Installed ${installedCount} hooks, skipped ${skippedCount}.`);
  console.log(`Settings file: ${settingsPath}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Start the Agent Recorder service: agent-recorder start");
  console.log("  2. Restart Claude Code to pick up the new hooks");
  console.log("  3. Use Claude Code normally - tool calls will be recorded");
  console.log("  4. View recordings: agent-recorder open");
}

/** Uninstall hooks from Claude Code settings */
export async function hooksUninstallCommand(): Promise<void> {
  const settingsPath = getClaudeSettingsPath();
  const settings = readClaudeSettings(settingsPath);

  if (!settings.hooks) {
    console.log("No hooks found in Claude Code settings.");
    return;
  }

  let removedCount = 0;

  for (const eventType of Object.keys(settings.hooks)) {
    const hooks = settings.hooks[eventType];
    if (!hooks) continue;

    // Filter out our hooks
    const filtered = hooks.filter(
      (config) =>
        !config.hooks.some((hook) =>
          hook.command.includes("agent-recorder-hook")
        )
    );

    if (filtered.length < hooks.length) {
      removedCount += hooks.length - filtered.length;
      console.log(`  ✓ ${eventType}: removed`);
    }

    if (filtered.length === 0) {
      delete settings.hooks[eventType];
    } else {
      settings.hooks[eventType] = filtered;
    }
  }

  // Clean up empty hooks object
  if (Object.keys(settings.hooks).length === 0) {
    delete settings.hooks;
  }

  writeClaudeSettings(settingsPath, settings);

  console.log("");
  console.log(`Removed ${removedCount} Agent Recorder hooks.`);
  console.log("Restart Claude Code for changes to take effect.");
}

/** Show current hook installation status */
export async function hooksStatusCommand(): Promise<void> {
  const settingsPath = getClaudeSettingsPath();

  if (!fs.existsSync(settingsPath)) {
    console.log("Claude Code settings file not found.");
    console.log(`Expected: ${settingsPath}`);
    console.log("");
    console.log("Run 'agent-recorder hooks install' to set up hooks.");
    return;
  }

  const settings = readClaudeSettings(settingsPath);

  const hookTypes = [
    "PreToolUse",
    "PostToolUse",
    "Stop",
    "SubagentStop",
    "SessionStart",
    "SessionEnd",
  ];

  console.log("Agent Recorder Hook Status");
  console.log("==========================");
  console.log(`Settings file: ${settingsPath}`);
  console.log("");

  let installedCount = 0;

  for (const eventType of hookTypes) {
    const installed = isHookInstalled(settings, eventType);
    if (installed) {
      console.log(`  ✓ ${eventType}: installed`);
      installedCount++;
    } else {
      console.log(`  ✗ ${eventType}: not installed`);
    }
  }

  console.log("");
  console.log(`${installedCount}/${hookTypes.length} hooks installed`);

  if (installedCount === 0) {
    console.log("");
    console.log("Run 'agent-recorder hooks install' to set up hooks.");
  }
}
