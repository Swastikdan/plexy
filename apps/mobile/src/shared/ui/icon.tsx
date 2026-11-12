import { colors } from "../theme";
import {
ArrowLeft,
AudioLines,
Bell,
Check,
ChevronDown,
ChevronLeft,
ChevronRight,
Download,
Film,
Home,
Library,
Maximize,
Menu,
Minimize,
PanelLeftClose,
PanelLeftOpen,
Pause,
Play,
Search,
Settings,
SkipBack,
SkipForward,
Subtitles,
Tv,
Volume2,
VolumeX,
X,
type NativeIcon,
} from "./icons";

const icons = {
  back: ArrowLeft,
  audio: AudioLines,
  bell: Bell,
  check: Check,
  down: ChevronDown,
  left: ChevronLeft,
  right: ChevronRight,
  download: Download,
  film: Film,
  home: Home,
  library: Library,
  fullscreen: Maximize,
  menu: Menu,
  minimize: Minimize,
  panelLeftClose: PanelLeftClose,
  panelLeftOpen: PanelLeftOpen,
  pause: Pause,
  play: Play,
  search: Search,
  settings: Settings,
  rewind: SkipBack,
  forward: SkipForward,
  captions: Subtitles,
  tv: Tv,
  volume: Volume2,
  mute: VolumeX,
  close: X,
} satisfies Record<string, NativeIcon>;

export type IconName = keyof typeof icons;

export function Icon({
  name,
  size = 22,
  color = colors.ink,
  strokeWidth = 1.7,
  filled = false,
}: {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  filled?: boolean;
}) {
  const Component = icons[name];
  return (
    <Component
      size={size}
      color={color}
      strokeWidth={strokeWidth}
      fill={filled ? color : "none"}
    />
  );
}
