import type { ForwardRefExoticComponent, RefAttributes, VideoHTMLAttributes, HTMLAttributes, CSSProperties, ReactNode } from "react";

declare module "hls-video-element/react" {
  export interface HlsVideoProps extends VideoHTMLAttributes<HTMLVideoElement> {
    slot?: string;
  }

  const HlsVideo: ForwardRefExoticComponent<HlsVideoProps & RefAttributes<HTMLVideoElement>>;
  export default HlsVideo;
}

declare module "player.style/sutro/react" {
  export interface MediaThemeSutroProps extends HTMLAttributes<HTMLElement> {
    style?: CSSProperties;
    className?: string;
    children?: ReactNode;
  }

  const MediaThemeSutro: ForwardRefExoticComponent<MediaThemeSutroProps & RefAttributes<HTMLElement>>;
  export default MediaThemeSutro;
}
