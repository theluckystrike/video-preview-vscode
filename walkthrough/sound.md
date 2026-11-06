# Why VS Code mutes most MP4 files

VS Code's built-in Chromium can show H.264 video, but it ships without an AAC decoder, and most MP4 and MOV files store their sound as AAC.

Video Preview with Sound reads the codec from the file header. When the sound is AAC (or AC-3, E-AC-3, Opus or ALAC), it asks a program you already have to decode it to FLAC:

- **macOS**: `/usr/bin/afconvert`, which is part of macOS. Nothing to install.
- **Windows and Linux**: `ffmpeg`. Install it with `winget install ffmpeg`, `choco install ffmpeg` or your package manager, or set `videoPreview.ffmpegPath`.

The FLAC file goes into the extension's cache folder and plays next to the muted video, kept in step to within a few hundredths of a second. MKV and WebM need ffmpeg, which copies the video stream into MP4 without re-encoding it.
