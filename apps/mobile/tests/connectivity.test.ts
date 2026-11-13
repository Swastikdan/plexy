import { expect, test } from "bun:test";
import { createConnectivityState } from "@/shared/lib/connectivity-state";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const connected = { isConnected: true, isInternetReachable: true };
const disconnected = { isConnected: false, isInternetReachable: false };

function device() {
  const reads: ReturnType<typeof deferred<typeof connected>>[] = [];
  let emit!: (connection: typeof connected) => void;
  let subscriptions = 0;
  const connectivity = createConnectivityState({
    fetch() {
      const read = deferred<typeof connected>();
      reads.push(read);
      return read.promise;
    },
    addEventListener(listener) {
      subscriptions++;
      emit = listener;
      return () => {};
    },
  });
  return { connectivity, reads, emit: (state: typeof connected) => emit(state), subscriptions: () => subscriptions };
}

test("UI and runtime share one initial connectivity read and listener", async () => {
  const { connectivity, reads, emit, subscriptions } = device();
  expect(connectivity.getSnapshot()).toBeNull();
  let firstUpdates = 0;
  let secondUpdates = 0;
  const unsubscribe = connectivity.subscribe(() => { firstUpdates++; });
  connectivity.subscribe(() => { secondUpdates++; });
  const started = connectivity.start();
  expect(subscriptions()).toBe(1);
  expect(reads).toHaveLength(1);
  reads[0]!.resolve(connected);
  await started;
  expect(connectivity.getSnapshot()).toBe(true);
  expect(firstUpdates).toBe(1);
  expect(secondUpdates).toBe(1);
  unsubscribe();
  emit(disconnected);
  expect(connectivity.getSnapshot()).toBe(false);
  expect(firstUpdates).toBe(1);
  expect(secondUpdates).toBe(2);
});

test("a delayed initial fetch cannot overwrite a newer disconnect event", async () => {
  const { connectivity, reads, emit } = device();
  const started = connectivity.start();
  emit(disconnected);
  reads[0]!.resolve(connected);
  await started;
  expect(connectivity.getSnapshot()).toBe(false);
});

test("older refreshes cannot overwrite a newer refresh and failed reads keep the last state", async () => {
  const { connectivity, reads } = device();
  const started = connectivity.start();
  reads[0]!.resolve(disconnected);
  await started;
  const older = connectivity.refresh();
  const newer = connectivity.refresh();
  reads[2]!.resolve(connected);
  await newer;
  reads[1]!.resolve(disconnected);
  await older;
  expect(connectivity.getSnapshot()).toBe(true);
  const failed = connectivity.refresh();
  reads[3]!.reject(new Error("Device state unavailable"));
  await failed;
  expect(connectivity.getSnapshot()).toBe(true);
});

test("an unavailable initial device read leaves connectivity unknown", async () => {
  const { connectivity, reads } = device();
  const started = connectivity.start();
  reads[0]!.reject(new Error("Device state unavailable"));
  await started;
  expect(connectivity.getSnapshot()).toBeNull();
});
