/** Yield between batches so a large mutable library does not monopolize JS. */
export async function serializeRecords<T extends { id: number }>(
  records: readonly T[],
  yieldToInput: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0)),
): Promise<Map<number, string>> {
  const serialized = new Map<number, string>();
  for (let index = 0; index < records.length; index++) {
    if (index > 0 && index % 100 === 0) await yieldToInput();
    const record = records[index]!;
    serialized.set(record.id, JSON.stringify(record));
  }
  return serialized;
}
