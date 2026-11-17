// Session 03 · Exercise 3 — protected write path for numeric corrections on a close-approach record.
// Deployed as Edge Function "orbit-watch-corrections" with Verify JWT OFF: it does its own check instead.
// Secret (Supabase → Edge Functions → Secrets): LAB_ACCESS_KEY, the same lab password as in Vercel.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase and never leave this server.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const LAB = Deno.env.get("LAB_ACCESS_KEY") ?? "";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

async function sha(t: string) { return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t))); }
async function same(a: string, b: string) { const [x, y] = [await sha(a), await sha(b)]; let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i]; return d === 0; }
const labOk = LAB.length >= 32 && LAB.length <= 256;

async function readRecord(id: string) {
  const { data, error } = await db.from("fact_conjunction").select("conjunction_id,pc,risk_tier,revision,status").eq("conjunction_id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (req) => {
  try {
    if (req.method === "GET") return json(200, { function: "orbit-watch-corrections", lab_key_configured: labOk });
    if (req.method !== "POST") return json(405, { status: "method_not_allowed" });
    if (!labOk) return json(503, { status: "not_configured", missing: ["LAB_ACCESS_KEY (Supabase Edge Function secret)"] });
    const h = req.headers.get("Authorization") ?? "";
    if (!h.startsWith("Bearer ") || !(await same(h.slice(7), LAB))) return json(401, { status: "rejected", message: "Lab access key not accepted by the database function." });
    const b = await req.json();
    if (!UUID.test(String(b.request_id ?? ""))) return json(400, { status: "invalid", message: "Missing request ID." });
    if (typeof b.conjunction_id !== "string" || !/^C\d{6}$/.test(b.conjunction_id)) return json(400, { status: "invalid", message: "Unknown record." });
    const { data, error } = await db.rpc("apply_conjunction_correction", {
      p_conjunction_id: b.conjunction_id, p_field: b.field, p_expected_value: Number(b.expected_value), p_expected_revision: Number(b.expected_revision),
      p_new_value: Number(b.new_value), p_reason: String(b.reason ?? ""), p_request_id: b.request_id,
    });
    if (error) return json(500, { status: "error", message: error.message });
    // independent read of the stored row, separate from the write
    const readback = await readRecord(b.conjunction_id);
    const code = data.status === "saved" || data.status === "duplicate" ? 200 : data.status === "conflict" ? 409 : data.status === "not_found" ? 404 : 400;
    return json(code, { ...data, readback, read_at: new Date().toISOString() });
  } catch (e) {
    return json(500, { status: "unknown", message: `${(e as Error).message}. Read the record again before retrying.` });
  }
});
