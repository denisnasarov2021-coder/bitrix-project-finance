-- Database triggers keep the financial write and its audit event atomic.
CREATE TRIGGER entries_after_insert AFTER INSERT ON entries
BEGIN
  INSERT INTO audit (tenant, project_id, entity_id, action, actor_id, before_json, after_json, created_at)
  VALUES (NEW.tenant, NEW.project_id, NEW.id, 'entry_create', NEW.created_by, NULL,
    json_object('amount',NEW.amount,'category_id',NEW.category_id,'date',NEW.date,'note',NEW.note,'version',NEW.version), NEW.created_at);
END;
--> statement-breakpoint
CREATE TRIGGER entries_after_update AFTER UPDATE ON entries
BEGIN
  INSERT INTO audit (tenant, project_id, entity_id, action, actor_id, before_json, after_json, created_at)
  VALUES (NEW.tenant, NEW.project_id, NEW.id,
    CASE WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN 'entry_delete' ELSE 'entry_update' END,
    NEW.updated_by,
    json_object('amount',OLD.amount,'category_id',OLD.category_id,'date',OLD.date,'note',OLD.note,'version',OLD.version),
    json_object('amount',NEW.amount,'category_id',NEW.category_id,'date',NEW.date,'note',NEW.note,'version',NEW.version), NEW.updated_at);
END;
