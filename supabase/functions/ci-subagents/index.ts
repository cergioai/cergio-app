// SPEC-220 — the latest run of every CI subagent, for the in-product dashboard.
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };
const DEFAULT_ADMINS = ['t@cergio.ai'];
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const svc = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization');
    if (!auth) return json({ error: 'Not signed in' }, 401);
    const asUser = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: u } = await asUser.auth.getUser();
    const email = (u?.user?.email || '').toLowerCase();
    const admins = (Deno.env.get('ADMIN_EMAILS') || DEFAULT_ADMINS.join(',')).split(',').map((s) => s.trim().toLowerCase());
    if (!email || !admins.includes(email)) return json({ error: 'Forbidden' }, 403);

    const db = createClient(url, svc);
    const { data: rows, error } = await db.from('ci_subagent_runs').select('*').order('ran_at', { ascending: false }).limit(2000);
    if (error) return json({ error: error.message }, 500);

    // Latest run per agent — the dashboard shows NOW, the history is for the download.
    const latest: Record<string, any> = {};
    for (const r of (rows || [])) if (!latest[r.agent]) latest[r.agent] = r;
    const list = Object.values(latest).sort((a: any, b: any) => (a.priority || 99) - (b.priority || 99));
    const green = list.filter((r: any) => r.verdict === 'GREEN').length;
    return json({
      agents: list, history: rows || [],
      summary: { total: list.length, green, needs_work: list.filter((r: any) => r.verdict === 'NEEDS WORK').length,
                 cannot_run: list.filter((r: any) => r.verdict === 'CANNOT RUN').length,
                 defects: list.reduce((a: number, r: any) => a + (r.defects || 0), 0),
                 fixed_24h: (rows || []).filter((r: any) => r.work_state === 'FIXED' && Date.now() - new Date(r.ran_at).getTime() < 864e5).length },
      last_run: list[0]?.ran_at || null,
    });
  } catch (e) { return json({ error: String(e).slice(0, 300) }, 500); }
});
