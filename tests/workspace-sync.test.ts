import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startWorkspaceSync } from "../src/lib/workspace-sync";

function setup() {
  vi.useFakeTimers();
  const handlers: { table: string; event: string; callback: () => void }[] = [];
  let statusCallback: (status: string) => void = () => {};
  const channel = {
    on: vi.fn((_type: string, filter: { table: string; event: string }, callback: () => void) => {
      handlers.push({ ...filter, callback }); return channel;
    }),
    subscribe: vi.fn((callback: (status: string) => void) => { statusCallback = callback; return channel; }),
  };
  const client = { channel: vi.fn(() => channel), removeChannel: vi.fn(async () => "ok") };
  const refresh = vi.fn();
  const enabled = vi.fn(() => true);
  const stop = startWorkspaceSync(client as unknown as SupabaseClient, "user-id", refresh, enabled);
  return { client, channel, handlers, refresh, enabled, stop, status: (status: string) => statusCallback(status) };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe("workspace synchronization", () => {
  it("subscribes to RLS-protected insert/update events and debounces a transaction's changes", () => {
    const sync = setup();
    expect(sync.handlers).toHaveLength(10);
    expect(sync.handlers.map(handler => handler.event)).not.toContain("DELETE");
    expect(new Set(sync.handlers.map(handler => handler.table))).toEqual(new Set(["memberships", "join_requests", "quantity_requests", "inventory_items", "audit_events"]));
    for (const handler of sync.handlers) handler.callback();
    vi.advanceTimersByTime(249); expect(sync.refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1); expect(sync.refresh).toHaveBeenCalledTimes(1);
    sync.stop();
  });
  it("refreshes after reconnection and polls when realtime is unavailable", () => {
    const sync = setup();
    sync.status("CHANNEL_ERROR");
    vi.advanceTimersByTime(5_000); expect(sync.refresh).toHaveBeenCalledTimes(1);
    sync.status("SUBSCRIBED");
    vi.advanceTimersByTime(250); expect(sync.refresh).toHaveBeenCalledTimes(2);
    sync.stop();
  });
  it("does not overlap writes/refreshes or update hidden pages, but catches up on the next poll", () => {
    const sync = setup();
    sync.enabled.mockReturnValue(false);
    sync.handlers[0].callback(); vi.advanceTimersByTime(10_000);
    expect(sync.refresh).not.toHaveBeenCalled();
    sync.enabled.mockReturnValue(true); vi.advanceTimersByTime(5_000);
    expect(sync.refresh).toHaveBeenCalledTimes(1);
    sync.stop();
  });
  it("removes listeners and timers on unmount, ignoring late callbacks", () => {
    const sync = setup();
    sync.handlers[0].callback(); sync.stop();
    sync.status("SUBSCRIBED"); sync.handlers[0].callback();
    vi.advanceTimersByTime(20_000);
    expect(sync.refresh).not.toHaveBeenCalled();
    expect(sync.client.removeChannel).toHaveBeenCalledWith(sync.channel);
  });
});
