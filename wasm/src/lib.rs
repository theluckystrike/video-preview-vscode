//! Sound decoder for the VS Code video player: reads the file through the host (no whole-file load),
//! decodes the first audio track and hands interleaved 16-bit PCM (stereo or mono) back to the host.
//! Exports: alloc, decode. Imports (module "env"): host_size, host_read, host_write, host_info, host_progress.
use std::io::{Read, Seek, SeekFrom};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::{DecoderOptions, CODEC_TYPE_NULL};
use symphonia::core::errors::Error;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::{MediaSource, MediaSourceStream, MediaSourceStreamOptions};
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

#[link(wasm_import_module = "env")]
extern "C" {
    fn host_size() -> f64;
    fn host_read(pos: f64, ptr: *mut u8, len: u32) -> i32;
    fn host_write(ptr: *const u8, len: u32);
    fn host_info(rate: u32, channels: u32, src_channels: u32, name_ptr: *const u8, name_len: u32, start: f64);
    fn host_progress(seconds: f64);
}

struct HostSource { pos: u64, len: u64 }

impl Read for HostSource {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if self.pos >= self.len || buf.is_empty() { return Ok(0); }
        let want = buf.len().min((self.len - self.pos) as usize).min(1 << 24);
        let n = unsafe { host_read(self.pos as f64, buf.as_mut_ptr(), want as u32) };
        if n < 0 { return Err(std::io::Error::new(std::io::ErrorKind::Other, "read failed")); }
        self.pos += n as u64;
        Ok(n as usize)
    }
}

impl Seek for HostSource {
    fn seek(&mut self, to: SeekFrom) -> std::io::Result<u64> {
        let p: i128 = match to {
            SeekFrom::Start(n) => n as i128,
            SeekFrom::End(n) => self.len as i128 + n as i128,
            SeekFrom::Current(n) => self.pos as i128 + n as i128,
        };
        if p < 0 { return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "negative seek")); }
        self.pos = p as u64;
        Ok(self.pos)
    }
}

impl MediaSource for HostSource {
    fn is_seekable(&self) -> bool { true }
    fn byte_len(&self) -> Option<u64> { Some(self.len) }
}

#[no_mangle]
pub extern "C" fn alloc(len: u32) -> *mut u8 {
    let mut v = Vec::<u8>::with_capacity(len as usize);
    let p = v.as_mut_ptr();
    std::mem::forget(v);
    p
}

/// Status codes (negative = failure).
const E_PROBE: i32 = -1; // not a container we read
const E_NO_AUDIO: i32 = -2; // no audio track
const E_CODEC: i32 = -3; // audio codec we have no decoder for
const E_DECODE: i32 = -4; // nothing decoded

fn write_i16(out: &mut Vec<u8>) {
    if !out.is_empty() { unsafe { host_write(out.as_ptr(), out.len() as u32) }; out.clear(); }
}

