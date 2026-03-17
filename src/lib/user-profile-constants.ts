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
