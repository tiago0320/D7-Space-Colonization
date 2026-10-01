/**
 * Client-side H.264 MP4 encoding for 3D Space turntable export.
 * Prefers WebCodecs + mp4-muxer. Falls back to MediaRecorder only when it can
 * produce a real video/mp4 (never a renamed WebM).
 */
(function (global) {
  const MUXER_URL = "https://cdn.jsdelivr.net/npm/mp4-muxer@5.2.2/+esm";

  function waitFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }

  function yieldUi() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  function bitrateFor(size, fps) {
    const px = Math.max(1, size) * Math.max(1, size);
    const raw = px * Math.max(24, fps) * 0.14;
    return Math.round(Math.max(8e6, Math.min(36e6, raw)));
  }

  function levelForSize(size) {
    if (size > 2048) return "33";
    if (size > 1400) return "32";
    return "28";
  }

  function codecCandidates(size) {
    const lv = levelForSize(size);
    return [`avc1.6400${lv}`, `avc1.4d00${lv}`, "avc1.4d0032", "avc1.42001f", "avc1.42E01E"];
  }

  async function pickVideoEncoderConfig(width, height, fps, bitrate) {
    if (typeof VideoEncoder === "undefined" || !VideoEncoder.isConfigSupported) return null;
    const codecs = codecCandidates(width);
    const hwModes = ["prefer-software", "no-preference", "prefer-hardware"];
    for (let c = 0; c < codecs.length; c++) {
      for (let h = 0; h < hwModes.length; h++) {
        const base = {
          codec: codecs[c],
          width,
          height,
          bitrate,
          framerate: fps,
          hardwareAcceleration: hwModes[h],
          bitrateMode: "constant",
        };
        const withAvc = Object.assign({}, base, { avc: { format: "avc" } });
        const tries = [withAvc, base];
        for (let t = 0; t < tries.length; t++) {
          try {
            const support = await VideoEncoder.isConfigSupported(tries[t]);
            if (support && support.supported) return support.config || tries[t];
          } catch (err) {}
        }
      }
    }
    return null;
  }

  function pickMp4RecorderMime() {
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
    const types = [
      "video/mp4;codecs=avc1.640032",
      "video/mp4;codecs=avc1.4d0032",
      "video/mp4;codecs=avc1.42E01E",
      "video/mp4;codecs=avc1",
      "video/mp4",
    ];
    for (let i = 0; i < types.length; i++) {
      if (MediaRecorder.isTypeSupported(types[i])) return types[i];
    }
    return "";
  }

  async function loadMuxer() {
    const mod = await import(MUXER_URL);
    const Muxer = mod.Muxer || (mod.default && mod.default.Muxer);
    const ArrayBufferTarget = mod.ArrayBufferTarget || (mod.default && mod.default.ArrayBufferTarget);
    if (!Muxer || !ArrayBufferTarget) throw new Error("MP4 muxer failed to load.");
    return { Muxer, ArrayBufferTarget };
  }

  function makeVideoFrame(canvas, timestamp, duration) {
    try {
      return new VideoFrame(canvas, { timestamp, duration, alpha: "discard" });
    } catch (err) {
      return new VideoFrame(canvas, { timestamp, duration });
    }
  }

  async function encodeWithWebCodecs(options) {
    const { canvas, width, height, fps, frameCount, bitrate, renderFrame, onProgress, signal } = options;
    const config = await pickVideoEncoderConfig(width, height, fps, bitrate);
    if (!config) throw new Error("WebCodecs H.264 is not available.");
    const { Muxer, ArrayBufferTarget } = await loadMuxer();
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: "avc", width, height },
      fastStart: "in-memory",
      firstTimestampBehavior: "offset",
    });
    let encoderError = null;
    const encoder = new VideoEncoder({
      output(chunk, meta) {
        muxer.addVideoChunk(chunk, meta);
      },
      error(err) {
        encoderError = err;
      },
    });
    encoder.configure(config);
    const frameDuration = Math.round(1e6 / fps);
    try {
      for (let i = 0; i < frameCount; i++) {
        if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
        if (encoderError) throw encoderError;
        renderFrame(i);
        let frame = makeVideoFrame(canvas, i * frameDuration, frameDuration);
        while (encoder.encodeQueueSize > 4) await waitFrame();
        encoder.encode(frame, { keyFrame: i % Math.max(1, fps) === 0 });
        frame.close();
        if (onProgress) onProgress(i + 1, frameCount, "render");
        await yieldUi();
      }
      if (onProgress) onProgress(frameCount, frameCount, "encode");
      await encoder.flush();
      if (encoderError) throw encoderError;
      muxer.finalize();
      const buffer = target.buffer;
      return new Blob([buffer], { type: "video/mp4" });
    } finally {
      try {
        if (encoder.state !== "closed") encoder.close();
      } catch (err) {}
    }
  }

  async function encodeWithMediaRecorder(options) {
    const { canvas, fps, frameCount, bitrate, renderFrame, onProgress, signal } = options;
    const mime = pickMp4RecorderMime();
    if (!mime) throw new Error("No MP4 MediaRecorder type is available.");
    const stream = canvas.captureStream(0);
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
    const chunks = [];
    rec.ondataavailable = (event) => {
      if (event.data && event.data.size) chunks.push(event.data);
    };
    rec.start(200);
    const track = stream.getVideoTracks()[0];
    const step = 1000 / fps;
    try {
      for (let i = 0; i < frameCount; i++) {
        if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
        renderFrame(i);
        if (track && typeof track.requestFrame === "function") track.requestFrame();
        if (onProgress) onProgress(i + 1, frameCount, "render");
        await new Promise((resolve) => setTimeout(resolve, step));
      }
      if (onProgress) onProgress(frameCount, frameCount, "encode");
      await new Promise((resolve, reject) => {
        rec.onstop = resolve;
        rec.onerror = () => reject(new Error("MP4 recording failed."));
        rec.stop();
      });
      const blob = new Blob(chunks, { type: "video/mp4" });
      if (!blob.size) throw new Error("MP4 recording was empty.");
      return blob;
    } finally {
      try {
        if (rec.state !== "inactive") rec.stop();
      } catch (err) {}
      stream.getTracks().forEach((item) => item.stop());
    }
  }

  function copyCanvas(source) {
    const copy = document.createElement("canvas");
    copy.width = source.width;
    copy.height = source.height;
    const ctx = copy.getContext("2d", { alpha: false });
    ctx.drawImage(source, 0, 0);
    return copy;
  }

  async function canvasToJpeg(canvas, quality) {
    const copy = copyCanvas(canvas);
    const blob = await new Promise((resolve, reject) => {
      copy.toBlob((item) => (item ? resolve(item) : reject(new Error("Frame capture failed."))), "image/jpeg", quality);
    });
    return new Uint8Array(await blob.arrayBuffer());
  }

  async function encodeWithFfmpeg(options) {
    const { canvas, fps, frameCount, renderFrame, onProgress, signal } = options;
    const ffmpegMod = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.10/+esm");
    const utilMod = await import("https://cdn.jsdelivr.net/npm/@ffmpeg/util@0.12.1/+esm");
    const FFmpeg = ffmpegMod.FFmpeg || (ffmpegMod.default && ffmpegMod.default.FFmpeg);
    const toBlobURL = utilMod.toBlobURL;
    if (!FFmpeg || !toBlobURL) throw new Error("ffmpeg.wasm failed to load.");
    const ffmpeg = new FFmpeg();
    const base = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd";
    await ffmpeg.load({
      coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    });
    try {
      for (let i = 0; i < frameCount; i++) {
        if (signal && signal.aborted) throw new DOMException("Aborted", "AbortError");
        renderFrame(i);
        const bytes = await canvasToJpeg(canvas, 0.95);
        await ffmpeg.writeFile(`frame${String(i + 1).padStart(4, "0")}.jpg`, bytes);
        if (onProgress) onProgress(i + 1, frameCount, "render");
        await yieldUi();
      }
      if (onProgress) onProgress(frameCount, frameCount, "encode");
      await ffmpeg.exec([
        "-y",
        "-framerate",
        String(fps),
        "-i",
        "frame%04d.jpg",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "fast",
        "-crf",
        "18",
        "-movflags",
        "+faststart",
        "out.mp4",
      ]);
      const data = await ffmpeg.readFile("out.mp4");
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      return new Blob([bytes], { type: "video/mp4" });
    } finally {
      try {
        ffmpeg.terminate();
      } catch (err) {}
    }
  }

  async function encodeMp4(options) {
    const width = Math.max(16, Math.round(options.width) & ~1);
    const height = Math.max(16, Math.round(options.height) & ~1);
    const fps = Math.max(1, Math.round(options.fps) || 30);
    const frameCount = Math.max(1, Math.round(options.frameCount) || 1);
    const bitrate = options.bitrate || bitrateFor(width, fps);
    const packed = Object.assign({}, options, { width, height, fps, frameCount, bitrate });
    const webOk = await pickVideoEncoderConfig(width, height, fps, bitrate);
    if (webOk) return encodeWithWebCodecs(packed);
    if (pickMp4RecorderMime()) return encodeWithMediaRecorder(packed);
    return encodeWithFfmpeg(packed);
  }

  global.D7SpatialTurntable = {
    bitrateFor,
    encodeMp4,
    canEncodeMp4() {
      return true;
    },
  };
})(window);
