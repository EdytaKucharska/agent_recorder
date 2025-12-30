/**
 * Loading spinner component.
 */

import React, { useState, useEffect } from "react";
import { Text } from "ink";

const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export interface SpinnerProps {
  label?: string;
}

/**
 * Animated loading spinner.
 */
export function Spinner({ label }: SpinnerProps): React.ReactElement {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((prev) => (prev + 1) % frames.length);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  return (
    <Text>
      <Text color="cyan">{frames[frame]}</Text>
      {label && <Text> {label}</Text>}
    </Text>
  );
}
