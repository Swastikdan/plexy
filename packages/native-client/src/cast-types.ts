export interface CastControlProps {
  media: {
    url: string;
    contentType: string;
    title: string;
    position: number;
    duration: number;
    fileId: number;
    itemId: number | null;
    path: string;
  };
  server: { url: string; token: string };
  onCasting: (casting: boolean) => void;
  onPosition: (position: number) => void;
}
