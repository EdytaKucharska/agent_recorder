/**
 * Token roll-up: builds a hierarchical event tree from a flat list of BaseEvent
 * and computes recursive token sums at each node.
 *
 * Pure functions — no DB access, fully testable in isolation.
 */

import type { BaseEvent, EventType } from "@agent-recorder/types";

/** A BaseEvent enriched with children and rolled-up token counts */
export interface EventNode extends BaseEvent {
  children: EventNode[];
  /** Tokens directly on this event (not counting descendants) */
  selfInputTokens: number;
  selfOutputTokens: number;
  /** Recursive sum of all descendant tokens */
  childrenInputTokens: number;
  childrenOutputTokens: number;
  /** Total: self + all descendants */
  totalInputTokens: number;
  totalOutputTokens: number;
}

/**
 * Build a tree from a flat BaseEvent[].
 * Events must be ordered by sequence ASC (as returned by getEventsBySession).
 *
 * @param events   Flat list ordered by sequence
 * @param maxDepth Maximum tree depth to include (1 = root only, 10 = full)
 * @param filterTypes If provided, only include nodes of these types (keeping ancestors)
 */
export function buildEventTree(
  events: BaseEvent[],
  maxDepth: number = 10,
  filterTypes?: EventType[]
): EventNode[] {
  // Index children by parentEventId
  const childMap = new Map<string | null, BaseEvent[]>();
  for (const event of events) {
    const key = event.parentEventId ?? null;
    let list = childMap.get(key);
    if (!list) {
      list = [];
      childMap.set(key, list);
    }
    list.push(event);
  }

  const typeSet = filterTypes ? new Set(filterTypes) : null;

  function buildNode(event: BaseEvent, depth: number): EventNode | null {
    const selfInputTokens = event.inputTokens ?? 0;
    const selfOutputTokens = event.outputTokens ?? 0;

    // Build children first (needed for rollup even if we prune this node)
    const rawChildren = childMap.get(event.id) ?? [];
    const children: EventNode[] =
      depth < maxDepth
        ? rawChildren
            .map((child) => buildNode(child, depth + 1))
            .filter((n): n is EventNode => n !== null)
        : [];

    // Compute rollup
    let childrenInputTokens = 0;
    let childrenOutputTokens = 0;
    for (const child of children) {
      childrenInputTokens += child.totalInputTokens;
      childrenOutputTokens += child.totalOutputTokens;
    }

    const node: EventNode = {
      ...event,
      children,
      selfInputTokens,
      selfOutputTokens,
      childrenInputTokens,
      childrenOutputTokens,
      totalInputTokens: selfInputTokens + childrenInputTokens,
      totalOutputTokens: selfOutputTokens + childrenOutputTokens,
    };

    // Apply type filter: keep node if it matches OR if it has matching descendants
    if (typeSet) {
      const hasMatchingDescendant = children.length > 0;
      const selfMatches = typeSet.has(event.eventType);
      if (!selfMatches && !hasMatchingDescendant) return null;
    }

    return node;
  }

  // Roots are events with no parent or whose parent is not in this set
  const eventIds = new Set(events.map((e) => e.id));
  const roots = events.filter(
    (e) => e.parentEventId === null || !eventIds.has(e.parentEventId)
  );

  return roots
    .map((root) => buildNode(root, 1))
    .filter((n): n is EventNode => n !== null);
}

/**
 * Strip inputJson/outputJson from all nodes in a tree.
 * Used when include_io=false (the default).
 */
export function stripIoFromTree(nodes: EventNode[]): EventNode[] {
  return nodes.map((node) => ({
    ...node,
    inputJson: null,
    outputJson: null,
    children: stripIoFromTree(node.children),
  }));
}
