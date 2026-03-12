import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "bot-bg": "rgb(var(--bot-bg) / <alpha-value>)",
        "bot-surface": "rgb(var(--bot-surface) / <alpha-value>)",
        "bot-elevated": "rgb(var(--bot-elevated) / <alpha-value>)",
        "bot-border": "rgb(var(--bot-border) / <alpha-value>)",
        "bot-text": "rgb(var(--bot-text) / <alpha-value>)",
        "bot-muted": "rgb(var(--bot-muted) / <alpha-value>)",
        "bot-accent": "rgb(var(--bot-accent) / <alpha-value>)",
        "bot-green": "rgb(var(--bot-green) / <alpha-value>)",
        "bot-red": "rgb(var(--bot-red) / <alpha-value>)",
        "bot-amber": "rgb(var(--bot-amber) / <alpha-value>)",
        "bot-blue": "rgb(var(--bot-blue) / <alpha-value>)",
      },
      fontSize: {
        caption: ["0.75rem", { lineHeight: "1rem" }],
        body: ["0.875rem", { lineHeight: "1.25rem" }],
        subtitle: ["1rem", { lineHeight: "1.5rem" }],
        title: ["1.25rem", { lineHeight: "1.75rem" }],
        h1: ["1.5rem", { lineHeight: "2rem" }],
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
