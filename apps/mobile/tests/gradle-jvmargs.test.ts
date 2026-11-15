import { expect, test } from "bun:test";
import { requiredGradleJvmArgs } from "../../../scripts/native/gradle-jvmargs.cjs";

const opening = "--add-opens=java.base/java.lang.ref=ALL-UNNAMED";
test("CI heap overrides retain the module opening required by CMake configuration", () => {
  const override = "-Xmx4096m -XX:MaxMetaspaceSize=512m";
  expect(requiredGradleJvmArgs(override)).toBe(`${override} ${opening}`);
});
test("prebuild and CLI can apply the required arguments without duplication", () => {
  const args = requiredGradleJvmArgs("-Xmx2048m");
  expect(requiredGradleJvmArgs(args)).toBe(args);
  expect(requiredGradleJvmArgs("")).toBe(opening);
});
