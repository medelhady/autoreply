import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The customer panel has no login: the secret is in the link itself (/panel/<key>), long and random,
 * unguessable like a shared-document link. Whoever holds the link manages that one business.
 */

export type PanelBusiness = {
  id: string;
  name: string;
  phone_number_id: string;
  fallback_text: string | null;
};

const keyShape = /^[a-f0-9]{36}$/;

/** The active business behind a link, or null for a wrong, malformed or paused link. */
export async function findPanelBusiness(supabase: SupabaseClient, key: string): Promise<PanelBusiness | null> {
  if (!keyShape.test(key)) {
    return null;
  }

  const { data } = await supabase
    .from("businesses")
    .select("id, name, phone_number_id, fallback_text")
    .eq("panel_key", key)
    .eq("active", true)
    .maybeSingle<PanelBusiness>();

  return data ?? null;
}
