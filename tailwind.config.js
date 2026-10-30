/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)", surface: "var(--surface)", line: "var(--line)", "line-strong": "var(--line-strong)",
        ink: "var(--ink)", soft: "var(--soft)", muted: "var(--muted)", faint: "var(--faint)",
        primary: { DEFAULT: "var(--primary)", 600: "var(--primary-600)", 50: "var(--primary-50)", 100: "var(--primary-100)" },
        danger: { DEFAULT: "var(--danger)", 50: "var(--danger-50)" },
        // legacy aliases
        paper: "var(--paper)", card: "var(--card)", accent: "var(--accent)",
      },
      fontFamily: {
        display: ["Bricolage Grotesque", "system-ui", "sans-serif"],
        sans: ["Geist", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
