const identities = new WeakMap<object, number>();
let nextIdentity = 0;
/** Preserve query type and object identity; never conflate home, search or sessions. */
export function resourceKey(namespace: string, keys: readonly unknown[]) {
  return JSON.stringify([
    namespace,
    ...keys.map((key) => {
      if (
        (typeof key === "object" && key !== null) ||
        typeof key === "function"
      ) {
        const object = key as object;
        if (!identities.has(object)) identities.set(object, ++nextIdentity);
        return ["object", identities.get(object)];
      }
      return [typeof key, key];
    }),
  ]);
}
