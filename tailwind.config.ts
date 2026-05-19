import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Technical dashboard palette: deep navy with mint/coral accents
        ink: {
          DEFAULT: "#0E1620",      // primary background
          soft: "#141E2C",          // surface
          warm: "#1B2636",          // raised surface (cards)
          rail: "#212E40",          // borders, rules
        },
        text: {
          DEFAULT: "#E8EEF5",       // primary text
          soft: "#A8B4C4",          // secondary text
          faint: "#6B7889",         // tertiary text
        },
        accent: {
          mint: "#5EEAD4",          // success / running / "go"
          coral: "#FB7185",         // warning / escalate / "attention"
          amber: "#FBBF24",         // pending / clarification
          violet: "#A78BFA",        // info / metadata
        },
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Inter", "sans-serif"],
        mono: ["SF Mono", "Menlo", "Monaco", "Consolas", "monospace"],
      },
      animation: {
        "pulse-slow": "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "fade-up": "fade-up 0.4s ease-out",
        "slide-in": "slide-in 0.3s ease-out",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "slide-in": {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
