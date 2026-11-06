# Changelog

## 0.1.0 (2026-11-06)

First release.

- Plays MP4, M4V, MOV, MKV and WebM in a custom editor.
- AAC, AC-3, E-AC-3, Opus and ALAC sound is decoded to FLAC by afconvert (macOS) or your own ffmpeg, cached, and kept in step with the video.
- MKV and WebM are remuxed to MP4 by ffmpeg without re-encoding the video.
- Frame step, 0.1× to 4× speed, A-B loop, full-size PNG frame grabs, volume and mute.
- Metadata panel from mp4box.js with codec, frame size, frame rate, frame count, bitrates, sample rate and channels.
- Settings for the helper, the ffmpeg path, the size limit, the cache size and the timeout.
