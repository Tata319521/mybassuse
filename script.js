(() => {
  // ---------- DOM ----------
  const playBtn = document.getElementById("playBtn");
  const playIcon = document.getElementById("playIcon");
  const playText = document.getElementById("playText");

  const bpmRange = document.getElementById("bpmRange");
  const bpmInput = document.getElementById("bpmInput");
  const tapBtn = document.getElementById("tapBtn");
  const volRange = document.getElementById("volRange");

  const numMinus = document.getElementById("numMinus");
  const numPlus = document.getElementById("numPlus");
  const denMinus = document.getElementById("denMinus");
  const denPlus = document.getElementById("denPlus");
  const numValue = document.getElementById("numValue");
  const denValue = document.getElementById("denValue");

  const timeSigText = document.getElementById("timeSigText");
  const barBeatText = document.getElementById("barBeatText");

  const subdivSelect = document.getElementById("subdivSelect");
  const subdivSound = document.getElementById("subdivSound");

  const accentGrid = document.getElementById("accentGrid");
  const resetAccentBtn = document.getElementById("resetAccentBtn");

  // ---------- State ----------
  let bpm = 65;
  let tsNum = 4;
  let tsDen = 4;

  // accents: 2=strong, 1=normal, 0=mute
  let accents = [];

  // playback
  let isRunning = false;
  let audioCtx = null;
  let masterGain = null;
  let nextBeatTime = 0;
  let currentBeatInBar = 0;
  let timerId = null;

  // scheduling
  const lookaheadMs = 25;
  const scheduleAheadTime = 0.12;

  // tap tempo
  const taps = [];

  // ---------- Subdivision patterns ----------
  function getSubdivPattern(mode) {
    switch (mode) {
      case "quarter":   return [1];
      case "eighth":    return [0.5, 0.5];
      case "triplet":   return [1/3, 1/3, 1/3];
      case "sixteenth": return [0.25, 0.25, 0.25, 0.25];
      case "swing":     return [2/3, 1/3];
      case "8-16-16":   return [0.5, 0.25, 0.25];
      case "16-8-16":   return [0.25, 0.5, 0.25];
      case "16-16-8":   return [0.25, 0.25, 0.5];
      default:          return [1];
    }
  }

  // ---------- Audio (unlock + simple click only) ----------
  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = parseFloat(volRange.value);
    masterGain.connect(audioCtx.destination);
  }

  let audioUnlocked = false;
  function unlockAudioOnce() {
    ensureAudio();
    return audioCtx.resume().then(() => {
      if (audioUnlocked) return;

      // iOS 常需要一次“极短的静音”来解锁
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      g.gain.setValueAtTime(0.00001, t);

      osc.type = "sine";
      osc.frequency.setValueAtTime(440, t);
      osc.connect(g);
      g.connect(masterGain);

      osc.start(t);
      osc.stop(t + 0.01);

      audioUnlocked = true;
    }).catch(() => {});
  }

  // 只保留基础 click：强拍/普通拍/细分用不同音高/音色（波形）
  function playTick(time, kind, strength = 1) {
    // kind: "strong" | "beat" | "sub"
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();

    // 音高 + “音色”（波形）区分
    if (kind === "strong") {
      osc.type = "square";          // 更亮：像“滴”
      osc.frequency.setValueAtTime(2200, time);
    } else if (kind === "beat") {
      osc.type = "sine";            // 更圆：像“嘟”
      osc.frequency.setValueAtTime(1500, time);
    } else {
      osc.type = "sine";
      osc.frequency.setValueAtTime(1200, time); // 细分更低一点
    }

    // 包络：短促 click
    const base = (kind === "sub") ? 0.45 : 0.9;
    const vol = Math.max(0.0002, base * strength);

    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(vol, time + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    osc.connect(g);
    g.connect(masterGain);

    osc.start(time);
    osc.stop(time + 0.06);
  }

  // ---------- Metronome core ----------
  function secondsPerBeat() {
    return 60 / bpm;
  }

  function scheduleBeat(beatTime, beatIndexInBar) {
    // main beat click (respect accent)
    const level = accents[beatIndexInBar] ?? 1;

    if (level === 2) {
      playTick(beatTime, "strong", 1.0);
    } else if (level === 1) {
      playTick(beatTime, "beat", 0.72);
    } // level 0 -> mute

    // subdivisions inside the beat (default off)
    if (!subdivSound.checked) return;

    const pattern = getSubdivPattern(subdivSelect.value);
    if (pattern.length <= 1) return;

    const spb = secondsPerBeat();
    let cum = 0;

    // 细分 tick 不包含第一个（第一个已经作为主拍播放/或静音）
    for (let i = 1; i < pattern.length; i++) {
      cum += pattern[i - 1];
      const st = beatTime + cum * spb;
      playTick(st, "sub", 0.55);
    }
  }

  function scheduler() {
    const now = audioCtx.currentTime;

    while (nextBeatTime < now + scheduleAheadTime) {
      scheduleBeat(nextBeatTime, currentBeatInBar);

      // UI
      barBeatText.textContent = `${currentBeatInBar + 1} / ${tsNum}`;

      nextBeatTime += secondsPerBeat();
      currentBeatInBar = (currentBeatInBar + 1) % tsNum;
    }
  }

  function start() {
    if (isRunning) return;

    unlockAudioOnce().then(() => {
      isRunning = true;
      playBtn.classList.add("playing");
      playIcon.textContent = "❚❚";
      playText.textContent = "停止";

      nextBeatTime = audioCtx.currentTime + 0.05;
      currentBeatInBar = 0;

      timerId = setInterval(scheduler, lookaheadMs);
    });
  }

  function stop() {
    if (!isRunning) return;

    isRunning = false;
    playBtn.classList.remove("playing");
    playIcon.textContent = "▶";
    playText.textContent = "播放";

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
    accents[0] = 2; // 默认第1拍重音
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
  function setBpm(newBpm) {
    const v = Math.max(30, Math.min(260, Math.round(Number(newBpm) || bpm)));
    bpm = v;
    bpmRange.value = String(bpm);
    bpmInput.value = String(bpm);
  }

  function setTimeSig(newNum, newDen) {
    tsNum = Math.max(1, Math.min(16, newNum));

    const allowedDen = [1,2,4,8,16];
    tsDen = allowedDen.includes(newDen) ? newDen : tsDen;

    // resize accents
    const old = accents.slice();
    accents = new Array(tsNum).fill(1);
    for (let i = 0; i < Math.min(old.length, accents.length); i++) accents[i] = old[i];
    if (accents.length > 0 && accents[0] === 1) accents[0] = 2;

    numValue.textContent = String(tsNum);
    denValue.textContent = String(tsDen);
    timeSigText.textContent = `${tsNum}/${tsDen}`;

    // beat display sync
    barBeatText.textContent = `${Math.min(currentBeatInBar + 1, tsNum)} / ${tsNum}`;

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

      const filtered = intervals.filter(ms => ms < 2000);
      if (filtered.length >= 2) {
        const avgMs = filtered.reduce((a,b) => a + b, 0) / filtered.length;
        const newBpm = 60000 / avgMs;
        setBpm(newBpm);
      }
    }
  }

  // ---------- Events ----------
  playBtn.addEventListener("click", () => toggle());

  bpmRange.addEventListener("input", (e) => setBpm(e.target.value));
  bpmInput.addEventListener("change", (e) => setBpm(e.target.value));

  volRange.addEventListener("input", () => {
    if (masterGain) masterGain.gain.value = parseFloat(volRange.value);
  });

  tapBtn.addEventListener("click", () => {
    unlockAudioOnce().then(handleTap);
  });

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      e.preventDefault();
      unlockAudioOnce().then(handleTap);
    }
    if (e.code === "Enter") toggle();
  });

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

  // 移动端更稳：任意首次触摸/按下都尝试解锁
  ["touchstart", "pointerdown", "mousedown"].forEach(evt => {
    window.addEventListener(evt, () => unlockAudioOnce(), { passive: true, once: true });
  });
  // 微信 WebView 有时需要这个
  document.addEventListener("WeixinJSBridgeReady", () => unlockAudioOnce(), false);

  // ---------- Init (defaults) ----------
  // 默认：65 BPM、4/4、细分音关闭
  setBpm(65);
  tsNum = 4;
  tsDen = 4;
  subdivSound.checked = false;

  initAccents();
  renderAccentGrid();
  setTimeSig(4, 4); // also updates UI
})();
