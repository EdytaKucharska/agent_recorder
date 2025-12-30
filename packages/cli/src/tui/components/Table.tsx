/**
 * Scrollable table component with keyboard navigation.
 */

import React from "react";
import { Box, Text } from "ink";

export interface Column<T> {
  key: string;
  header: string;
  width: number;
  render: (row: T, index: number) => React.ReactNode;
}

export interface TableProps<T> {
  columns: Column<T>[];
  data: T[];
  selectedIndex: number;
  maxRows?: number;
}

/**
 * Render a table with columns and data.
 */
export function Table<T>({
  columns,
  data,
  selectedIndex,
  maxRows = 15,
}: TableProps<T>): React.ReactElement {
  // Calculate scroll offset to keep selected row visible
  const scrollOffset = Math.max(
    0,
    Math.min(selectedIndex - Math.floor(maxRows / 2), data.length - maxRows)
  );

  const visibleData = data.slice(scrollOffset, scrollOffset + maxRows);

  return (
    <Box flexDirection="column">
      {/* Header row */}
      <Box>
        <Text dimColor>{"  "}</Text>
        {columns.map((col) => (
          <Box key={col.key} width={col.width}>
            <Text bold dimColor>
              {col.header.padEnd(col.width)}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Data rows */}
      {visibleData.map((row, i) => {
        const actualIndex = scrollOffset + i;
        const isSelected = actualIndex === selectedIndex;

        return (
          <Box key={actualIndex}>
            {isSelected ? (
              <Text color="cyan">{"> "}</Text>
            ) : (
              <Text>{"  "}</Text>
            )}
            {columns.map((col) => (
              <Box key={col.key} width={col.width}>
                {isSelected ? (
                  <Text color="cyan">{col.render(row, actualIndex)}</Text>
                ) : (
                  col.render(row, actualIndex)
                )}
              </Box>
            ))}
          </Box>
        );
      })}

      {/* Scroll indicator */}
      {data.length > maxRows && (
        <Text dimColor>
          {"  "}Showing {scrollOffset + 1}-
          {Math.min(scrollOffset + maxRows, data.length)} of {data.length}
        </Text>
      )}
    </Box>
  );
}
