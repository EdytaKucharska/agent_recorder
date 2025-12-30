/**
 * TUI command - interactive session explorer.
 */

export async function tuiCommand(): Promise<void> {
  // Dynamic imports to avoid loading React unless needed
  const { render } = await import("ink");
  const React = await import("react");
  const { App } = await import("../tui/App.js");

  // Render the TUI app
  const { waitUntilExit } = render(React.createElement(App));

  // Wait for the app to exit
  await waitUntilExit();
}
