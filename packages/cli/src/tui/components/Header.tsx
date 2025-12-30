/**
 * Header component with title and keyboard hints.
 */

import React from "react";
import { Box, Text } from "ink";

export interface KeyHint {
  key: string;
  label: string;
}

export interface HeaderProps {
  title: string;
  hints?: KeyHint[];
}

/**
 * Screen header with title and keyboard hints.
 */
export function Header({ title, hints = [] }: HeaderProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text bold>{title}</Text>
        <Box>
          {hints.map((hint, i) => (
            <Text key={hint.key}>
              <Text color="cyan">[{hint.key}]</Text>{" "}
              <Text dimColor>{hint.label}</Text>
              {i < hints.length - 1 ? "  " : ""}
            </Text>
          ))}
        </Box>
      </Box>
      <Text dimColor>{"─".repeat(66)}</Text>
    </Box>
  );
}
