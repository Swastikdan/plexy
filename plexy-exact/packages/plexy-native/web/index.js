class Player {
  constructor({ element, props, events }) {
    this.video = element.ownerDocument.createElement('video');
    this.video.controls = true;
    this.video.style.cssText = 'width:100%;height:100%;object-fit:contain';
    element.append(this.video);
    this.events = events;
    this.lastSeek = -1;
    this.video.addEventListener('timeupdate', () => {
      if (Number.isFinite(this.video.duration)) events.message(JSON.stringify({ position: this.video.currentTime, duration: this.video.duration, audio: [], subtitles: [], error: '' }));
    });
    this.setProps(props);
  }
  setProps(props) {
    if (this.source !== props.source) { this.source = props.source; this.video.src = props.source; }
    if (props.isPaused === 'true' || props.isPaused === true) this.video.pause();
    else this.video.play().catch(() => {});
    const seek = Number(props.seek);
    if (seek !== this.lastSeek && Number.isFinite(seek)) { this.lastSeek = seek; this.video.currentTime = seek; }
  }
  destroy() { this.video.pause(); this.video.removeAttribute('src'); this.video.load(); this.video.remove(); }
}
export const roster = { 'plexy-player': { view: Player } };
export function implementation() {
  return {
    verifyPlayback: async () => ({ ok: false, message: 'Native verification only.' }),
    probeMedia: async () => ({ error: 'NotSupportedError' }),
    executeConversion: async () => ({ ok: false, message: 'Native conversion only.' }),
    cancelNativeConversion: async () => ({ ok: true, message: '' }),
    openUpdate: async () => ({ ok: false, message: 'Install the native build to use updates.' }),
    resolveLocalPath: async () => ({ path: '' }),
    reservePartial: async () => ({ ok: false, message: 'Native conversion only.' }),
    codecSupport: async () => ({ supported: false }),
    freeSpace: async () => ({ bytes: 0, onBattery: false }),
    publishMedia: async () => ({ ok: false, message: 'Conversion is available on macOS.' }),
    listDeviceVideos: async () => [],
    importVideo: async () => ({ ok: false, message: 'Device import is available on Android.' }),
  };
}
