import { expect, test } from "bun:test";
import { fetchUpdateReleases } from "@/features/settings/lib/update-releases";
import { selectUpdate } from "@/features/settings/lib/update-policy";

test("finds Android updates on later pages after releases containing only other platforms", async () => {
  const requests: string[] = [];
  const request = (async (url, options) => {
    requests.push(String(url));
    expect(new Headers(options?.headers).get("Cache-Control")).toBe("no-cache");
    if (requests.length === 1) return new Response(JSON.stringify([{
      tag_name: "v1.0.8-build.2047", assets: [{ name: "server.tar.gz" }],
    }]), { headers: { link: '<https://api.github.com/repos/Swastikdan/plexy/releases?page=2>; rel="next"' } });
    return new Response(JSON.stringify([{
      tag_name: "v1.0.7-build.2046", assets: [{ name: "Plexy-mobile-v1.0.7-Android.apk", size: 100, browser_download_url: "https://example.com/app.apk" }],
    }]));
  }) as typeof fetch;
  const releases = await fetchUpdateReleases(request);
  expect(requests).toHaveLength(2);
  expect(requests[1]).toContain("page=2");
  expect(selectUpdate(releases, "mobile", 2045, "1.0.6")?.tagName).toBe("v1.0.7-build.2046");
});

test("failed or malformed update responses produce errors instead of claiming up to date", async () => {
  const denied = (async () => new Response("rate limited", { status: 403 })) as typeof fetch;
  await expect(fetchUpdateReleases(denied)).rejects.toThrow("HTTP 403");
  const malformed = (async () => new Response(JSON.stringify({ message: "unexpected" }))) as typeof fetch;
  await expect(fetchUpdateReleases(malformed)).rejects.toThrow("invalid release list");
});
