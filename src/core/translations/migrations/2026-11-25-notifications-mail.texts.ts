import type { Texts } from "@softistx/alxia-i18n";

// Frozen with the migration that writes it: a later wording is a later
// migration, never an edit here. The notification mails, in the recipient's
// language; ICU messages, French uses ’ so that no apostrophe quotes a brace.
export const texts: Texts = {
  "notifications.mail.shared.subject": {
    en: "{actor} shared “{node}” with you",
    fr: "{actor} a partagé « {node} » avec vous",
  },
  "notifications.mail.shared.body": {
    en: "{actor} shared “{node}” with you. Your role is {role}.",
    fr: "{actor} a partagé « {node} » avec vous. Votre rôle est {role}.",
  },
  "notifications.mail.role-changed.subject": {
    en: "Your access to “{node}” changed",
    fr: "Votre accès à « {node} » a changé",
  },
  "notifications.mail.role-changed.body": {
    en: "{actor} changed your access to “{node}”. Your role is now {role}.",
    fr: "{actor} a modifié votre accès à « {node} ». Votre rôle est désormais {role}.",
  },
  "notifications.mail.role.editor": { en: "editor", fr: "éditeur" },
  "notifications.mail.role.viewer": { en: "viewer", fr: "lecteur" },
  "notifications.mail.quota.subject": {
    en: "{workspace} has used {percent}% of its storage",
    fr: "{workspace} a utilisé {percent} % de son espace de stockage",
  },
  "notifications.mail.quota.body": {
    en: "The workspace {workspace} has used {percent}% of its storage quota.",
    fr: "L’espace de travail {workspace} a utilisé {percent} % de son quota de stockage.",
  },
};
