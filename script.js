(() => {
  // ---------- DOM ----------
  const bpmText = document.getElementById("bpmText");
  const tempoName = document.getElementById("tempoName");
  const timeSigText = document.getElementById("timeSigText");
  const subdivText = document.getElementById("subdivText");
  const barBeatText = document.getElementById("barBeatText");

  const bpmRange = document.getElementById("bpmRange");
  const bpmInput = document.getElementById("bpmInput");
  const tapBtn = document.getElementById("tapBtn");
  const dialBtn = document.getElementById("dialBtn");
  const playIcon = document.getElementById("playIcon");

  const numMinus = document.getElementById("numMinus");
  const numPlus = document.getElementById("numPlus");
  const denMinus = document.getElementById("denMinus");
  const denPlus = document.getElementById("denPlus");
  const numValue = document.getElementById("numValue");
  const denValue = document.getElementById("denValue");

  const subdivSelect = document.getElementById("subdivSelect");
  const subdivSound = document.getElementById("subdivSound");
  const volRange = document.getElementById("volRange");
  const soundSelect = document.getElementById("soundSelect");
  const resetAccentBtn = document.getElementById("resetAccentBtn");

  const accentGrid = document.getElementById("accentGrid");

  // ---------- State ----------
  let bpm = 65;

  // time signature: numerator / denominator (beat unit)
  let tsNum = 4;
  let tsDen = 4;

  // accents: per beat in bar: 2=strong, 1=normal, 0=mute
  let accents = [];

  // playback
  let isRunning = false;
  let audioCtx = null;
  let masterGain = null;
  let nextBeatTime = 0;
  let currentBeatInBar = 0; // 0..tsNum-1
  let timerId = null;

  // scheduling
  const lookaheadMs = 25;
  const scheduleAheadTime = 0.12;

  // tap tempo
  const taps = [];

  // ---------- Subdivision patterns ----------
  // Each pattern returns an array of fractions that sum to 1 beat.
  // Clicks happen at cumulative times: 0, f0, f0+f1, ...
  function getSubdivPattern(mode) {
    switch (mode) {
      case "quarter":   return [1];
      case "eighth":    return [0.5, 0.5];
      case "triplet":   return [1/3, 1/3, 1/3];
      case "sixteenth": return [0.25, 0.25, 0.25, 0.25];
      case "swing":     return [2/3, 1/3];         // offbeat delayed
      case "8-16-16":   return [0.5, 0.25, 0.25];  // 1/8 + 1/16 + 1/16 (of a quarter-beat)
      case "16-8-16":   return [0.25, 0.5, 0.25];
      case "16-16-8":   return [0.25, 0.25, 0.5];
      default:          return [0.5, 0.5];
    }
  }

  function prettySubdivName(mode) {
    const map = {
      "quarter": "Quarter",
      "eighth": "Eighth",
      "triplet": "Triplet",
      "sixteenth": "Sixteenth",
      "swing": "Swing",
      "8-16-16": "8-16-16",
      "16-8-16": "16-8-16",
      "16-16-8": "16-16-8",
    };
    return map[mode] || mode;
  }

  function tempoWord(bpmVal) {
    // 简化常见速度术语（够用且直观）
    if (bpmVal < 40) return "Grave";
    if (bpmVal < 60) return "Largo";
    if (bpmVal < 76) return "Adagio";
    if (bpmVal < 108) return "Andante";
    if (bpmVal < 120) return "Moderato";
    if (bpmVal < 168) return "Allegro";
    if (bpmVal < 200) return "Presto";
    return "Prestissimo";
  }

  // ---------- Audio ----------
  function ensureAudio() {
    if (audioCtx) return;

    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volRange.value);
    masterGain.connect(audioCtx.destination);
  }

  let audioUnlocked = false;

function unlockAudioOnce() {
  // 必须在用户手势里调用（touch/click）
  ensureAudio();

  return audioCtx.resume().then(() => {
    if (audioUnlocked) return;

    // 关键：播放一个极短、几乎听不见的“静音”声音来解锁 iOS
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    g.gain.setValueAtTime(0.00001, t);

    osc.frequency.setValueAtTime(440, t);
    osc.connect(g);
    g.connect(masterGain);

    osc.start(t);
    osc.stop(t + 0.01);

    audioUnlocked = true;
  }).catch(() => {});
}


  function resumeAudioIfNeeded() {
    ensureAudio();
    if (audioCtx.state !== "running") {
      return audioCtx.resume();
    }
    return Promise.resolve();
  }

  function playTick(time, kind, strength = 1) {
    // kind: "beat" | "sub"
    // strength: 0..1
    const mode = soundSelect.value;

    const g = audioCtx.createGain();
    g.connect(masterGain);

    // volume envelope
    const baseVol = (kind === "beat") ? 0.9 : 0.55;
    const vol = baseVol * strength;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    if (mode === "click") {
      const osc = audioCtx.createOscillator();
      osc.type = "square";
      const freq = (kind === "beat") ? 2000 : 1400;
      osc.frequency.setValueAtTime(freq, time);

      osc.connect(g);
      osc.start(time);
      osc.stop(time + 0.06);
      return;
    }

    if (mode === "wood") {
      // “木鱼感”：短噪声 + 带通
      const bufferSize = Math.floor(audioCtx.sampleRate * 0.06);
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        // 衰减噪声
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize / 5));
      }
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;

      const bp = audioCtx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.setValueAtTime((kind === "beat") ? 1200 : 900, time);
      bp.Q.setValueAtTime(9, time);

      src.connect(bp);
      bp.connect(g);
      src.start(time);
      src.stop(time + 0.07);
      return;
    }

    // beep：更音乐化
    const osc = audioCtx.createOscillator();
    osc.type = "sine";
    const freq = (kind === "beat") ? 880 : 660;
    osc.frequency.setValueAtTime(freq, time);
    osc.connect(g);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  // ---------- Metronome core ----------
  function secondsPerBeat() {
    // bpm is defined on the denominator (beat unit)
    return 60 / bpm;
  }

  function scheduleBeat(beatTime, beatIndexInBar) {
    // beat click (respect accent)
    const level = accents[beatIndexInBar] ?? 1;
    if (level > 0) {
      const strength = (level === 2) ? 1.0 : 0.72;
      playTick(beatTime, "beat", strength);
    }

    // subdivisions inside the beat
    if (!subdivSound.checked) return;

    const mode = subdivSelect.value;
    const pattern = getSubdivPattern(mode);
    if (pattern.length <= 1) return;

    let t = beatTime;
    let cum = 0;
    const spb = secondsPerBeat();

    // schedule ticks excluding the first (already played as beat)
    for (let i = 1; i < pattern.length; i++) {
      cum += pattern[i - 1];
      const st = t + cum * spb;

      // Subdiv tick softer; if the beat itself is muted, still allow subdiv? ——这里跟随开关与 beat mute 不强绑
      playTick(st, "sub", 0.55);
    }
  }

  function scheduler() {
    const now = audioCtx.currentTime;
    while (nextBeatTime < now + scheduleAheadTime) {
      scheduleBeat(nextBeatTime, currentBeatInBar);

      // UI beat indicator (not audio-timed perfect, but good enough)
      barBeatText.textContent = `${currentBeatInBar + 1} / ${tsNum}`;

      nextBeatTime += secondsPerBeat();
      currentBeatInBar = (currentBeatInBar + 1) % tsNum;
    }
  }

  function start() {
    if (isRunning) return;
    resumeAudioIfNeeded().then(() => {
      isRunning = true;
      dialBtn.classList.add("playing");
      nextBeatTime = audioCtx.currentTime + 0.05;
      currentBeatInBar = 0;

      timerId = setInterval(scheduler, lookaheadMs);
    });
  }

  function stop() {
    if (!isRunning) return;
    isRunning = false;
    dialBtn.classList.remove("playing");
    clearInterval(timerId);
    timerId = null;
  }

  function toggle() {
    if (isRunning) stop();
    else start();
  }

  // ---------- Accent UI ----------
  function initAccents() {
    accents = new Array(tsNum).fill(1);
    accents[0] = 2; // default: strong on 1
  }

  function renderAccentGrid() {
    accentGrid.innerHTML = "";
    accentGrid.style.gridAutoColumns = `minmax(26px, 1fr)`;

    accents.forEach((lvl, idx) => {
      const cell = document.createElement("div");
      cell.className = `accent-cell level-${lvl}`;
      cell.title = `第${idx + 1}拍：点击切换 强/中/静音`;
      const label = document.createElement("strong");
      label.textContent = idx + 1;
      cell.appendChild(label);

      cell.addEventListener("click", () => {
        // cycle: 2 -> 1 -> 0 -> 2
        accents[idx] = (accents[idx] === 2) ? 1 : (accents[idx] === 1 ? 0 : 2);
        renderAccentGrid();
      });

      accentGrid.appendChild(cell);
    });
  }

  // ---------- UI updates ----------
  function updateDisplays() {
    bpmText.textContent = String(bpm);
    tempoName.textContent = tempoWord(bpm);

    numValue.textContent = String(tsNum);
    denValue.textContent = String(tsDen);
    timeSigText.textContent = `${tsNum}/${tsDen}`;

    subdivText.textContent = prettySubdivName(subdivSelect.value);
  }

  function setBpm(newBpm) {
    const v = Math.max(30, Math.min(260, Math.round(Number(newBpm) || bpm)));
    bpm = v;
    bpmRange.value = String(bpm);
    bpmInput.value = String(bpm);
    updateDisplays();
  }

  function setTimeSig(newNum, newDen) {
    tsNum = Math.max(1, Math.min(16, newNum));
    const allowedDen = [1,2,4,8,16];
    tsDen = allowedDen.includes(newDen) ? newDen : tsDen;

    // resize accents preserving as much as possible
    const old = accents.slice();
    accents = new Array(tsNum).fill(1);
    for (let i = 0; i < Math.min(old.length, accents.length); i++) accents[i] = old[i];
    if (accents.length > 0 && accents[0] === 1) accents[0] = 2;

    updateDisplays();
    renderAccentGrid();
  }

  // ---------- Tap tempo ----------
  function handleTap() {
    const now = performance.now();
    taps.push(now);
    while (taps.length > 8) taps.shift();

    if (taps.length >= 2) {
      const intervals = [];
      for (let i = 1; i < taps.length; i++) intervals.push(taps[i] - taps[i - 1]);

      // drop extreme outlier if user pauses
      const filtered = intervals.filter(ms => ms < 2000);
      if (filtered.length >= 2) {
        const avgMs = filtered.reduce((a,b) => a + b, 0) / filtered.length;
        const newBpm = 60000 / avgMs;
        setBpm(newBpm);
      }
    }
  }

  // ---------- Events ----------
  dialBtn.addEventListener("click", () => {
  unlockAudioOnce().then(() => toggle());
});


  bpmRange.addEventListener("input", (e) => setBpm(e.target.value));
  bpmInput.addEventListener("change", (e) => setBpm(e.target.value));

  volRange.addEventListener("input", () => {
    if (masterGain) masterGain.gain.value = parseFloat(volRange.value);
  });

