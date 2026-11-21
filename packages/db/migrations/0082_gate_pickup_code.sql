-- Child pick-up with a code to the parent (rule book §13.8 Visitors & Gate › Student Pick-up,
-- P1). An early-leave pass now carries a one-time code sent to the child's guardians; the guard
-- types it before the child leaves. Only a hash is kept; five wrong tries lock the pass.
-- Expand only: passes issued before this have no code and leave as before.
ALTER TABLE gate_pass
  ADD COLUMN pickup_code_hash text CHECK (pickup_code_hash IS NULL OR pickup_code_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN code_tries integer NOT NULL DEFAULT 0 CHECK (code_tries BETWEEN 0 AND 5);
