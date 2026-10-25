#!/bin/bash
set -euo pipefail

# Build an arm64 macOS FFmpeg for Plexy's packaged desktop app. This is a
# deliberately LGPL-only configuration: do not add GPL libraries such as x264.
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FFMPEG_VERSION="${FFMPEG_VERSION:-8.1}"
WORK_DIR="${FFMPEG_WORK_DIR:-$ROOT_DIR/.build/ffmpeg}"
SOURCE_DIR="$WORK_DIR/ffmpeg-$FFMPEG_VERSION"
PREFIX="$WORK_DIR/prefix"
ARCHIVE="$WORK_DIR/ffmpeg-$FFMPEG_VERSION.tar.xz"
OUT="$ROOT_DIR/dist/bin/ffmpeg-custom"

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This build script targets macOS arm64." >&2
  exit 1
fi

mkdir -p "$WORK_DIR" "$ROOT_DIR/dist/bin"
if [[ ! -f "$ARCHIVE" ]]; then
  curl -fL "https://ffmpeg.org/releases/ffmpeg-$FFMPEG_VERSION.tar.xz" -o "$ARCHIVE"
fi
if [[ ! -d "$SOURCE_DIR" ]]; then
  tar -C "$WORK_DIR" -xf "$ARCHIVE"
fi

cd "$SOURCE_DIR"
SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
export MACOSX_DEPLOYMENT_TARGET="${MACOSX_DEPLOYMENT_TARGET:-12.0}"

# Features derived from apps/server/src/{routes-media,optimize-worker,
# hls-preparation,trickplay,hls-encoder}. The app uses file/pipe IO, MOV/MP4,
# Matroska, MPEG-TS, AVI and WebM inputs; MP4 and HLS/MPEG-TS outputs; H.264,
# HEVC and AAC decoders; native AAC and JPEG encoders; VideoToolbox H.264
# encoding; and the fps/scale/pad/tile/split/setsar/format/color/null filters.
# Keep format demuxing limited to formats explicitly accepted by playback.
./configure \
  --prefix="$PREFIX" \
  --arch=arm64 \
  --target-os=darwin \
  --cc=clang \
  --enable-cross-compile \
  --sysroot="$SDKROOT" \
  --extra-cflags="-arch arm64 -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" \
  --extra-ldflags="-arch arm64 -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" \
  --disable-everything \
  --disable-gpl \
  --disable-version3 \
  --disable-nonfree \
  --disable-autodetect \
  --disable-debug \
  --disable-doc \
  --disable-ffplay \
  --disable-ffprobe \
  --disable-ffmpeg \
  --enable-ffmpeg \
  --enable-small \
  --enable-static \
  --disable-shared \
  --enable-pthreads \
  --enable-videotoolbox \
  --enable-audiotoolbox \
  --enable-protocol=file,pipe \
  --enable-demuxer=avi,matroska,mov,mpeg,mpegts,webm \
  --enable-muxer=hls,image2,mov,mp4,mpegts,null \
  --enable-decoder=h264,hevc,aac,ac3,eac3,flac,mp3,opus,pcm_s16le,pcm_s24le,pcm_s32le,truehd,vorbis \
  --enable-encoder=aac,h264_videotoolbox,mjpeg \
  --enable-hwaccel=h264_videotoolbox,hevc_videotoolbox \
  --enable-parser=h264,hevc,aac,ac3,flac,mpegaudio,opus,vorbis \
  --enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb \
  --enable-filter=color,format,fps,null,pad,scale,setsar,split,tile \
  --enable-indev=lavfi

make -j"$(sysctl -n hw.ncpu)"
cp ffmpeg "$OUT"
chmod 755 "$OUT"
echo "Built $OUT"
ls -lh "$OUT"
"$OUT" -version | head -n 4
