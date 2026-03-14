import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
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
        "bot-accent-2": "rgb(var(--bot-accent-2) / <alpha-value>)",
        "bot-green": "rgb(var(--bot-green) / <alpha-value>)",
        "bot-red": "rgb(var(--bot-red) / <alpha-value>)",
        "bot-amber": "rgb(var(--bot-amber) / <alpha-value>)",
        "bot-blue": "rgb(var(--bot-blue) / <alpha-value>)",
        "bot-glow": "rgb(var(--bot-glow) / <alpha-value>)",
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
      boxShadow: {
        "glow-sm": "0 0 12px 2px rgb(var(--bot-glow) / 0.15)",
        "glow-md": "0 0 24px 4px rgb(var(--bot-glow) / 0.2)",
        "glow-lg": "0 0 40px 8px rgb(var(--bot-glow) / 0.25)",
        "glow-accent": "0 0 20px 4px rgb(var(--bot-accent) / 0.2), 0 0 6px 1px rgb(var(--bot-accent) / 0.1)",
        "glass": "0 8px 32px rgb(0 0 0 / 0.3)",
        "elevated": "0 2px 8px rgb(0 0 0 / 0.2), 0 1px 2px rgb(0 0 0 / 0.15)",
        "float": "0 8px 24px rgb(0 0 0 / 0.25), 0 2px 8px rgb(0 0 0 / 0.15)",
      },
      keyframes: {
        fadeIn: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        fadeUp: {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        scaleIn: {
          from: { opacity: "0", transform: "scale(0.95)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        slideInRight: {
          from: { opacity: "0", transform: "translateX(24px)" },
          to: { opacity: "1", transform: "translateX(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
      },
      animation: {
        fadeIn: "fadeIn 0.3s ease-out",
        fadeUp: "fadeUp 0.4s ease-out",
        scaleIn: "scaleIn 0.2s ease-out",
        slideInRight: "slideInRight 0.3s ease-out",
        shimmer: "shimmer 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
