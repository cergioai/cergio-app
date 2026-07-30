// Supabase Edge Function — OPS CONSOLE (SPEC-94). ONE admin endpoint that answers
// "is everything actually working?" across QA, crawls, agents and data — reading
// past RLS server-side. Backs /ops/status. Admin-JWT gated. Read-only.
//
// The payload itself lives in ../_shared/opsPayload.ts because this function is
// NOT in the CI deploy array (see that file's header) — `admin-crawl-status`
// serves the identical payload at { view: 'ops' } so the dashboard keeps working
// off-Mac. Both stay in lockstep by construction.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
import { buildOpsPayload, isAdminEmail } from '../_shared/opsPayload.ts';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Not signed in' }, 401);
    const asUser = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data: u } = await asUser.auth.getUser();
    const email = (u?.user?.email || '').toLowerCase();
    // Report WHICH email was rejected — a bare "Forbidden" cost a debugging round-trip.
    if (!isAdminEmail(email, Deno.env.get('ADMIN_EMAILS'))) return json({ error: 'Forbidden', signed_in_as: email || null, hint: 'this email is not in the ops allowlist' }, 403);

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch (_e) { body = {}; }
    const db = createClient(url, svc);
    const payload = await buildOpsPayload(db, body);
    return json({ ...payload, served_by: 'ops-console' });
  } catch (e) { return json({ error: String(e).slice(0, 300) }, 500); }
});
