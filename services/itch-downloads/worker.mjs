const channels = /^(?:android-arm64|mac-arm64(?:-zip)?(?:-beta)?|plexy-server-(?:macos-arm64|linux-x64)(?:-binary)?(?:-beta)?)$/;
const mobileTag = /^mobile-v\d+\.\d+\.\d+$/;
const releaseTag = /^v\d+\.\d+\.\d+(?:-beta\.\d+)?-build\.\d+$/;
const headers = { "Cache-Control": "no-store" };

export default {
  async fetch(request, env) {
    const [, channel, tag, extra] = new URL(request.url).pathname.split("/");
    if (request.method !== "GET" || extra !== undefined || !channels.test(channel) ||
        !(channel === "android-arm64" ? mobileTag : releaseTag).test(tag)) {
      return new Response(null, { status: 404, headers });
    }

    if (!/^\d+$/.test(env.ITCH_GAME_ID) || !env.ITCH_API_KEY) {
      return new Response(null, { status: 503, headers });
    }

    try {
      const options = {
        headers: { Authorization: `Bearer ${env.ITCH_API_KEY}` },
        redirect: "manual",
        signal: AbortSignal.timeout(5_000),
      };
      const uploads = await fetch(`https://api.itch.io/games/${env.ITCH_GAME_ID}/uploads`, options);
      if (!uploads.ok) throw new Error("Upload lookup failed.");
      const { uploads: files } = await uploads.json();
      // A channel can move ahead of GitHub or still be processing the update.
      const file = files.find(({ channel_name, channelName, build }) =>
        (channel_name ?? channelName) === channel &&
        (build?.user_version ?? build?.userVersion) === tag && build.state === "completed");
      if (!Number.isSafeInteger(file?.build?.id)) return new Response(null, { status: 404, headers });
      const endpoint = new URL(`https://api.itch.io/builds/${file.build.id}/download/unpacked/default`);
      endpoint.searchParams.set("api_key", env.ITCH_API_KEY);
      const download = await fetch(endpoint, { redirect: "manual", signal: options.signal });
      const url = new URL(download.headers.get("Location") ?? "");
      if (download.status < 300 || download.status >= 400 || url.protocol !== "https:" ||
          url.username || url.password || url.origin === endpoint.origin || url.searchParams.has("api_key") ||
          url.href.includes(encodeURIComponent(env.ITCH_API_KEY))) {
        throw new Error("Artifact download did not return a usable redirect.");
      }
      return new Response(null, { status: 302, headers: { ...headers, Location: url.href } });
    } catch {
      return new Response(null, { status: 502, headers });
    }
  },
};
