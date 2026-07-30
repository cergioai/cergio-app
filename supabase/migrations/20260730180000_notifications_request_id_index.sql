-- SPEC-119: the notification poll times out, so the provider dot never appears.
--
-- MEASURED live 2026-07-30 on a real request (77c1e152-cfb8-4b4d-bbd5-e0e19dc4a3e8),
-- reproduced three times in one page load:
--   GET  /notifications?select=created_at&data->>request_id=eq.<id>            -> 200
--   HEAD /notifications?select=id&data->>request_id=eq.<id>&kind=eq.new_request -> 503
--
-- The filter is on a JSON expression (data->>'request_id') with no supporting
-- index, so Postgres sequential-scans the whole notifications table and the
-- statement times out. PostgREST surfaces that as 503. The request row and the
-- notification may both exist — the UI simply can never read them.
--
-- Expression index on the exact predicate the client sends, plus kind.
create index if not exists notifications_request_id_kind_idx
  on public.notifications ((data->>'request_id'), kind);

-- The same poll orders by created_at for the "latest notification" read.
create index if not exists notifications_request_id_created_idx
  on public.notifications ((data->>'request_id'), created_at desc);

analyze public.notifications;
