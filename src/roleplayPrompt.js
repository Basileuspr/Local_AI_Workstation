export const defaultRoleplayConfig = {
  enabled: false,
  characterName: "",
  userName: "",
  greeting: "",
  description: "",
  scenario: "",
  exampleDialogs: "",
  preHistoryInstructions: "",
  postHistoryInstructions: "",
  characterSystemPrompt: "",
  characterPostHistoryInstruction: "",
  characterNote: "",
  includeNames: true,
  banEmojis: false,
};

function section(title, value) {
  const text = String(value || "").trim();
  return text ? `${title}:\n${text}` : "";
}

export function mergeRoleplayConfig(config) {
  return { ...defaultRoleplayConfig, ...(config || {}) };
}

export function buildRoleplaySystemPrompt(basePrompt, config) {
  const roleplay = mergeRoleplayConfig(config);
  const base = String(basePrompt || "").trim();

  if (!roleplay.enabled) return base || null;

  const characterName = roleplay.characterName.trim() || "the character";
  const userName = roleplay.userName.trim() || "the user";

  const parts = [
    base,
    "Roleplay mode is enabled. Stay in character unless the user explicitly asks to pause or change the setup.",
    roleplay.includeNames
      ? `Character name: ${characterName}\nUser name: ${userName}`
      : `Character name: ${characterName}`,
    section("Pre-history instructions", roleplay.preHistoryInstructions),
    section("Character description", roleplay.description),
    section("Greeting", roleplay.greeting),
    section("Scenario", roleplay.scenario),
    section("Example dialogs", roleplay.exampleDialogs),
    section("Character system prompt", roleplay.characterSystemPrompt),
    section("Character note", roleplay.characterNote),
    section("Post-history instructions", roleplay.postHistoryInstructions),
    section("Character post-history instruction", roleplay.characterPostHistoryInstruction),
    roleplay.banEmojis ? "Do not use emoji in roleplay responses." : "",
  ];

  return parts.filter(Boolean).join("\n\n");
}
