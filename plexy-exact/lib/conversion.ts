// Pure policy: no Node, Bun, HTTP server, or platform imports in runtime code.
export interface Stream {
  index: number;
  kind: 'video' | 'audio' | 'subtitle';
  codec: string;
  hdr?: boolean;
  pixelFormat?: string;
}
export interface Probe { duration: number; size: number; streams: Stream[] }
export interface Plan {
  video: 'copy' | 'h264';
  videoTag: 'avc1' | 'hvc1';
  audio: { index: number; codec: 'copy' | 'aac' }[];
  subtitles: number[];
  toneMap: boolean;
}
const textSubtitles = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text']);
export function planConversion(input: Probe): Plan {
  const videos = input.streams.filter(s => s.kind === 'video');
  if (videos.length !== 1 || !Number.isFinite(input.duration) || input.duration <= 0) throw new Error('Invalid media probe');
  const video = videos[0]!;
  const toneMap = video.hdr === true;
  // Conservative SDR output: transcode unknown profiles instead of assuming compatibility.
  const copy = !toneMap && (video.codec === 'h264' && video.pixelFormat === 'yuv420p'
    || video.codec === 'hevc' && ['yuv420p', 'yuv420p10le'].includes(video.pixelFormat || ''));
  return {
    video: copy ? 'copy' : 'h264', videoTag: copy && video.codec === 'hevc' ? 'hvc1' : 'avc1', toneMap,
    audio: input.streams.filter(s => s.kind === 'audio').map(s => ({ index: s.index, codec: s.codec === 'aac' ? 'copy' : 'aac' })),
    subtitles: input.streams.filter(s => s.kind === 'subtitle' && textSubtitles.has(s.codec)).map(s => s.index),
  };
}
export function requiredSpace(input: Probe, plan: Plan) {
  if (!Number.isFinite(input.size) || input.size < 0) throw new Error('Invalid source size');
  const transcode = plan.video !== 'copy' || plan.audio.some(s => s.codec !== 'copy');
  return Math.ceil(transcode ? Math.max(input.size * 1.2, 2 * 1024 ** 3) : input.size * 1.05);
}
export function buildFfmpegArgs(plan: Plan, input: string, partialOutput: string): string[] {
  if (input === partialOutput) throw new Error('Output must not overwrite input');
  const args = ['-nostdin', '-n', '-i', input, '-map', '0:v:0'];
  for (const audio of plan.audio) args.push('-map', `0:${audio.index}`);
  for (const index of plan.subtitles) args.push('-map', `0:${index}`);
  args.push('-c:v', plan.video === 'copy' ? 'copy' : 'libx264');
  if (plan.video !== 'copy') args.push('-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p');
  if (plan.toneMap) args.push('-vf', 'zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p');
  plan.audio.forEach((audio, i) => {
    args.push(`-c:a:${i}`, audio.codec);
    if (audio.codec === 'aac') args.push(`-b:a:${i}`, '256k');
  });
  if (plan.subtitles.length) args.push('-c:s', 'mov_text');
  args.push('-tag:v', plan.videoTag);
  // Container explicit because partial filenames deliberately do not end with .mp4.
  args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-f', 'mp4', partialOutput);
  return args;
}
export function verifyOutput(input: Probe, output: Probe, plan: Plan): void {
  if (!Number.isFinite(output.size) || output.size <= 0 || !Number.isFinite(output.duration)
    || output.duration <= 0 || Math.abs(input.duration - output.duration) > Math.max(2, input.duration * .01)) throw new Error('Output is empty or truncated');
  const videos = output.streams.filter(s => s.kind === 'video');
  if (videos.length !== 1 || !['h264', 'hevc'].includes(videos[0]!.codec) || videos[0]!.hdr) throw new Error('Output video is incompatible');
  if (output.streams.filter(s => s.kind === 'audio').length !== plan.audio.length) throw new Error('Output lost audio tracks');
  if (output.streams.filter(s => s.kind === 'subtitle').length !== plan.subtitles.length) throw new Error('Output lost text subtitles');
}
export interface CommitIO {
  probe(path: string): Promise<Probe>;
  // Must atomically move without replacing an existing destination.
  publishExclusive(partial: string, destination: string): Promise<void>;
  commitCatalog(destination: string): Promise<void>;
  deleteSource(source: string): Promise<void>;
}
export async function commitConversion(io: CommitIO, input: Probe, plan: Plan,
  source: string, partial: string, destination: string, deleteOriginal: boolean) {
  if (new Set([source, partial, destination]).size !== 3) throw new Error('Conversion paths must be distinct');
  verifyOutput(input, await io.probe(partial), plan);
  await io.publishExclusive(partial, destination);
  await io.commitCatalog(destination);
  // Failure above always preserves the source. A deletion failure leaves two valid files.
  if (deleteOriginal) await io.deleteSource(source);
}
