# Changelog

## 0.2.0 (2026-11-07)

- New name in the Marketplace: MP4 Viewer & Video Player with Sound. The extension ID, settings and commands stay the same.
- Video that VS Code can't decode (Apple ProRes, MPEG-4 Part 2, DNxHD and others) and `.avi`, `.wmv`, `.flv`, `.mpg`, `.mpeg`, `.ogv` and `.m2ts` files are converted to H.264 with your ffmpeg and play with sound. If a video shows no picture, the player converts it once by itself. Without ffmpeg, the player shows what is missing with "Settings" and "Open in default app". New setting `videoPreview.convertUnsupportedVideo`.
- Subtitles: `.srt` and `.vtt` files next to the video load by themselves. The CC menu and the C key switch tracks or turn them off, and "Load subtitles..." opens any other file. New setting `videoPreview.subtitles.autoLoad`.
- Each video opens where you stopped it, at the same speed, and the volume carries over. New setting `videoPreview.rememberPosition`.
- New setting `videoPreview.autoplay` starts playback when a video opens. It is off by default.

## 0.1.6 (2026-11-07)

- "More free viewers" now starts with the Zovo extensions most related to this one. Picking one opens its Marketplace page, where you choose to install it.
- The README has a "Support Zovo" section with GitHub Sponsors and the developer's GitHub profile, and "More tools by Zovo" lists related extensions.

## 0.1.5 (2026-11-07)

- The footer under the viewer has a "Rate" link next to Sponsor and More free viewers. It opens the review page of this extension on the Marketplace. Nothing pops up and nothing asks you for a rating. "Hide" still hides the whole line.
- Marketplace search keywords updated.

## 0.1.4 (2026-11-07)

- The "More free viewers" list and the README list now show the 15 Zovo extensions on the Marketplace under their current names, and 12 that are coming soon.
- Extensions for related files now come first, starting with PDF Viewer & PDF Reader with Dark Mode and CSV Viewer, Excel Viewer & Parquet Viewer.

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
