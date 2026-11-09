import type { Probe } from './conversion';
export function readProbe(json: string): Probe {
  const data = JSON.parse(json);
  return { size: Number(data.format?.size), duration: Number(data.format?.duration), streams: (data.streams || [])
    .filter((s: any) => ['video', 'audio', 'subtitle'].includes(s.codec_type) && s.disposition?.attached_pic !== 1).map((s: any) => ({
      index: s.index, language: s.tags?.language || 'und', title: s.tags?.title || '', channels: s.channels, isDefault: s.disposition?.default === 1, isForced: s.disposition?.forced === 1, width: s.width, height: s.height, dolbyVisionOnly: (s.side_data_list || []).some((d: any) => /dovi/i.test(d.side_data_type || '') && (d.dv_profile === 5 || d.dovi_profile === 5 || !['smpte2084', 'arib-std-b67'].includes(s.color_transfer))), kind: s.codec_type, codec: s.codec_name, pixelFormat: s.pix_fmt,
      hdr: ['smpte2084', 'arib-std-b67'].includes(s.color_transfer) || (s.side_data_list || []).some((d: any) => /dovi/i.test(d.side_data_type || '')),
    })) };
}
