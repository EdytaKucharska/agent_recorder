/**
 * Atomic sequence number allocation for sessions.
 * Uses session_sequences table to ensure unique, monotonically increasing sequences.
 */

import type Database from "better-sqlite3";

/**
 * Allocate the next sequence number for a session atomically.
 * Creates the session_sequences row if it doesn't exist.
 * Returns the allocated sequence number.
 */
export function allocateSequence(
  db: Database.Database,
  sessionId: string
): number {
  // Use a transaction to ensure atomicity
  const allocate = db.transaction(() => {
    // Try to insert a new row, or get the current sequence
    const upsertStmt = db.prepare(`
      INSERT INTO session_sequences (session_id, next_sequence)
      VALUES (?, 1)
      ON CONFLICT(session_id) DO UPDATE SET next_sequence = next_sequence
    `);
    upsertStmt.run(sessionId);

    // Get and increment the sequence atomically
    const updateStmt = db.prepare(`
      UPDATE session_sequences
      SET next_sequence = next_sequence + 1
      WHERE session_id = ?
      RETURNING next_sequence - 1 as allocated_sequence
    `);
    const result = updateStmt.get(sessionId) as { allocated_sequence: number };
    return result.allocated_sequence;
  });

  return allocate();
}

/**
 * Get the current next sequence number for a session without allocating.
 * Returns null if session has no sequence record.
 */
export function getCurrentSequence(
  db: Database.Database,
  sessionId: string
): number | null {
  const stmt = db.prepare(
    "SELECT next_sequence FROM session_sequences WHERE session_id = ?"
  );
  const row = stmt.get(sessionId) as { next_sequence: number } | undefined;
  return row ? row.next_sequence : null;
}
