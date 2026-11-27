/// Copies the web app's own icons into the GPUI app as SVG files.
///
/// - Player chrome: Video.js "neutral" icons (what the web player renders).
/// - Everything else: lucide-react, the web app's icon set.
///
/// Run from the repository root: `bun apps/player-gpui/tools/extract-icons.ts`.
/// Packages resolve through apps/web so the versions match the web app.
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const root = join(import.meta.dir, "../../..");
const web = join(root, "apps/web/package.json");
const out = join(import.meta.dir, "../assets/icons");
mkdirSync(out, { recursive: true });

const resolve = (spec: string) => Bun.resolveSync(spec, web);
const { createElement } = await import(resolve("react"));
const { renderToStaticMarkup } = await import(resolve("react-dom/server"));

// GPUI draws an SVG as a single-colour mask tinted by `text_color`, so the
// colour itself only needs to be opaque.
const opaque = (svg: string) => svg.replaceAll("currentColor", "#fff");

// app name -> Video.js neutral icon
const videojs: Record<string, string> = {
  play: "PlayIcon",
  pause: "PauseIcon",
  restart: "RestartIcon",
  seek: "SeekIcon",
  "volume": "VolumeHighIcon",
  "volume-low": "VolumeLowIcon",
  mute: "VolumeOffIcon",
  subtitles: "CaptionsOffIcon",
  "subtitles-on": "CaptionsOnIcon",
  fullscreen: "FullscreenEnterIcon",
  "fullscreen-exit": "FullscreenExitIcon",
  settings: "GearIcon",
  speed: "SpeedIcon",
  audio: "SpeechIcon",
  check: "CheckIcon",
  "chevron-right": "ChevronIcon",
  pip: "PipEnterIcon",
  spinner: "SpinnerIcon",
};

const neutral = await import(resolve("@videojs/react/icons/neutral"));
for (const [name, exported] of Object.entries(videojs)) {
  const component = neutral[exported];
  if (!component) throw new Error(`@videojs/react/icons/neutral has no ${exported}`);
  writeFileSync(join(out, `${name}.svg`), opaque(renderToStaticMarkup(createElement(component))));
}

// app name -> lucide icon (all used by apps/web, plus the player's close/more)
const lucide: Record<string, string> = {
  close: "x",
  more: "ellipsis-vertical",
  back: "rotate-ccw",
  forward: "rotate-cw",
  "chevron-left": "chevron-left",
  "arrow-left": "arrow-left",
  chapters: "list-video",
  folder: "folder",
  "folder-plus": "folder-plus",
  film: "film",
  plus: "plus",
  minus: "minus",
  home: "house",
  library: "library",
  tv: "tv",
  search: "search",
  bookmark: "bookmark",
  heart: "heart",
  star: "star",
  "eye-off": "eye-off",
  layers: "layers",
  clock: "clock-3",
  trash: "trash-2",
  refresh: "refresh-cw",
  "skip-forward": "skip-forward",
  "arrow-up-down": "arrow-up-down",
  server: "server",
  "folder-heart": "folder-heart",
  circle: "circle",
  "circle-check": "circle-check",
  ellipsis: "ellipsis",
  "arrow-right": "arrow-right",
  "chevron-down": "chevron-down",
  "trending-up": "trending-up",
  captions: "captions",
  "audio-lines": "audio-lines",
  palette: "palette",
  "play-outline": "play",
  "list": "list",
  "shield": "shield",
};

const lucideDir = join(resolve("lucide-react"), "../../esm/icons");
for (const [name, icon] of Object.entries(lucide)) {
  // Renamed icons are re-exports (`trash-2` → `trash`); follow them.
  let file = join(lucideDir, `${icon}.mjs`);
  const alias = (await Bun.file(file).text()).match(/export \{ default \} from '\.\/(.+?)\.mjs'/);
  if (alias) file = join(lucideDir, `${alias[1]}.mjs`);
  const { __iconData } = await import(file);
  const body = __iconData.node
    .map(([tag, attrs]: [string, Record<string, string>]) => {
      const { key: _key, ...rest } = attrs;
      return `<${tag} ${Object.entries(rest).map(([k, v]) => `${k}="${v}"`).join(" ")}/>`;
    })
    .join("");
  writeFileSync(
    join(out, `${name}.svg`),
    `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`,
  );
}
console.log(`Wrote ${Object.keys(videojs).length + Object.keys(lucide).length} icons to ${out}`);
