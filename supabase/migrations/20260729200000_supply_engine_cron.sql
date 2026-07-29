-- SPEC-99: the autonomous supply engine. Measures per-source yield, auto-disables dead
-- sources, requeues recoverable failures, keeps the phase-1 queue saturated, turbo-kicks
-- the worker, and publishes the live counter. Every 10 minutes, no founder.
select cron.schedule('cergio_supply_engine', '*/10 * * * *', $$ select public.cergio_call_edge('supply-engine'); $$);
