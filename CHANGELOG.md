# Changelog

## 0.3.0 (2026-11-09)

- New, optional Zovo Pro tools, each with 3 free tries on your computer. They work on the A-B part, or the whole video:
  - Clip export: a GIF (480 to 960 px, made inside the player, no other tool needed) or an MP4 cut by your ffmpeg, exact (H.264 and AAC) or a fast copy.
  - Frame export: every frame, every 5th or 10th, one per second, or 10 evenly spaced, as full-size PNG files named with the time and frame number, up to 1,000 per export.
  - Contact sheet: one PNG with 16, 30 or 48 frames in a grid, each with its time and frame number, and a header with the file facts.
- A try is used only when a file is saved. Esc stops an export and the player goes back to where you were.
- Everything that was free stays free: playback with sound, MKV, WebM and AVI through ffmpeg, frame steps, speed, the A-B loop, subtitles, picture-in-picture, metadata and Save frame. Nothing about Pro shows when a video opens. `videoPreview.showProFeatures: false` hides the Pro tools.
- Zovo Pro is USD 19 once for every Zovo viewer: GitHub Sponsors, or PayPal for a license key. New commands: Get Zovo Pro, Unlock Zovo Pro with GitHub Sponsors, Enter Zovo Pro License Key, Remove Zovo Pro from This Editor.
- The rating question now counts 2 videos in 2 sessions at least 4 hours apart, also in a window that stays open, and "Rate it" opens Open VSX in Cursor, Windsurf and VSCodium. Rate comes first in the footer.
- "More free viewers" starts with the Zovo extensions most related to this one. The README names the custom format work offer.

## 0.2.6 (2026-11-08)

- The Marketplace name is now "MP4, MOV, MKV & WebM Viewer, Video Player & Preview with Sound" (was "MP4, MOV & MKV Viewer, Video Player with Sound"), so more searches find it. The extension ID, settings and commands stay the same.
- The short description now starts with what the name does not say: free, with subtitles, picture-in-picture and frame steps.
- No change to how files open or look.

## 0.2.5 (2026-11-08)

- AAC sound in MP4, MOV and M4V files now plays with nothing to install, on Windows, Linux and macOS. The extension carries a built-in decoder (Symphonia compiled to WebAssembly, about 820 KB). It runs in a worker thread, starts no program and makes no network request. ALAC, MP3 and PCM sound work too. ffmpeg or afconvert is still used first if found. If either fails, the built-in decoder takes over. New choice `builtin` for `videoPreview.soundHelper`.
- In an untrusted workspace, AAC sound now plays by itself through the built-in decoder. ffmpeg and afconvert still wait for a click.
- New picture-in-picture button (and the P key).
- The separate sound track is now nudged back in step when it is 0.02 s off (was 0.04 s). In VS Code 1.142 it used to settle about 0.03 s behind the picture.
- MOV files with PCM sound and MP4 files with ALAC sound used to show "No audio track". They now play with sound.
- AC-3, E-AC-3, DTS and 5.1 AAC sound still need ffmpeg (or afconvert on macOS), and the player says so.

## 0.2.4 (2026-11-08)

- MKV files with VP8 video now play. Before, ffmpeg stopped with "Error sending frames to consumers", because VP8 does not fit in MP4. They are converted to H.264 now.
- MKV files with MPEG-4 Part 2 or MPEG-2 video now show the picture. Before, the video was copied into MP4 and played with sound but a black picture. ffmpeg's log names the codec, and these are converted to H.264.
- An MKV or WebM with only an audio track no longer fails with "Stream map matches no streams".
- The Marketplace name is now "MP4, MOV & MKV Viewer, Video Player with Sound". The extension ID, settings and commands stay the same. The README and description say that MKV, WebM and AVI need ffmpeg.
- The rating question now comes after 3 files that opened without an error on 2 different days, and never after an error. "Later" asks one more time after 7 days, "No thanks" ends it, and it never asks more than 2 times. `videoPreview.askForRating: false` turns it off.

## 0.2.3 (2026-11-08)

- The "More free viewers" list and the README now use the current Marketplace names and include the newest Zovo extensions: ZIP, GCode, EPUB, HAR, font and audio viewers.

## 0.2.2 (2026-11-07)

- The Marketplace name is now "MP4 & MOV Viewer, Video Player with Sound" (it was "MP4 Viewer & Video Player with Sound"). The extension id, commands and settings stay the same.
- The Marketplace description now starts with "MP4 viewer, MOV viewer and video player for VS Code that plays MP4, MOV, MKV, WebM and AVI with the sound VS Code mutes".
- Marketplace keywords: added `mov viewer`.

## 0.2.1 (2026-11-07)

- An empty file (0 bytes) or a file that is not a video now gets a short, clear message. Before, the player showed ffmpeg's raw error output and a Retry button that could not help.

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
