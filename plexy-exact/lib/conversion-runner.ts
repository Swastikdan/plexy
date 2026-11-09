import { execFile, processStatus } from '@exact/child-process';
import { freeSpace, publishMedia, probeMedia, executeConversion, cancelNativeConversion, verifyPlayback, codecSupport, reservePartial, resolveLocalPath } from '@plexy/native';
import { buildFfmpegArgs, planConversion, requiredSpace, verifyOutput } from './conversion';
import { readProbe } from './probe';
import { Catalog, rows } from './catalog';
import type { Storage } from '../app.contract.d.ts';
const active = new Map<string, AbortController>();
export function cancelConversion(id: string) { const controller = active.get(id); if (!controller) return; controller.abort(); if (!processStatus().available) void cancelNativeConversion({}).catch(() => {}); }
async function probe(path: string) {
  if (!processStatus().available) return readProbe((await probeMedia({ path })).json);
  const result = await execFile('bundle:/Resources/ffmpeg/bin/ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  return readProbe(result.stdout);
}
export async function convert(catalog: Catalog, storage: Storage, id: string, deleteOriginal: boolean, allowBattery = false, quality = 'balanced') {
  const lock = await storage.fs.flock('app:/data/conversion.lock', { timeout: 0 });
  try { return await performConversion(catalog, storage, id, deleteOriginal, allowBattery, quality); }
  finally { await lock.unlock(); }
}
async function performConversion(catalog: Catalog, storage: Storage, id: string, deleteOriginal: boolean, allowBattery = false, quality = 'balanced') {
  if (active.size) throw new Error('Another conversion is running');
  const file = (await rows<{ path: string }>(catalog.db, 'SELECT path FROM media WHERE id=?', [id]))[0];
  if (!file) throw new Error('Media not found');
  if (!/\.(mkv|mp4|m4v|mov|webm|avi|ts)$/i.test(file.path)) throw new Error('Unsupported source container');
  const mac = processStatus().available;
  const convertedPath = /\.mp4$/i.test(file.path) ? file.path.replace(/\.mp4$/i, '.optimized.mp4') : file.path.replace(/\.[^./]+$/, '.mp4');
  const filename = convertedPath.split('/').at(-1)!;
  let destination = !mac || file.path.startsWith('home:/Plexy/') ? convertedPath : `home:/Plexy/Unsorted/${filename}`;
  const baseDestination = destination;
  let collision = 1;
  while (await storage.fs.stat(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) {
    destination = baseDestination.replace(/\.mp4$/i, `.${++collision}.mp4`);
    if (collision > 1000) throw new Error('Too many colliding output filenames');
  }
  const partial = destination.replace(/\.mp4$/i, `.${catalog.now}.partial.mp4`);
  const parent = destination.slice(0, destination.lastIndexOf('/'));
  const realParent = mac ? await storage.fs.realpath(parent) : parent;
  const realSource = mac ? await storage.fs.realpath(file.path) : file.path;
  const realDestination = `${realParent}/${destination.split('/').at(-1)}`;
  const realPartial = realDestination.replace(/\.mp4$/i, `.${catalog.now}.partial.mp4`);
  const controller = new AbortController(); active.set(id, controller);
  let partialOwned = false;
  try {
    const originalStat = await storage.fs.stat(file.path);
    const input = await probe(realSource);
    const plan = planConversion(input);
    const video = input.streams.find(stream => stream.kind === 'video')!;
    if (!mac && plan.video === 'copy') {
      const support = await codecSupport({ codec: video.codec, width: video.width || 1920, height: video.height || 1080 });
      if (!support.supported) { plan.video = 'h264'; plan.videoTag = 'avc1'; }
    }
    if (!mac && plan.video !== 'copy' && ((video.width || 0) > 1920 || (video.height || 0) > 1080)) plan.scale = true;
    const space = await freeSpace({ path: realParent });
    if (mac && space.onBattery && !allowBattery) throw new Error('Connect your Mac to power or enable conversion on battery in Settings');
    if (space.bytes < requiredSpace(input, plan)) throw new Error('Not enough free disk space');
    const originalDigest = await storage.fs.digest(file.path, 'SHA-256');
    await catalog.db.execute(`INSERT INTO jobs(id,media_id,kind,state,input_path,output_path,updated_at) VALUES(?,?,'convert','running',?,?,?)
      ON CONFLICT(id) DO UPDATE SET state='running',error=NULL,progress=0,updated_at=excluded.updated_at`, [id, id, file.path, destination, catalog.now]);
    await catalog.db.execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [`jobIdentity:${id}`, JSON.stringify({ source: file.path, destination, partial, input, plan, sourceModifiedMs: originalStat.modifiedMs, digest: originalDigest, deleteOriginal, partialOwned: false })]);
    await catalog.db.execute('UPDATE media SET duration=? WHERE id=?', [input.duration, id]);
    await storage.fs.atomicWriteFile('app:/data/conversion.progress', new Uint8Array());
    const progressPath = mac ? (await resolveLocalPath({ path: 'app:/data/conversion.progress' })).path : 'app:/data/conversion.progress';
    const reserved = await reservePartial({ path: realPartial });
    if (!reserved.ok) throw new Error(reserved.message);
    partialOwned = true;
    await catalog.db.execute("UPDATE settings SET value=? WHERE key=?", [JSON.stringify({ source: file.path, destination, partial, input, plan, sourceModifiedMs: originalStat.modifiedMs, digest: originalDigest, deleteOriginal, partialOwned: true }), `jobIdentity:${id}`]);
    const args = buildFfmpegArgs(plan, realSource, realPartial);
    args[args.indexOf('-n')] = '-y'; // Exclusively reserved above; final publication still never overwrites.
    args[args.indexOf('pipe:1')] = progressPath;
    if (plan.video !== 'copy') {
      args[args.indexOf('-crf') + 1] = String(mac ? quality === 'high' ? 16 : quality === 'compact' ? 20 : 18 : quality === 'high' ? 20 : quality === 'compact' ? 26 : 23);
      if (!mac) {
        args[args.indexOf('-preset') + 1] = 'veryfast';
        const filter = args.indexOf('-vf');
        if (filter >= 0) args[filter + 1] = args[filter + 1]!.replace('w=3840:h=2160', 'w=1920:h=1080');
      }
    }
    args.unshift('-v', 'error');
    if (controller.signal.aborted) throw new Error('Conversion canceled');
    if (mac) await execFile('bundle:/Resources/ffmpeg/bin/ffmpeg', args, { encoding: 'utf8', signal: controller.signal, maxBuffer: 8 * 1024 * 1024 });
    else { const result = await executeConversion({ arguments: JSON.stringify(args) }); if (!result.ok) throw new Error(result.message); }
    if (controller.signal.aborted) throw new Error('Conversion canceled');
    await catalog.db.execute("UPDATE jobs SET state='verifying' WHERE id=?", [id]);
    const output = await probe(realPartial);
    verifyOutput(input, output, plan);
    async function checkDecode(args: string[]) {
      if (mac) {
        const result = await execFile('bundle:/Resources/ffmpeg/bin/ffmpeg', args, { encoding: 'utf8', signal: controller.signal, maxBuffer: 1024 * 1024 });
        if (result.stderr.trim()) throw new Error(`Output decode failed: ${result.stderr.slice(-2000)}`);
      } else {
        const result = await executeConversion({ arguments: JSON.stringify(args) });
        if (!result.ok) throw new Error(result.message);
      }
    }
    await checkDecode(['-nostdin', '-v', 'error', '-xerror', '-i', realPartial, '-t', '2', '-map', '0:v', '-map', '0:a?', '-f', 'null', '-']);
    await checkDecode(['-nostdin', '-v', 'error', '-xerror', '-sseof', '-2', '-i', realPartial, '-map', '0:v', '-map', '0:a?', '-f', 'null', '-']);
    if (deleteOriginal) await checkDecode(['-nostdin', '-v', 'error', '-xerror', '-i', realPartial, '-map', '0:v', '-map', '0:a?', '-f', 'null', '-']);
    const currentStat = await storage.fs.stat(file.path);
    if (currentStat.size !== originalStat.size || currentStat.modifiedMs !== originalStat.modifiedMs || await storage.fs.digest(file.path, 'SHA-256') !== originalDigest) throw new Error('Source changed during conversion; original retained');
    const playable = await verifyPlayback({ path: realPartial });
    if (!playable.ok) throw new Error(playable.message);
    if (controller.signal.aborted) throw new Error('Conversion canceled');
    const outputDigest = await storage.fs.digest(partial, 'SHA-256');
    await catalog.db.execute("UPDATE settings SET value=? WHERE key=?", [JSON.stringify({ source: file.path, destination, partial, input, plan, sourceModifiedMs: originalStat.modifiedMs, digest: originalDigest, deleteOriginal, partialOwned: true, outputDigest, output, verified: { headAndTail: true, fullDecode: deleteOriginal, targetPlayer: true } }), `jobIdentity:${id}`]);
    const published = await publishMedia({ partial: realPartial, destination: realDestination });
    if (!published.ok) throw new Error(published.message);
    await catalog.db.transaction([
      { sql: "UPDATE media SET path=?,container='mp4',duration=?,size=?,status='ready',original_path=? WHERE id=?", params: [destination, output.duration, output.size, file.path, id] },
      { sql: 'DELETE FROM streams WHERE media_id=?', params: [id] },
      ...output.streams.map(stream => ({ sql: 'INSERT INTO streams(id,media_id,kind,stream_index,codec,language,title,channels,width,height,is_default,is_forced,is_text_subtitle) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
        params: [`${id}:${stream.index}`, id, stream.kind, stream.index, stream.codec, stream.language || 'und', stream.title || '', stream.channels || null, stream.width || null, stream.height || null, stream.isDefault ? 1 : 0, stream.isForced ? 1 : 0, stream.kind === 'subtitle' && stream.codec === 'mov_text' ? 1 : 0] })),
      { sql: "UPDATE media SET video_codec=?,width=?,height=?,hdr='sdr' WHERE id=?", params: [output.streams[0]?.codec || '', output.streams[0]?.width || 0, output.streams[0]?.height || 0, id] },
      { sql: "UPDATE jobs SET state='done',progress=1,error=? WHERE id=?", params: [input.streams.filter(stream => stream.kind === 'subtitle').length > plan.subtitles.length ? 'Image subtitles omitted; text subtitles retained' : '', id] },
    ]);
    if (deleteOriginal) {
      try {
        if (await storage.fs.digest(file.path, 'SHA-256') === originalDigest) await storage.fs.rm(file.path);
        else await catalog.db.execute("UPDATE jobs SET error='source_kept: source changed after publication' WHERE id=?", [id]);
      } catch { await catalog.db.execute("UPDATE jobs SET error='source_kept: deletion could not complete' WHERE id=?", [id]); }
    }
  } catch (error) {
    await catalog.db.execute("UPDATE jobs SET state=?,error=? WHERE id=?", [controller.signal.aborted ? 'canceled' : 'failed', String(error), id]);
    // Only our partial is removed. A published output or any source always stays intact.
    if (partialOwned) try { await storage.fs.rm(partial); } catch { /* no partial exists */ }
    throw error;
  } finally { active.delete(id); }
}

export async function reconcileConversions(catalog: Catalog, storage: Storage) {
  const jobs = await rows<{ id: string; input_path: string; output_path: string }>(catalog.db, "SELECT id,input_path,output_path FROM jobs WHERE state='interrupted' OR (state='done' AND error LIKE 'source_kept:%')");
  for (const job of jobs) {
    const entry = (await rows<{value:string}>(catalog.db, 'SELECT value FROM settings WHERE key=?', [`jobIdentity:${job.id}`]))[0];
    if (!entry) continue; // Old jobs without identity evidence require explicit review/retry.
    const identity = JSON.parse(entry.value);
    if (identity.source !== job.input_path || identity.destination !== job.output_path) continue;
    try {
      if (await storage.fs.digest(identity.source, 'SHA-256') !== identity.digest) continue;
      const output = await storage.fs.stat(identity.destination).catch(() => null);
      if (output?.isFile) {
        if (!identity.outputDigest || await storage.fs.digest(identity.destination, 'SHA-256') !== identity.outputDigest) continue;
        const path = processStatus().available ? await storage.fs.realpath(identity.destination) : identity.destination;
        const verified = await probe(path);
        verifyOutput(identity.input, verified, identity.plan);
        await catalog.db.transaction([
          { sql: "UPDATE media SET path=?,container='mp4',duration=?,size=?,status='ready',original_path=? WHERE id=?", params: [identity.destination, verified.duration, verified.size, identity.source, job.id] },
          { sql: "UPDATE jobs SET state='done',progress=1,error=NULL WHERE id=?", params: [job.id] },
        ]);
        if (identity.deleteOriginal && identity.verified?.fullDecode && identity.verified?.targetPlayer && await storage.fs.digest(identity.source, 'SHA-256') === identity.digest) {
          try { await storage.fs.rm(identity.source); } catch { await catalog.db.execute("UPDATE jobs SET error='source_kept: recovery cleanup pending' WHERE id=?", [job.id]); }
        }
      } else {
        const partial = identity.partial;
        if (identity.partialOwned === true && typeof partial === 'string' && partial.startsWith(identity.destination.replace(/\.mp4$/i, '.')) && partial.endsWith('.partial.mp4')) {
          try { await storage.fs.rm(partial); } catch { /* no incomplete output */ }
          await catalog.db.execute("UPDATE jobs SET state='queued',error=NULL WHERE id=?", [job.id]);
        }
      }
    } catch { /* Unreadable or unverifiable files stay interrupted, with their source untouched. */ }
  }
}
