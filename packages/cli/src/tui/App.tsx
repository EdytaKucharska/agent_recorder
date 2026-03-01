/**
 * Main TUI application with screen routing.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { BaseEvent } from "@agent-recorder/core";
import { getActualListenPort } from "@agent-recorder/core";
import { SessionsScreen, SessionDetailScreen } from "./screens/index.js";
import { EventInspectPanel } from "./components/EventInspectPanel.js";
import { checkDaemonHealth } from "./api.js";
import { Spinner } from "./components/index.js";

type Screen = "loading" | "error" | "sessions" | "detail" | "inspect";

interface AppState {
  screen: Screen;
  selectedSessionId: string | null;
  selectedEvent: BaseEvent | null;
  error: string | null;
}

export function App(): React.ReactElement {
  const baseUrl = `http://127.0.0.1:${getActualListenPort()}`;

  const [state, setState] = useState<AppState>({
    screen: "loading",
    selectedSessionId: null,
    selectedEvent: null,
    error: null,
  });

  // Check daemon health on startup
  useEffect(() => {
    async function checkHealth() {
      const health = await checkDaemonHealth(baseUrl);
      if (health.running) {
        setState((prev) => ({ ...prev, screen: "sessions" }));
      } else {
        setState((prev) => ({
          ...prev,
          screen: "error",
          error: health.error ?? "Daemon not running",
        }));
      }
    }
    checkHealth();
  }, [baseUrl]);

  const handleSelectSession = (sessionId: string) => {
    setState((prev) => ({
      ...prev,
      screen: "detail",
      selectedSessionId: sessionId,
    }));
  };

  const handleBack = () => {
    if (state.screen === "inspect") {
      setState((prev) => ({
        ...prev,
        screen: "detail",
        selectedEvent: null,
      }));
    } else {
      setState((prev) => ({
        ...prev,
        screen: "sessions",
        selectedSessionId: null,
      }));
    }
  };

  const handleInspectEvent = (event: BaseEvent) => {
    setState((prev) => ({
      ...prev,
      screen: "inspect",
      selectedEvent: event,
    }));
  };

  // Render based on current screen
  switch (state.screen) {
    case "loading":
      return (
        <Box flexDirection="column">
          <Spinner label="Connecting to daemon..." />
        </Box>
      );

    case "error":
      return (
        <Box flexDirection="column">
          <Text bold color="red">
            Connection Error
          </Text>
          <Box marginTop={1}>
            <Text>{state.error}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Make sure the daemon is running:</Text>
          </Box>
          <Box marginLeft={2}>
            <Text color="cyan">agent-recorder start --daemon</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Press Ctrl+C to exit.</Text>
          </Box>
        </Box>
      );

    case "sessions":
      return (
        <SessionsScreen
          baseUrl={baseUrl}
          onSelectSession={handleSelectSession}
        />
      );

    case "detail":
      return (
        <SessionDetailScreen
          baseUrl={baseUrl}
          sessionId={state.selectedSessionId!}
          onBack={handleBack}
          onInspectEvent={handleInspectEvent}
        />
      );

    case "inspect":
      return (
        <EventInspectPanel event={state.selectedEvent!} onClose={handleBack} />
      );

    default:
      return <Text>Unknown screen</Text>;
  }
}
