import RefreshIcon from "@hugeicons/core-free-icons/RefreshIcon";
import ArrowDown01Icon from "@hugeicons/core-free-icons/ArrowDown01Icon";
import ArrowLeft01Icon from "@hugeicons/core-free-icons/ArrowLeft01Icon";
import ArrowLeft02Icon from "@hugeicons/core-free-icons/ArrowLeft02Icon";
import ArrowLeftRightIcon from "@hugeicons/core-free-icons/ArrowLeftRightIcon";
import ArrowRight01Icon from "@hugeicons/core-free-icons/ArrowRight01Icon";
import ArrowUpDownIcon from "@hugeicons/core-free-icons/ArrowUpDownIcon";
import AudioLinesIcon from "@hugeicons/core-free-icons/AudioLinesIcon";
import Cancel01Icon from "@hugeicons/core-free-icons/Cancel01Icon";
import CropIcon from "@hugeicons/core-free-icons/CropIcon";
import Delete02Icon from "@hugeicons/core-free-icons/Delete02Icon";
import Download01Icon from "@hugeicons/core-free-icons/Download01Icon";
import Film01Icon from "@hugeicons/core-free-icons/Film01Icon";
import Home01Icon from "@hugeicons/core-free-icons/Home01Icon";
import InformationCircleIcon from "@hugeicons/core-free-icons/InformationCircleIcon";
import LibraryIcon from "@hugeicons/core-free-icons/LibraryIcon";
import MaximizeScreenIcon from "@hugeicons/core-free-icons/MaximizeScreenIcon";
import Menu01Icon from "@hugeicons/core-free-icons/Menu01Icon";
import MinimizeScreenIcon from "@hugeicons/core-free-icons/MinimizeScreenIcon";
import MinusSignIcon from "@hugeicons/core-free-icons/MinusSignIcon";
import MoreHorizontalIcon from "@hugeicons/core-free-icons/MoreHorizontalIcon";
import NextIcon from "@hugeicons/core-free-icons/NextIcon";
import Notification01Icon from "@hugeicons/core-free-icons/Notification01Icon";
import PanelLeftCloseIcon from "@hugeicons/core-free-icons/PanelLeftCloseIcon";
import PanelLeftOpenIcon from "@hugeicons/core-free-icons/PanelLeftOpenIcon";
import PauseIcon from "@hugeicons/core-free-icons/PauseIcon";
import PictureInPictureIcon from "@hugeicons/core-free-icons/PictureInPictureIcon";
import PlayIcon from "@hugeicons/core-free-icons/PlayIcon";
import PlayListIcon from "@hugeicons/core-free-icons/PlayListIcon";
import PlusSignIcon from "@hugeicons/core-free-icons/PlusSignIcon";
import PreviousIcon from "@hugeicons/core-free-icons/PreviousIcon";
import RotateLeft01Icon from "@hugeicons/core-free-icons/RotateLeft01Icon";
import RotateRight01Icon from "@hugeicons/core-free-icons/RotateRight01Icon";
import Search01Icon from "@hugeicons/core-free-icons/Search01Icon";
import Settings01Icon from "@hugeicons/core-free-icons/Settings01Icon";
import SlidersHorizontalIcon from "@hugeicons/core-free-icons/SlidersHorizontalIcon";
import SquareLock01Icon from "@hugeicons/core-free-icons/SquareLock01Icon";
import SquareUnlock01Icon from "@hugeicons/core-free-icons/SquareUnlock01Icon";
import SubtitleIcon from "@hugeicons/core-free-icons/SubtitleIcon";
import Sun01Icon from "@hugeicons/core-free-icons/Sun01Icon";
import GaugeIcon from "@hugeicons/core-free-icons/GaugeIcon";
import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import Tv01Icon from "@hugeicons/core-free-icons/Tv01Icon";
import VolumeHighIcon from "@hugeicons/core-free-icons/VolumeHighIcon";
import VolumeOffIcon from "@hugeicons/core-free-icons/VolumeOffIcon";
import ZoomInIcon from "@hugeicons/core-free-icons/ZoomInIcon";
import {
HugeiconsIcon,
type HugeiconsProps,
type IconSvgElement,
} from "@hugeicons/react-native";
import React from "react";
type IconProps = Omit<HugeiconsProps, "icon">;
export type NativeIcon = React.ComponentType<IconProps>;
function glyph(icon: IconSvgElement, allowFill = false): NativeIcon {
  return function Icon({ fill, strokeWidth = 1.7, ...props }: IconProps) {
    return (
      <HugeiconsIcon
        icon={icon}
        strokeWidth={strokeWidth}
        fill={allowFill ? fill : "none"}
        {...props}
      />
    );
  };
}
export const ArrowLeft = glyph(ArrowLeft02Icon);
export const ArrowUpDown = glyph(ArrowUpDownIcon);
export const Check = glyph(Tick02Icon);
export const ChevronDown = glyph(ArrowDown01Icon);
export const ChevronLeft = glyph(ArrowLeft01Icon);
export const ChevronRight = glyph(ArrowRight01Icon);
export const Film = glyph(Film01Icon);
export const Info = glyph(InformationCircleIcon);
export const Play = glyph(PlayIcon, true);
export const Trash2 = glyph(Delete02Icon);
export const X = glyph(Cancel01Icon);
export const AudioLines = glyph(AudioLinesIcon);
export const Bell = glyph(Notification01Icon);
export const Download = glyph(Download01Icon);
export const Home = glyph(Home01Icon, true);
export const Library = glyph(LibraryIcon);
export const Maximize = glyph(MaximizeScreenIcon);
export const Menu = glyph(Menu01Icon);
export const Minimize = glyph(MinimizeScreenIcon);
export const PanelLeftClose = glyph(PanelLeftCloseIcon);
export const PanelLeftOpen = glyph(PanelLeftOpenIcon);
export const Pause = glyph(PauseIcon);
export const Search = glyph(Search01Icon);
export const Settings = glyph(Settings01Icon);
export const SkipBack = glyph(PreviousIcon);
export const SkipForward = glyph(NextIcon);
export const Subtitles = glyph(SubtitleIcon);
export const Tv = glyph(Tv01Icon);
export const Volume2 = glyph(VolumeHighIcon);
export const VolumeX = glyph(VolumeOffIcon);
export const Crop = glyph(CropIcon);
export const ListVideo = glyph(PlayListIcon);
export const Lock = glyph(SquareLock01Icon);
export const Minus = glyph(MinusSignIcon);
export const MoveHorizontal = glyph(ArrowLeftRightIcon);
export const PictureInPicture = glyph(PictureInPictureIcon);
export const Plus = glyph(PlusSignIcon);
export const RotateCcw = glyph(RotateLeft01Icon);
export const RotateCw = glyph(RotateRight01Icon);
export const SlidersHorizontal = glyph(SlidersHorizontalIcon);
export const Unlock = glyph(SquareUnlock01Icon);
export const ZoomIn = glyph(ZoomInIcon);
export const Sun = glyph(Sun01Icon);
export const Gauge = glyph(GaugeIcon);
export const MoreHorizontal = glyph(MoreHorizontalIcon);

/**
 * Solid info mark — the filled "i" by itself, for use on an opaque chip
 * (black glyph on a white chip, white glyph on a dark chip). It deliberately
 * has no disc around it: the chip supplies the background. The hugeicons free
 * set is stroke-only, so this is hand-built on the same 24-unit grid.
 */
export const InfoSolid: NativeIcon = function InfoSolid({
  size = 24,
  color = "#000",
  // A solid glyph ignores stroke width and fill overrides on purpose.
  ...props
}: IconProps) {
  const { strokeWidth: _strokeWidth, fill: _fill, ...rest } = props;
  return (
    <HugeiconsIcon
      icon={[
        [
          "path",
          {
            d: "M12 4.1A1.9 1.9 0 1 0 12 7.9A1.9 1.9 0 1 0 12 4.1ZM10.3 11.1A1.7 1.7 0 0 1 12 9.4A1.7 1.7 0 0 1 13.7 11.1V17.7A1.7 1.7 0 0 1 12 19.4A1.7 1.7 0 0 1 10.3 17.7Z",
            fill: "currentColor",
          },
        ],
      ]}
      size={size}
      color={color}
      {...rest}
    />
  );
};

export const RefreshCw = glyph(RefreshIcon);
