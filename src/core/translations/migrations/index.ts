import { authValidationErrors } from "./2026-11-13-auth-validation-errors.migration";

// The core database's migrations, in order. The list only grows at its end; an
// id is permanent. `db:migrate` applies them (src/scripts/db-migrate.ts).
export const translationMigrations = [authValidationErrors];
