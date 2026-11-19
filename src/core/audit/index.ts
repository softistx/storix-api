// The audit surface: the `Auditor` port every module calls, its factory, and the module. Everything else in this folder is
// private.

export {
  type AuditActor,
  type AuditEventInput,
  type AuditMeta,
  type Auditor,
  type AuditSink,
  createAuditor,
  memberActor,
} from "./audit.record";
export { auditModule } from "./module";
