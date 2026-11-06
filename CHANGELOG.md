# Changelog

## 0.1.1 (2026-11-06)

- Video Preview asks one time for a Marketplace rating. It counts each success (an opened video). After 5 of them, and no sooner than 2 days after the first, it shows a small message with "Rate it", "Later" and "Don't ask again". "Later" waits for 20 more, at most two more times. It never shows in your first session, more than once per session, when the window is not focused, or in a remote or untrusted workspace.
- New setting `videoPreview.askForRating` (default `true`) turns it off. Nothing is sent anywhere; "Rate it" only opens the review page in your browser.

## 0.1.0 (2026-11-06)

First release.

- Plays MP4, M4V, MOV, MKV and WebM in a custom editor.
- AAC, AC-3, E-AC-3, Opus and ALAC sound is decoded to FLAC by afconvert (macOS) or your own ffmpeg, cached, and kept in step with the video.
- MKV and WebM are remuxed to MP4 by ffmpeg without re-encoding the video.
- Frame step, 0.1× to 4× speed, A-B loop, full-size PNG frame grabs, volume and mute.
- Metadata panel from mp4box.js with codec, frame size, frame rate, frame count, bitrates, sample rate and channels.
- Settings for the helper, the ffmpeg path, the size limit, the cache size and the timeout.
