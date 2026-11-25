// The teams surface: the module. Everything else in this folder is private.

export { teamsMongo } from "./models";
export { teamsModule, teamsOnRemoved } from "./module";
export { createTeam, getTeam, teamIdsOfMember } from "./services";
