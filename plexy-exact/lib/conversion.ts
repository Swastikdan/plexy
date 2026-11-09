// Pure policy: no Node, Bun, HTTP server, or platform imports in runtime code.
export interface Stream {
  index: number;
  kind: 'video' | 'audio' | 'subtitle';
  codec: string;
  hdr?: boolean;
  width?: number;
  height?: number;
  dolbyVisionOnly?: boolean;
  pixelFormat?: string;
  language?: string;
  title?: string;
  channels?: number;
  isDefault?: boolean;
  isForced?: boolean;
}
export interface Probe { duration: number; size: number; streams: Stream[] }
export interface Plan {
  video: 'copy' | 'h264';
  videoTag: 'avc1' | 'hvc1';
  videoIndex: number;
  audio: { index: number; codec: 'copy' | 'aac' }[];
  subtitles: number[];
  toneMap: boolean;
  scale: boolean;
}
const textSubtitles = new Set(['subrip', 'srt', 'ass', 'ssa', 'webvtt', 'mov_text']);
export function planConversion(input: Probe): Plan {
  const videos = input.streams.filter(s => s.kind === 'video');
  if (videos.length !== 1 || !Number.isFinite(input.duration) || input.duration <= 0) throw new Error('Invalid media probe');
  const video = videos[0]!;
  if (video.dolbyVisionOnly) throw new Error('Dolby Vision-only conversion is not supported; original retained');
  const toneMap = video.hdr === true;
  const scale = (video.width || 0) > 3840 || (video.height || 0) > 2160;
  // Conservative SDR output: transcode unknown profiles instead of assuming compatibility.
  const copy = !toneMap && !scale && (video.codec === 'h264' && video.pixelFormat === 'yuv420p'
    || video.codec === 'hevc' && ['yuv420p', 'yuv420p10le'].includes(video.pixelFormat || ''));
  return {
    video: copy ? 'copy' : 'h264', videoIndex: video.index, videoTag: copy && video.codec === 'hevc' ? 'hvc1' : 'avc1', toneMap, scale,
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
  const args = ['-nostdin', '-n', '-i', input, '-map', `0:${plan.videoIndex}`];
  for (const audio of plan.audio) args.push('-map', `0:${audio.index}`);
  for (const index of plan.subtitles) args.push('-map', `0:${index}`);
  args.push('-c:v', plan.video === 'copy' ? 'copy' : 'libx264');
  if (plan.video !== 'copy') args.push('-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p');
  const filters: string[] = [];
  if (plan.toneMap) filters.push('zscale=t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p');
  if (plan.scale) filters.push('scale=w=3840:h=2160:force_original_aspect_ratio=decrease:force_divisible_by=2');
  if (filters.length) args.push('-vf', filters.join(','));
  if (plan.toneMap) args.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709');
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
    || output.duration <= 0 || Math.abs(input.duration - output.duration) > Math.max(2, input.duration * .005)) throw new Error('Output is empty or truncated');
  const videos = output.streams.filter(s => s.kind === 'video');
  if (videos.length !== 1 || !['h264', 'hevc'].includes(videos[0]!.codec) || videos[0]!.hdr || (videos[0]!.width || 0) > 3840 || (videos[0]!.height || 0) > 2160) throw new Error('Output video is incompatible');
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
