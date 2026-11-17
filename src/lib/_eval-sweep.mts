// Finds modules that crash at EVALUATION time (the kind of failure that shows
// as Expo Go's generic "Something went wrong" screen without any Metro log).
// Loads the real src/lib modules with platform doubles and reports throwers.
import { installPlatformMocks, makeKit } from "./recoveryTestKit.ts";
import { readdirSync } from "node:fs";

const kit = makeKit("eval");
kit.session = null;
installPlatformMocks(kit);

// extra doubles for modules outside the recovery path
const { mock } = await import("node:test");
mock.module("expo-constants", { namedExports: { default: { expoConfig: { extra: {} }, manifest: {} } } });
mock.module("expo-linking", { namedExports: { createURL: () => "", addListener: () => ({ remove() {} }) } });
mock.module("expo-router", { namedExports: { Link: () => null, router: { push() {}, replace() {}, back() {} }, useLocalSearchParams: () => ({}) } });
mock.module("@supabase/supabase-js", { namedExports: { createClient: () => ({}) } });
mock.module("react-native-url-polyfill/auto.js", { namedExports: {} });
mock.module("expo-print", { namedExports: { printToFileAsync: async () => ({ uri: "" }) } });
mock.module("expo-sharing", { namedExports: { shareAsync: async () => undefined } });
mock.module("expo-image-picker", { namedExports: { launchImageLibraryAsync: async () => ({}) } });
mock.module("expo-image-manipulator", { namedExports: { manipulateAsync: async () => ({}) } });
mock.module("expo-haptics", { namedExports: { selectionAsync: async () => undefined } });
mock.module("expo-device", { namedExports: { deviceName: null } });
mock.module("buffer", { namedExports: { Buffer: globalThis.Buffer } });

const dir = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = readdirSync(dir).filter((f) => /^[a-z].*\.ts$/.test(f) && !f.endsWith(".test.ts") && !f.endsWith(".web.ts"));
const failures = [];
for (const f of files) {
  try {
    await import(`./${f}`);
    console.log(`  OK    ${f}`);
  } catch (e) {
    failures.push({ f, e });
    console.log(`  THROW ${f}: ${e && e.message}`);
  }
}
if (failures.length) {
  console.log("\nfirst failure detail:");
  console.log(failures[0].e && failures[0].e.stack);
}
