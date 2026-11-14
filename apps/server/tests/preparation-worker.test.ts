import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveFfmpeg } from "../src/ffmpeg";

test("preparation publishes decoded MP4 and rejects truncated duration", async () => {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("FFmpeg is required for preparation verification");
  const dir = await mkdtemp(join(tmpdir(), "plexy-prepare-test-"));
  try {
    const source = join(dir, "source.mkv");
    const fixture = Bun.spawn([ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "testsrc2=size=160x90:rate=24", "-t", "2", "-c:v", "libx264", "-threads", "1", source],
      { stdout: "ignore", stderr: "pipe" });
    expect(await fixture.exited).toBe(0);
    for (const duration of [2, 20]) {
      const output = join(dir, `output-${duration}.mp4`);
      const worker = Bun.spawn([process.execPath, join(import.meta.dir, "../src/optimize-worker.ts")], {
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
      worker.stdin.write(JSON.stringify({ id: "verify", op: "optimize", path: source, output,
        mode: "transcode", videoCopy: false, audioCopy: false, duration }) + "\n");
      worker.stdin.end();
      const messages = (await new Response(worker.stdout).text()).trim().split("\n").map(line => JSON.parse(line));
      expect(await worker.exited).toBe(0);
      expect(messages.at(-1).type).toBe(duration === 2 ? "done" : "error");
      if (duration === 2) expect((await stat(output)).size).toBeGreaterThan(0);
      else {
        expect(messages.at(-1).error).toContain("shorter than the source");
        expect(await Bun.file(output).exists()).toBe(false);
        expect(await Bun.file(output + ".part").exists()).toBe(false);
      }
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("cancelling an active preparation stops the encode and removes partial output", async () => {
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) throw new Error("FFmpeg is required for cancellation verification");
  const dir = await mkdtemp(join(tmpdir(), "plexy-cancel-test-"));
  let worker: ReturnType<typeof Bun.spawn> | undefined;
  try {
    const source = join(dir, "source.mkv");
    const output = join(dir, "output.mp4");
    const fixture = Bun.spawn([ffmpeg, "-hide_banner", "-loglevel", "error", "-f", "lavfi",
      "-i", "testsrc2=size=640x360:rate=24", "-t", "30", "-c:v", "libx264", "-preset", "ultrafast",
      "-threads", "1", source], { stdout: "ignore", stderr: "pipe" });
    expect(await fixture.exited).toBe(0);
    const proc = Bun.spawn([process.execPath, join(import.meta.dir, "../src/optimize-worker.ts")], {
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    worker = proc;
    proc.stdin.write(JSON.stringify({ id: "cancel-test", op: "optimize", path: source, output,
      mode: "transcode", videoCopy: false, audioCopy: false, duration: 30 }) + "\n");
    let buffer = "";
    let cancelled = false;
    let requested = false;
    for await (const chunk of proc.stdout) {
      buffer += new TextDecoder().decode(chunk);
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const msg = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (msg.type === "progress" && !requested) {
          requested = true;
          proc.stdin.write(JSON.stringify({ id: "cancel", op: "cancel" }) + "\n");
        }
        if (msg.type === "cancelled") cancelled = true;
        if (["cancelled", "done", "error"].includes(msg.type)) proc.stdin.end();
      }
    }
    expect(await proc.exited).toBe(0);
    expect(requested).toBe(true);
    expect(cancelled).toBe(true);
    expect(await Bun.file(output).exists()).toBe(false);
    expect(await Bun.file(output + ".part").exists()).toBe(false);
    expect(await Bun.file(source).exists()).toBe(true);
  } finally {
    worker?.kill();
    await rm(dir, { recursive: true, force: true });
  }
}, 20000);
