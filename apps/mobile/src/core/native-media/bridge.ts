import { requireOptionalNativeModule } from "expo";

export interface ExternalVideo {
  uri: string;
  name: string;
}

export interface CastStatus {
  active: boolean;
  playing?: boolean;
  finished?: boolean;
  position: number;
}

interface MediaEvents {
  onCastError: (event: { id: string; message: string }) => void;
}

interface MediaModule {
  addListener<E extends keyof MediaEvents>(event: E, listener: MediaEvents[E]): { remove(): void };
  takeVideo(id: string): Promise<ExternalVideo | null>;
  openPickedVideo?: (uri: string) => Promise<ExternalVideo>;
  createPlaybackRemux?: () => string;
  preparePlaybackRemux?: (id: string, uri: string) => Promise<string>;
  releasePlaybackRemux?: (id: string) => void;
  importVideo(uri: string, name: string): Promise<string>;
  startCasting(id: string, uri: string, title: string, seconds: number): Promise<void>;
  castStatus(id: string): Promise<CastStatus | null>;
  castCommand(id: string, command: "play" | "pause" | "seek" | "stop", seconds: number): Promise<void>;
}

export const nativeMedia = requireOptionalNativeModule<MediaModule>("PlexyMedia");
