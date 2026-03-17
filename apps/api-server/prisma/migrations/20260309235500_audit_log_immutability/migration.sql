-- Keep audit logs append-only for tamper evidence.
CREATE OR REPLACE FUNCTION branchline_prevent_audit_log_mutation()
RETURNS trigger
AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is immutable (% operation not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS branchline_audit_log_no_update ON "AuditLog";
CREATE TRIGGER branchline_audit_log_no_update
BEFORE UPDATE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION branchline_prevent_audit_log_mutation();

DROP TRIGGER IF EXISTS branchline_audit_log_no_delete ON "AuditLog";
CREATE TRIGGER branchline_audit_log_no_delete
BEFORE DELETE ON "AuditLog"
FOR EACH ROW
EXECUTE FUNCTION branchline_prevent_audit_log_mutation();
