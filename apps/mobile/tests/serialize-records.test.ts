import { expect, test } from "bun:test";
import { serializeRecords } from "@/core/library/serialize-records";

test("large libraries yield to input and detect in-place record changes", async () => {
  const records = Array.from({ length: 251 }, (_, id) => ({ id, watch: { position: 0 } }));
  let yields = 0;
  const before = await serializeRecords(records, async () => { yields++; });
  expect(yields).toBe(2);
  records[100]!.watch.position = 90;
  const after = await serializeRecords(records, async () => {});
  expect(after.get(100)).not.toBe(before.get(100));
  expect(after.get(0)).toBe(before.get(0));
  expect(after.size).toBe(251);
});

test("empty libraries need no serialization or yields", async () => {
  const result = await serializeRecords([], async () => { throw Error("unexpected yield"); });
  expect(result.size).toBe(0);
});
