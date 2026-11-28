import { expect, test } from "bun:test";
import { dataDirFor, logDirFor } from "@/paths";

test("packaged data directories follow the host platform", () => {
  expect(dataDirFor("darwin", {}, "/Users/ada")).toBe(
    "/Users/ada/Library/Application Support/Plexy",
  );
  expect(
    dataDirFor("linux", { XDG_DATA_HOME: "/home/ada/.local/share" }, "/home/ada"),
  ).toBe("/home/ada/.local/share/plexy");
  expect(dataDirFor("linux", {}, "/home/ada")).toBe(
    "/home/ada/.local/share/plexy",
  );
});

test("packaged log directories follow the host platform", () => {
  expect(logDirFor("darwin", {}, "/Users/ada")).toBe(
    "/Users/ada/Library/Logs/Plexy",
  );
  expect(
    logDirFor("linux", { XDG_STATE_HOME: "/home/ada/.local/state" }, "/home/ada"),
  ).toBe("/home/ada/.local/state/plexy/logs");
  expect(logDirFor("linux", {}, "/home/ada")).toBe(
    "/home/ada/.local/state/plexy/logs",
  );
});
