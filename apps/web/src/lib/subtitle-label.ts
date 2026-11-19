/// Human labels for subtitle tracks. Browser-native caption menus (and the
/// in-player settings menu, which reads `<track label>`) only receive one
/// string, so both the track name and its language have to fit in it. The web
/// and Android apps share the mapping through @plexy/media-text.
export { cleanSubtitleName, subtitleTrackLabel } from "@plexy/media-text";
