// Captures the system audio (loopback) and sends the bass level ~60 times per second.
// The screen part of the capture is stopped immediately – only the audio level is measured,
// nothing is stored or sent anywhere.

(async function () {
  'use strict';

  const api = window.lyrovaAudio;
  const log = (level, msg) => api.log(level, '[Audio] ' + msg);

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch (err) {
    log('warn', 'System audio not available: ' + err.message);
    api.status(false);
    return;
  }
  stream.getVideoTracks().forEach((track) => track.stop());
  const tracks = stream.getAudioTracks();
  if (!tracks.length) {
    log('warn', 'No audio track in the capture');
    api.status(false);
    return;
  }

  const ctx = new AudioContext();
  await ctx.resume();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.2;
  // NOT connected to ctx.destination – otherwise the sound would play twice
  ctx.createMediaStreamSource(new MediaStream(tracks)).connect(analyser);

  const freq = new Float32Array(analyser.frequencyBinCount);
  const wave = new Float32Array(analyser.fftSize);
  const binHz = ctx.sampleRate / analyser.fftSize;
  const detector = new window.Lyrova.BassDetector();
  api.status(true);
  log('info', `Bass analysis running (${ctx.sampleRate} Hz)`);

  tracks[0].addEventListener('ended', () => {
    log('warn', 'Audio capture ended');
    api.status(false);
    api.level(0);
  });

  let paused = false;
  api.onPause((p) => {
    paused = p;
    if (p) { ctx.suspend(); api.level(0); } else ctx.resume();
  });

  let lastSent = -1;
  setInterval(() => {
    if (paused) return;
    analyser.getFloatFrequencyData(freq);
    analyser.getFloatTimeDomainData(wave);
    let sq = 0;
    for (let i = 0; i < wave.length; i++) sq += wave[i] * wave[i];
    const level = detector.process(freq, binHz, Math.sqrt(sq / wave.length));
    // only send when it changed (silence → nothing is sent at all)
    if (Math.abs(level - lastSent) > 0.005 || (level === 0 && lastSent !== 0)) {
      lastSent = level;
      api.level(Math.round(level * 1000) / 1000);
    }
  }, 16);
})();
