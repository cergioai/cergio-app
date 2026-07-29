// Supabase Edge Function — EARLY OFFERS (SPEC-95). Public browse of founding
// members who OPTED IN: services offering a free service, creators offering a free
// IG spotlight. Lets a visitor request one directly instead of searching.
// Reads leads_* past RLS but returns ONLY safe public fields (no email/phone —
// contact happens through Cergio, never by exposing scraped contact data).
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4?target=deno&deno-std=0.224.0';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } }); }

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const city: string | null = body.city || null;
    const limit = Math.min(Number(body.limit) || 60, 120);

    // SERVICES offering a free service (opted in)
    let sq = db.from('leads_services')
      .select('id, name, service_type, city, state, instagram, website_url')
      .eq('outreach_status', 'opted_in').limit(limit);
    if (city) sq = sq.ilike('city', `%${city}%`);
    const { data: services } = await sq;

    // CREATORS offering a free spotlight (opted in)
    let cq = db.from('leads_influencers')
      .select('id, ig_handle, display_name, category, followers, city, state')
      .eq('outreach_status', 'opted_in').order('followers', { ascending: false }).limit(limit);
    if (city) cq = cq.ilike('city', `%${city}%`);
    const { data: creators } = await cq;

    // cities available (for the filter)
    const cities = Array.from(new Set([...(services || []).map((s: any) => s.city), ...(creators || []).map((c: any) => c.city)].filter(Boolean))).sort();

    return json({
      services: (services || []).map((s: any) => ({ id: s.id, name: s.name, service_type: s.service_type, city: s.city, state: s.state, instagram: s.instagram || null, offer: 'free service' })),
      creators: (creators || []).map((c: any) => ({ id: c.id, handle: c.ig_handle, name: c.display_name, category: c.category, followers: c.followers, city: c.city, state: c.state, offer: 'free IG spotlight' })),
      cities,
      counts: { services: (services || []).length, creators: (creators || []).length },
    });
  } catch (e) { return json({ error: String(e).slice(0, 300) }, 500); }
});
