/**
 * Status badge component for sessions and events.
 */

import React from "react";
import { Text } from "ink";

export interface StatusBadgeProps {
  status: string;
}

/**
 * Display a colored status indicator.
 */
export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  switch (status) {
    case "active":
    case "running":
      return <Text color="green">●</Text>;
    case "completed":
    case "success":
      return <Text color="gray">○</Text>;
    case "error":
      return <Text color="red">●</Text>;
    case "timeout":
      return <Text color="yellow">●</Text>;
    case "cancelled":
      return <Text color="gray">◌</Text>;
    default:
      return <Text color="gray">?</Text>;
  }
}

/**
 * Display a status indicator with label.
 */
export function StatusWithLabel({
  status,
}: StatusBadgeProps): React.ReactElement {
  const label = status.charAt(0).toUpperCase() + status.slice(1);

  switch (status) {
    case "active":
    case "running":
      return (
        <Text>
          <Text color="green">●</Text> <Text color="green">{label}</Text>
        </Text>
      );
    case "completed":
    case "success":
      return (
        <Text>
          <Text color="gray">○</Text> <Text color="gray">{label}</Text>
        </Text>
      );
    case "error":
      return (
        <Text>
          <Text color="red">●</Text> <Text color="red">{label}</Text>
        </Text>
      );
    case "timeout":
      return (
        <Text>
          <Text color="yellow">●</Text> <Text color="yellow">{label}</Text>
        </Text>
      );
    case "cancelled":
      return (
        <Text>
          <Text color="gray">◌</Text> <Text color="gray">{label}</Text>
        </Text>
      );
    default:
      return (
        <Text>
          <Text color="gray">?</Text> <Text>{label}</Text>
        </Text>
      );
  }
}
