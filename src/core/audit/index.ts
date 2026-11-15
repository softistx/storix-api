// The audit surface: the `audit.record` port every module calls, the binding the
// server's wiring does, and the module. Everything else in this folder is
// private.

export {
  type AuditActor,
  type AuditEventInput,
  type AuditMeta,
  type AuditSink,
  audit,
  bindAudit,
  memberActor,
} from "./audit.record";
export { auditModule } from "./module";
