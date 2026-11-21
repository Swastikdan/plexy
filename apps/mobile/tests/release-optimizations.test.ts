import { expect, test } from "bun:test";
import {
  RELEASE_PROPERTIES,
  upsertProperty,
} from "../../../scripts/native/with-release-optimizations.cjs";

type Property = { type: string; key: string; value: string };

test("release APKs enable R8, resource shrinking and bundle compression", () => {
  expect(RELEASE_PROPERTIES["android.enableMinifyInReleaseBuilds"]).toBe("true");
  expect(RELEASE_PROPERTIES["android.enableShrinkResourcesInReleaseBuilds"]).toBe("true");
  expect(RELEASE_PROPERTIES["android.enableBundleCompression"]).toBe("true");
});

test("the plugin replaces an existing property instead of duplicating it", () => {
  const properties: Property[] = [
    { type: "property", key: "android.enableMinifyInReleaseBuilds", value: "false" },
  ];
  upsertProperty(properties, "android.enableMinifyInReleaseBuilds", "true");
  expect(properties).toEqual([
    { type: "property", key: "android.enableMinifyInReleaseBuilds", value: "true" },
  ]);
});

test("the plugin inserts a missing property once", () => {
  const properties: Property[] = [];
  for (const [key, value] of Object.entries(RELEASE_PROPERTIES))
    upsertProperty(properties, key, value as string);
  for (const [key, value] of Object.entries(RELEASE_PROPERTIES))
    upsertProperty(properties, key, value as string);
  expect(properties).toHaveLength(Object.keys(RELEASE_PROPERTIES).length);
  expect(properties).toContainEqual({
    type: "property",
    key: "android.enableShrinkResourcesInReleaseBuilds",
    value: "true",
  });
});
