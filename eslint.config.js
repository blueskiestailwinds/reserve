const js = require("@eslint/js");

module.exports = [
  js.configs.recommended,
  {
    files: ["pbs/**/*.js", "pcs/**/*.js", "shared.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        document: "readonly",
        window: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        requestAnimationFrame: "readonly",
        getComputedStyle: "readonly",
        alert: "readonly",
        confirm: "readonly",
        fetch: "readonly",
        console: "readonly",
        URLSearchParams: "readonly",
        location: "readonly",
        history: "readonly",
        HTMLElement: "readonly",
        MutationObserver: "readonly",
        AbortController: "readonly",
      },
    },
    rules: {
      "no-unused-vars": "off",
      "no-undef": "off",
      "no-useless-assignment": "off",
    },
  },
  {
    files: ["lib/**/*.js"],
    languageOptions: {
      sourceType: "module",
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "warn",
    },
  },
  {
    ignores: ["node_modules/**", "eslint.config.js"],
  },
];
