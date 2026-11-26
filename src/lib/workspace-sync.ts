import type { SupabaseClient } from "@supabase/supabase-js";

export function startWorkspaceSync(client: SupabaseClient, userId: string, refresh: () => void, enabled: () => boolean) {
  let stopped = false;
  let debounce: ReturnType<typeof setTimeout>;
  const update = () => { if (!stopped && enabled()) refresh(); };
  const schedule = () => {
    if (stopped) return;
    clearTimeout(debounce);
    debounce = setTimeout(update, 250);
  };
  const channel = client.channel(`workspace-${userId}`);
  for (const table of ["memberships", "join_requests", "quantity_requests", "product_requests", "inventory_items", "audit_events"]) {
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table }, schedule);
    channel.on("postgres_changes", { event: "UPDATE", schema: "public", table }, schedule);
  }
  channel.subscribe(status => { if (status === "SUBSCRIBED") schedule(); });
  const interval = setInterval(update, 5_000);
  return () => {
    stopped = true;
    clearTimeout(debounce);
    clearInterval(interval);
    void client.removeChannel(channel);
  };
}
