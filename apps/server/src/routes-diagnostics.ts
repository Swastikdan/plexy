import { Elysia, t } from "elysia";
import { recentPlaybackDiagnostics, recordPlaybackDiagnostic } from "./playback-diagnostics";

export const diagnosticsRoutes = new Elysia({ prefix: "/api", normalize: "typebox" })
  .post("/diagnostics/playback", ({ body }) => {
    recordPlaybackDiagnostic({
      kind: body.kind,
      path: body.path ?? null,
      durationMs: body.durationMs == null ? null : Math.max(0, Math.min(600_000, body.durationMs)),
      mediaErrorCode: body.mediaErrorCode == null ? null : Math.max(0, Math.min(10, body.mediaErrorCode)),
    });
    return { ok: true as const };
  }, {
    body: t.Object({
      kind: t.Union([t.Literal("startup"), t.Literal("rebuffer"), t.Literal("error")]),
      path: t.Optional(t.Union([
        t.Literal("direct"), t.Literal("hls"), t.Literal("remux"), t.Literal("transcode"),
      ])),
      durationMs: t.Optional(t.Number({ minimum: 0, maximum: 600_000 })),
      mediaErrorCode: t.Optional(t.Number({ minimum: 0, maximum: 10 })),
    }),
  })
  // The global API auth gate limits this in-memory telemetry to paired
  // devices. Hosted clients need to read it too, so it is not loopback-only.
  .get("/diagnostics/playback", () => ({ events: recentPlaybackDiagnostics() }));
