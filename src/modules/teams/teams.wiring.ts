// What the app hands down to the teams module, which cannot import the
// modules that hold things named after a team (src/config/wiring.ts).

// Told after a team was deleted, with the workspace's database: `shares` ends
// the grants made to the team.
export type TeamDeletedListener = (
  database: unknown,
  team: { id: string },
) => Promise<void>;

export interface TeamsWiring {
  onDeleted: readonly TeamDeletedListener[];
}

// Tells every listener that the team is gone. A listener that fails is logged
// and never undoes the deletion nor stops the others: a deleted team reaches
// nobody, so a grant left on it has no effect.
export async function teamDeleted(
  wiring: TeamsWiring,
  database: unknown,
  team: { id: string },
): Promise<void> {
  for (const listener of wiring.onDeleted) {
    try {
      await listener(database, team);
    } catch (error) {
      console.error(
        `storix-api: team ${team.id} was deleted but a clean-up failed:`,
        error,
      );
    }
  }
}
