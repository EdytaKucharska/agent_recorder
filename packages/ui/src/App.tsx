import React, { useState } from "react";
import { SessionList } from "./components/SessionList.js";
import { SessionDetail } from "./components/SessionDetail.js";

export function App() {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    null
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1>
          <button
            className="nav-home-button"
            onClick={() => setSelectedSessionId(null)}
          >
            Agent Recorder
          </button>
        </h1>
        {selectedSessionId && (
          <button
            className="back-button"
            onClick={() => setSelectedSessionId(null)}
          >
            &larr; Sessions
          </button>
        )}
      </header>
      <main className="app-main">
        {selectedSessionId ? (
          <SessionDetail sessionId={selectedSessionId} />
        ) : (
          <SessionList onSelect={setSelectedSessionId} />
        )}
      </main>
    </div>
  );
}
