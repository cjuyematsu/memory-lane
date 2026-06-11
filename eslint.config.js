// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
  },
  {
    rules: {
      // Every hit in this codebase is a Reanimated sharedValue.value write in
      // an effect, callback, or gesture worklet — the documented Reanimated
      // pattern. The rule treats hook return values as immutable and can't
      // know shared values are mutable boxes. The React Compiler itself just
      // skips memoizing such components, so this is lint noise, not a bug.
      "react-hooks/immutability": "off",
    },
  },
]);
