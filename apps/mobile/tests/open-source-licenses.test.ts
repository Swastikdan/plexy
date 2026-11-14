import { describe, expect, test } from "bun:test";
import licenses from "../src/features/settings/data/open-source-licenses.json";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { addProject, addApp } = require("../../../scripts/native/with-open-source-licenses.cjs");

describe("mobile open source notices", () => {
  test("every credited dependency has bundled text and a unique versioned identity", () => {
    const keys = licenses.map(entry => `${entry.name}@${entry.version}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of licenses) {
      expect(entry.notices.length, `${entry.name} must work offline`).toBeGreaterThan(0);
      for (const notice of entry.notices) expect(notice.text.trim().length).toBeGreaterThan(40);
    }
  });
  test("preserves font licenses in addition to the font loader license", () => {
    for (const name of ["@expo-google-fonts/archivo", "@expo-google-fonts/geist"]) {
      const entry = licenses.find(entry => entry.name === name)!;
      expect(entry.notices.some(notice => notice.file === "LICENSE_FONT" && notice.text.includes("SIL OPEN FONT LICENSE"))).toBe(true);
    }
  });
  test("discloses locally modified Expo packages", () => {
    for (const name of ["expo-video", "expo-modules-core"]) expect(licenses.find(entry => entry.name === name)?.modifications).toContain("local modifications");
  });
  test("native license setup survives repeated prebuilds without duplicated plugins", () => {
    const project = addProject("buildscript { dependencies { } }");
    const app = addApp('apply plugin: "com.android.application"');
    expect(addProject(project)).toBe(project);
    expect(addApp(app)).toBe(app);
    expect(project).toContain("oss-licenses-plugin:0.13.0");
    expect(app).toContain("play-services-oss-licenses:17.5.3");
  });
});
