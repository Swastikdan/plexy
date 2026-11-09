#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p fixtures
ffmpeg_bin="${PLEXY_FFMPEG:-$PWD/ffmpeg/bin/ffmpeg}"
"$ffmpeg_bin" -n -f lavfi -i testsrc2=size=320x180:rate=24 -f lavfi -i sine=frequency=440 -f lavfi -i sine=frequency=880 -t 3 -map 0:v -map 1:a -map 2:a -c:v libx264 -preset ultrafast -c:a aac -metadata:s:a:0 language=eng -metadata:s:a:1 language=spa fixtures/multi-audio.mkv
printf '1\n00:00:00,500 --> 00:00:02,000\nPlexy subtitle test\n' > fixtures/sample.srt
"$ffmpeg_bin" -n -i fixtures/multi-audio.mkv -i fixtures/sample.srt -c copy -c:s srt fixtures/subtitles.mkv
