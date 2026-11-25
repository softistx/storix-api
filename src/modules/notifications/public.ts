// The notifications surface: the module, the notifier the app builds and the
// mail sending it needs. Everything else in this folder is private.
export { notificationsModule, notificationsOnRemoved } from "./module";
export {
  Notifier,
  type NotifierDeps,
} from "./services";
export {
  directSender,
  type MailSender,
  mailsHandler,
  queuedSender,
} from "./utils";