tapBtn.addEventListener("click", () => {
  unlockAudioOnce().then(handleTap);
});


  document.addEventListener("keydown", (e) => {
    // Space for TAP
    if (e.code === "Space") {
      e.preventDefault();
      resumeAudioIfNeeded().then(handleTap);
    }
    // Enter for start/stop
    if (e.code === "Enter") toggle();
  });

  subdivSelect.addEventListener("change", () => updateDisplays());

  resetAccentBtn.addEventListener("click", () => {
    initAccents();
    renderAccentGrid();
  });

  numMinus.addEventListener("click", () => setTimeSig(tsNum - 1, tsDen));
  numPlus.addEventListener("click", () => setTimeSig(tsNum + 1, tsDen));

  denMinus.addEventListener("click", () => {
    const options = [1,2,4,8,16];
    const idx = options.indexOf(tsDen);
    setTimeSig(tsNum, options[Math.max(0, idx - 1)]);
  });
  denPlus.addEventListener("click", () => {
    const options = [1,2,4,8,16];
    const idx = options.indexOf(tsDen);
    setTimeSig(tsNum, options[Math.min(options.length - 1, idx + 1)]);
  });

  // ---------- Init ----------
  initAccents();
  renderAccentGrid();
  updateDisplays();
  // 手机端音频解锁：任意首次触摸/点击都尝试解锁
["touchstart", "pointerdown", "mousedown"].forEach(evt => {
  window.addEventListener(evt, () => unlockAudioOnce(), { passive: true, once: true });
});
  // 微信 WebView：有时需要等 WeixinJSBridge 就绪再解锁
document.addEventListener("WeixinJSBridgeReady", () => unlockAudioOnce(), false);

  // if user changes TS quickly, keep UI stable
  setBpm(bpm);
  setTimeSig(tsNum, tsDen);
})();

