const { defineConfig } = require("eslint/config");
const expo = require("eslint-config-expo/flat");
const hooks = require("eslint-plugin-react-hooks");

module.exports = defineConfig([
  expo,
  { ignores: ["dist/**", "android/**", ".expo/**", "tests/**", "src/uniwind-types.d.ts"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "react-hooks": hooks },
    rules: {
      ...hooks.configs.recommended.rules,
    },
  },
]);
