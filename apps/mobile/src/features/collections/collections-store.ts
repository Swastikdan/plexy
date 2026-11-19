import { useEffect, useSyncExternalStore } from "react";
import { readJson, writeJson } from "@/core/client/preferences";

export interface CustomCollection {
  id: string;
  name: string;
  titleIds: string[];
}

const key = "plexy.custom-collections.v1";
let value: CustomCollection[] = [];
const listeners = new Set<() => void>();
const getSnapshot = () => value;
const subscribe = (callback: () => void) => {
  listeners.add(callback);
  return () => { listeners.delete(callback); };
};
function publish(next: CustomCollection[]) {
  value = next;
  for (const listener of listeners) listener();
}
let loading: Promise<void> | undefined;
function load() {
  return loading ??= readJson<CustomCollection[]>(key, []).then(publish);
}
let writes = Promise.resolve();
export function editCollections(update: (current: CustomCollection[]) => CustomCollection[]) {
  const operation = writes.then(async () => {
    await load();
    const next = update(value);
    await writeJson(key, next);
    publish(next);
  });
  writes = operation.catch(() => {});
  return operation;
}
export function useCollections() {
  useEffect(() => { void load(); }, []);
  return useSyncExternalStore(subscribe, getSnapshot);
}
