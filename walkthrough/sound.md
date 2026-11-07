# Why VS Code mutes most MP4 files

VS Code's built-in Chromium can show H.264 video, but it ships without an AAC decoder, and most MP4 and MOV files store their sound as AAC.

Video Preview with Sound reads the codec from the file header. When the sound is AAC, ALAC, MP3 or PCM, the built-in decoder turns it into a WAV file. It ships inside the extension (WebAssembly), so there is nothing to install. It starts no program and sends nothing anywhere, so it also works in an untrusted workspace.

For other sound formats (AC-3, E-AC-3, DTS) the extension asks a program you already have:

- macOS: `/usr/bin/afconvert`, which is part of macOS.
- Windows and Linux: `ffmpeg`. Install it with `winget install ffmpeg`, `choco install ffmpeg` or your package manager, or set `videoPreview.ffmpegPath`.

The decoded sound goes into the extension's cache folder and plays next to the muted video, kept in step to within a few hundredths of a second. MKV and WebM need ffmpeg, because VS Code cannot open those containers. ffmpeg copies the video stream into MP4 without re-encoding it.
