# Changelog

## 0.1.3 (2026-11-07)

- The Marketplace name is now "MP4 Video Player & Video Preview with Sound", so a search for video player or MP4 finds it. The extension ID, settings and commands stay the same.

## 0.1.2 (2026-11-06)

- A thin line under the player controls has two links, "Sponsor" (GitHub Sponsors) and "More free viewers". The new setting `videoPreview.showSupportLinks` (default `true`) hides it, and so does the "Hide" link next to them. There is no popup, and nothing is sent anywhere.
- New commands "Video Preview: Support the developer" and "Video Preview: More free viewers". The second one lists the other Zovo extensions and installs only the one you pick. Ones that are not on the Marketplace yet open their GitHub page.
- The listing gets a Sponsor button. The README has a short Support section and lists all Zovo extensions.

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
