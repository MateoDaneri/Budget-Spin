import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import pluginSecurity from "eslint-plugin-security";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  pluginSecurity.configs.recommended,
  {
    rules: {
      // Triage 2026-06-09: all three findings were array accesses indexed by
      // locally-computed numbers (e.g. weekdayName lookup tables). The rule
      // only adds value when bracket access mixes user input with objects
      // holding sensitive keys; in this codebase it was 3/3 false positives.
      "security/detect-object-injection": "off"
    }
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "coverage/**"
  ])
]);

export default eslintConfig;