/// hint: 1 mp4/mov, 2 mkv/webm, 0 none. skip: seconds to drop at the start (encoder delay from the MP4 edit list);
/// a negative skip means "use the delay the container states" (Matroska CodecDelay). pad: frames of silence first
/// (an MP4 empty edit), in seconds. Returns the number of output frames written, or a negative status.
#[no_mangle]
pub extern "C" fn decode(hint_kind: u32, skip_in: f64, pad_in: f64) -> f64 {
    let len = unsafe { host_size() } as u64;
    let src = HostSource { pos: 0, len };
    let mss = MediaSourceStream::new(Box::new(src), MediaSourceStreamOptions { buffer_len: 1 << 18 });
    let mut hint = Hint::new();
    match hint_kind { 1 => { hint.with_extension("mp4"); } 2 => { hint.with_extension("mkv"); } _ => {} }
    let fmt_opts = FormatOptions { enable_gapless: true, ..Default::default() };
    let probed = match symphonia::default::get_probe().format(&hint, mss, &fmt_opts, &MetadataOptions::default()) {
        Ok(p) => p,
        Err(_) => return E_PROBE as f64,
    };
    let mut format = probed.format;
    let track = match format.tracks().iter().find(|t| t.codec_params.codec != CODEC_TYPE_NULL && t.codec_params.sample_rate.is_some()) {
        Some(t) => t.clone(),
        None => return E_NO_AUDIO as f64,
    };
    let codec_name: &'static str = symphonia::default::get_codecs().get_codec(track.codec_params.codec).map(|d| d.short_name).unwrap_or("");
    let mut dec = match symphonia::default::get_codecs().make(&track.codec_params, &DecoderOptions::default()) {
        Ok(d) => d,
        Err(_) => return E_CODEC as f64,
    };
    let mut rate = track.codec_params.sample_rate.unwrap_or(48000);
    let mut skip: u64 = 0;
    let mut skip_total: u64 = 0;
    let mut pad: u64 = 0;
    let tb = track.codec_params.time_base;
    let mut out_ch: u32 = 0;
    let mut written: u64 = 0; // output frames
    let mut out: Vec<u8> = Vec::with_capacity(1 << 20);
    let mut sbuf: Option<SampleBuffer<f32>> = None;
    let mut last_progress = 0f64;
    let mut errors = 0u32;
    loop {
        let pkt = match format.next_packet() {
            Ok(p) => p,
            Err(Error::IoError(_)) => break,
            Err(Error::ResetRequired) => break,
            Err(_) => { errors += 1; if errors > 1000 { break; } continue; }
        };
        if pkt.track_id() != track.id { continue; }
        let decoded = match dec.decode(&pkt) {
            Ok(d) => d,
            Err(Error::DecodeError(_)) => { errors += 1; continue; }
            Err(Error::IoError(_)) => { errors += 1; continue; }
            Err(_) => break,
        };
        let spec = *decoded.spec();
        let src_ch = spec.channels.count() as u32;
        if out_ch == 0 {
            out_ch = if src_ch >= 2 { 2 } else { 1 };
            // The rate of the decoded sound wins over the container's (HE-AAC: the container says 44.1 kHz,
            // the AAC-LC core decodes at 22.05 kHz).
            if spec.rate > 0 { rate = spec.rate; }
            skip = if skip_in < 0.0 { track.codec_params.delay.unwrap_or(0) as u64 } else { (skip_in * rate as f64).round() as u64 };
            skip_total = skip;
            pad = if pad_in > 0.0 && pad_in < 3600.0 { (pad_in * rate as f64).round() as u64 } else { 0 };
            let start = tb.map(|t| { let tm = t.calc_time(pkt.ts()); tm.seconds as f64 + tm.frac }).unwrap_or(0.0);
            unsafe { host_info(rate, out_ch, src_ch, codec_name.as_ptr(), codec_name.len() as u32, start) };
            if pad > 0 { out.resize(out.len() + pad as usize * out_ch as usize * 2, 0); written += pad; }
        }
        // Keep the sound on the file's timeline: pad a gap (or a late start) with silence.
        if let Some(t) = tb {
            let tm = t.calc_time(pkt.ts());
            let at = ((tm.seconds as f64 + tm.frac) * rate as f64).round() as i64; // rate: the decoded one
            let gap = at - skip_total as i64 + pad as i64 - written as i64;
            if gap > (rate as i64) / 20 && gap < (rate as i64) * 3600 {
                let zeros = (gap as usize) * out_ch as usize * 2;
                out.resize(out.len() + zeros, 0);
                written += gap as u64;
                if out.len() > (1 << 20) { write_i16(&mut out); }
            }
        }
        let frames = decoded.frames();
        if frames == 0 { continue; }
        if sbuf.as_ref().map(|b| b.capacity() < frames * spec.channels.count()).unwrap_or(true) {
            sbuf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
        }
        let b = sbuf.as_mut().unwrap();
        b.copy_interleaved_ref(decoded);
        let drop = skip.min(frames as u64) as usize;
        skip -= drop as u64;
        if drop >= frames { continue; }
        let sc = spec.channels.count();
        push_frames(&b.samples()[drop * sc..frames * sc], src_ch as usize, out_ch as usize, &mut out);
        written += (frames - drop) as u64;
        if out.len() >= (1 << 20) { write_i16(&mut out); }
        let secs = written as f64 / rate as f64;
        if secs - last_progress >= 2.0 { last_progress = secs; unsafe { host_progress(secs) }; }
    }
    write_i16(&mut out);
    if written == 0 { return E_DECODE as f64; }
    written as f64
}

fn clip(v: f32) -> i16 { (v.max(-1.0).min(1.0) * 32767.0) as i16 }

/// Interleaved f32 in, 16-bit LE out. More than 2 channels: ITU-style stereo downmix of the first 6
/// (L R C LFE Ls Rs order, as AAC and Symphonia give them).
fn push_frames(s: &[f32], src_ch: usize, out_ch: usize, out: &mut Vec<u8>) {
    let n = s.len() / src_ch.max(1);
    for i in 0..n {
        let f = &s[i * src_ch..(i + 1) * src_ch];
        if out_ch == 1 {
            out.extend_from_slice(&clip(f[0]).to_le_bytes());
        } else if src_ch == 2 {
            out.extend_from_slice(&clip(f[0]).to_le_bytes());
            out.extend_from_slice(&clip(f[1]).to_le_bytes());
        } else {
            let g = |k: usize| if k < src_ch { f[k] } else { 0.0 };
            let c = 0.7071;
            let (l, r) = if src_ch >= 6 {
                (g(0) + c * g(2) + c * g(4), g(1) + c * g(2) + c * g(5))
            } else if src_ch == 3 {
                (g(0) + c * g(2), g(1) + c * g(2))
            } else {
                (g(0) + c * g(2), g(1) + c * g(3))
            };
            let k = 1.0 / (1.0 + 2.0 * c);
            out.extend_from_slice(&clip(l * k).to_le_bytes());
            out.extend_from_slice(&clip(r * k).to_le_bytes());
        }
    }
}
