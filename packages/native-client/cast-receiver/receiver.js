/* global cast */
// Host this trusted receiver on HTTPS and register its URL in Google's Cast
// console. Credentials arrive in LOAD.credentials and live only in memory.
const context = cast.framework.CastReceiverContext.getInstance();
const manager = context.getPlayerManager();
const messages = cast.framework.messages;
let session = null;
let lastProgress = 0;
function authorize(request) {
  if (!session || new URL(request.url, session.server).origin !== session.server) throw new Error('Media must remain on the paired server.');
  request.headers = { ...request.headers, Authorization: `Bearer ${session.token}` };
  return request;
}
manager.setMessageInterceptor(messages.MessageType.LOAD, async request => {
  try {
    const data = request.customData;
    const server = new URL(data.server);
    const source = new URL(request.media.contentUrl || request.media.contentId);
    if (request.credentialsType !== 'plexy-bearer' || !request.credentials || server.protocol !== 'https:' || server.origin !== source.origin || server.username || server.password || !/^\/api\/stream\/\d+(?:\/hls\/[^/]+)?$/.test(source.pathname)) throw new Error('Invalid media request.');
    session = { server: server.origin, token: request.credentials, itemId: data.itemId, duration: request.media.duration };
    // Never echo credentials in media metadata or Cast status broadcasts.
    delete request.credentials; delete request.credentialsType; delete request.customData;
    const config = new cast.framework.PlaybackConfig();
    config.manifestRequestHandler = authorize;
    config.segmentRequestHandler = authorize;
    config.licenseRequestHandler = authorize;
    manager.setPlaybackConfig(config);
    lastProgress = 0;
    return request;
  } catch { session = null; return new messages.ErrorData(messages.ErrorType.LOAD_FAILED); }
});
async function saveProgress(played = false) {
  const current = session;
  if (!current || !Number.isInteger(current.itemId)) return;
  const position = manager.getCurrentTimeSec();
  const duration = manager.getDurationSec();
  try {
    await fetch(`${current.server}/api/progress`, { method: 'POST', headers: { Authorization: `Bearer ${current.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: current.itemId, position: Math.max(0, position || 0), ...(Number.isFinite(duration) && duration > 0 ? { duration } : {}), played: played || (duration > 0 && position >= duration * 0.95) }) });
  } catch { /* Receiver has no durable credential or offline storage. */ }
}
manager.addEventListener(cast.framework.events.EventType.TIME_UPDATE, () => { if (Date.now() - lastProgress > 10000) { lastProgress = Date.now(); void saveProgress(); } });
manager.addEventListener(cast.framework.events.EventType.PAUSE, () => void saveProgress());
manager.addEventListener(cast.framework.events.EventType.MEDIA_FINISHED, () => void saveProgress(true));
context.addEventListener(cast.framework.system.EventType.SHUTDOWN, () => { void saveProgress(); session = null; });
context.start({ disableIdleTimeout: false });
