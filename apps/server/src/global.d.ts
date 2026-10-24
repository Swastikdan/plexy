import { EventEmitter } from "node:events";

declare module "node:child_process" {
  interface ChildProcess extends EventEmitter {}
  interface ChildProcessWithoutNullStreams extends EventEmitter {}
  interface ChildProcessByStdio<any, any, any> extends EventEmitter {}
}
