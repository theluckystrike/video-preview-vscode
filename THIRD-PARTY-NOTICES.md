# Third-party notices

This extension bundles mp4box.js 2.5.0 (https://github.com/gpac/mp4box.js) under the BSD 3-Clause License.

```
Copyright (c) 2012. Telecom ParisTech/TSI/MM/GPAC Cyril Concolato
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:
    * Redistributions of source code must retain the above copyright
      notice, this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright
      notice, this list of conditions and the following disclaimer in the
      documentation and/or other materials provided with the distribution.
    * Neither the name of the copyright holder nor the
      names of its contributors may be used to endorse or promote products
      derived from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL <COPYRIGHT HOLDER> BE LIABLE FOR ANY
DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND
ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

The built-in sound decoder (`media/vp-audio.wasm`) is compiled from Symphonia 0.5.5 (https://github.com/pdeljanov/Symphonia, crates symphonia, symphonia-core, symphonia-codec-aac, symphonia-codec-alac, symphonia-codec-pcm, symphonia-codec-adpcm, symphonia-bundle-mp3, symphonia-format-isomp4, symphonia-format-mkv, symphonia-metadata, symphonia-utils-xiph) under the Mozilla Public License 2.0 (https://mozilla.org/MPL/2.0/). The Symphonia source code is available at https://github.com/pdeljanov/Symphonia and on crates.io. The glue code that builds it is in `wasm/` of https://github.com/theluckystrike/video-preview-vscode. Its dependencies `log`, `lazy_static`, `bytemuck`, `bitflags`, `cfg-if`, `scopeguard` and `arrayvec` are under MIT or Apache-2.0, and `encoding_rs` under (Apache-2.0 or MIT) and BSD-3-Clause.

ffmpeg and afconvert are not bundled. The extension runs the copy on your computer if there is one.
