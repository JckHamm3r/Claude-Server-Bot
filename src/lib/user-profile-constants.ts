export type ExperienceLevel = "beginner" | "intermediate" | "expert";

export interface ServerPurpose {
  id: string;
  label: string;
  description: string;
}

export const SERVER_PURPOSES: ServerPurpose[] = [
  { id: "personal-website", label: "Personal website or blog", description: "A personal site, portfolio, or blog" },
  { id: "business-website", label: "Business website", description: "A company landing page or marketing site" },
  { id: "web-app", label: "Web application", description: "A custom app with users, logins, or data" },
  { id: "ecommerce", label: "E-commerce / online store", description: "Selling products or services online" },
  { id: "api-backend", label: "API or backend service", description: "A REST API, microservice, or data service" },
  { id: "mail-server", label: "Mail server", description: "Sending and receiving email (e.g. Postfix)" },
  { id: "database-server", label: "Database server", description: "Hosting a database (MySQL, Postgres, etc.)" },
  { id: "file-server", label: "File or media server", description: "Storing and serving files or media" },
  { id: "game-server", label: "Game server", description: "Running a multiplayer game server" },
  { id: "home-lab", label: "Home lab or self-hosted apps", description: "Self-hosted tools and services at home" },
  { id: "dev-staging", label: "Dev or staging environment", description: "Testing and development server" },
  { id: "vps-general", label: "General-purpose VPS", description: "A mix of things or not sure yet" },
];

export const EXPERIENCE_LEVELS: {
  id: ExperienceLevel;
  label: string;
  emoji: string;
  tagline: string;
  description: string;
  bullets: string[];
}[] = [
  {
    id: "beginner",
    label: "Beginner",
    emoji: "🌱",
    tagline: "I know what I want to build, but I'm not super technical",
    description: "You have an idea and want to make it happen, but terms like 'nginx' or 'environment variables' are unfamiliar.",
    bullets: [
      "Plain language explanations, no jargon",
      "Step-by-step guidance with context",
      "Simplified controls and fewer options",
      "Always explains what it just did",
    ],
  },
  {
    id: "intermediate",
    label: "Intermediate",
    emoji: "🔧",
    tagline: "I know some code but server stuff can be tricky",
    description: "You're comfortable with code and basic concepts, but deployment and server configuration are still challenging.",
    bullets: [
      "Technical when helpful, explains the complex parts",
      "Full feature set with clear options",
      "Brief summaries of what was done",
      "Assumes familiarity with code concepts",
    ],
  },
  {
    id: "expert",
    label: "Expert",
    emoji: "⚡",
    tagline: "I know what I'm doing — just get it done",
    description: "You're comfortable with Linux, deployment, and development. You want efficiency over explanation.",
    bullets: [
      "Full technical detail, no hand-holding",
      "All features and advanced tools unlocked",
      "Concise responses focused on results",
      "Full control over everything",
    ],
  },
];

// Which tabs each level can see (experts see all)
export const LEVEL_VISIBLE_TABS: Record<ExperienceLevel, string[]> = {
  beginner: ["chat", "settings"],
  intermediate: ["chat", "agents", "plan", "memory", "settings"],
  expert: ["chat", "agents", "plan", "jobs", "memory", "files", "settings", "terminal"],
};

// Which settings sections each level can see
export const LEVEL_VISIBLE_SETTINGS: Record<ExperienceLevel, string[]> = {
  beginner: ["general", "bot_identity", "notifications"],
  intermediate: [
    "general", "bot_identity", "customization", "rate_limits",
    "users", "project", "notifications", "activity_log",
    "backup", "database", "system", "packages", "smtp", "budgets", "api_key",
  ],
  expert: [
    "general", "bot_identity", "customization", "rate_limits",
    "users", "project", "activity_log", "backup", "database",
    "system", "updates", "domains", "packages", "smtp", "notifications",
    "security", "api_key", "templates", "budgets",
  ],
};
