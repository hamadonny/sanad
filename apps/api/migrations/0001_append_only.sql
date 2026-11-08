-- Spec §6 / §3: ledger entries and the audit log are append-only.
-- Corrections are made with reversing transactions, never by editing rows.
CREATE OR REPLACE FUNCTION sanad_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'table % is append-only (% not allowed)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER ledger_transactions_append_only BEFORE UPDATE OR DELETE ON ledger_transactions
  FOR EACH ROW EXECUTE FUNCTION sanad_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER ledger_entries_append_only BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION sanad_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION sanad_forbid_mutation();
--> statement-breakpoint
CREATE TRIGGER circle_events_append_only BEFORE UPDATE OR DELETE ON circle_events
  FOR EACH ROW EXECUTE FUNCTION sanad_forbid_mutation();
--> statement-breakpoint
-- Every ledger transaction must balance. Checked at COMMIT so all entries of a transaction
-- can be inserted first.
CREATE OR REPLACE FUNCTION sanad_check_balanced() RETURNS trigger AS $$
DECLARE total bigint;
BEGIN
  SELECT COALESCE(SUM(amount_fils), 0) INTO total FROM ledger_entries WHERE transaction_key = NEW.transaction_key;
  IF total <> 0 THEN
    RAISE EXCEPTION 'ledger transaction % does not balance (%)', NEW.transaction_key, total;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER ledger_entries_balanced AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION sanad_check_balanced();
