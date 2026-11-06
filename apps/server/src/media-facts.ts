import { run } from "./db";
import type { ProbeFacts } from "./worker-host";

/** Persist one probe result. Scanning and just-in-time playback share this. */
export function storeProbeFacts(fileId: number, facts: ProbeFacts): void {
  run(
    `UPDATE media_files SET
      container=$container, duration=$duration, bitrate=$bitrate,
      video_codec=$vc, video_profile=$vp, width=$w, height=$h, fps=$fps, hdr=$hdr,
      audio_json=$audio, subtitles_json=$subs, analysis_status='probed',
      analysis_error=NULL, probed_at=$at
     WHERE id=$id`,
    {
      $id: fileId,
      $container: facts.container,
      $duration: facts.duration,
      $bitrate: facts.bitrate,
      $vc: facts.video?.codec ?? null,
      $vp: facts.video?.profile ?? null,
      $w: facts.video?.width ?? null,
      $h: facts.video?.height ?? null,
      $fps: facts.video?.fps ?? null,
      $hdr: facts.video?.hdr ?? null,
      $audio: JSON.stringify(facts.audio),
      $subs: JSON.stringify(facts.subtitles),
      $at: new Date().toISOString(),
    },
  );
}
