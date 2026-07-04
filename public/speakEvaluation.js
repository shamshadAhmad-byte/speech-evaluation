/* ------------------------------------------------------------------ */
/*  AirCheck — Speaking Evaluation Studio (vanilla JS)                 */
/*                                                                      */
/*  Captures 100–200 words of speech (Web Speech API, with a manual-    */
/*  typing fallback for unsupported browsers) and sends the transcript  */
/*  to your evaluation backend for scoring.                             */
/*                                                                      */
/*  BACKEND CONTRACT                                                    */
/*  POSTs to EVAL_ENDPOINT with { topic, transcript } and expects:      */
/*  {                                                                    */
/*    grammar:    { score: 0-100, feedback: string },                   */
/*    vocabulary: { score: 0-100, feedback: string },                   */
/*    overall:    { score: 0-100, feedback: string },                   */
/*    suggestions: string[]                                             */
/*  }                                                                    */
/*  Keep your Gemini API key server-side — point EVAL_ENDPOINT at your  */
/*  own backend route, which then calls Gemini. If that route isn't     */
/*  live, this falls back to a local heuristic mock so the UI is fully  */
/*  demoable on its own.                                                */
/* ------------------------------------------------------------------ */

const EVAL_ENDPOINT = "/api/evaluate-speech";

const TOPICS = [
  { category: "Technology", prompt: "Should social media platforms be required to verify the age of their users?" },
  { category: "Personal", prompt: "Describe a decision you made that turned out differently than you expected." },
  { category: "Society", prompt: "Is it better to specialize in one skill or be broadly competent in many?" },
  { category: "Environment", prompt: "What is one everyday habit that could meaningfully reduce waste?" },
  { category: "Culture", prompt: "How has the way people spend their free time changed in the last decade?" },
  { category: "Work", prompt: "Do you think remote work makes teams more or less effective?" },
  { category: "Education", prompt: "Should schools place more emphasis on practical skills over academic theory?" },
  { category: "Travel", prompt: "Describe a place you would like to visit and explain why it appeals to you." },
];

const WORD_MIN = 100;
const WORD_MAX = 200;

/* ------------------------------ State -------------------------------- */

let topicIndex = 0;
let isRecording = false;
let elapsedSeconds = 0;
let timerInterval = null;
let barInterval = null;
let recognition = null;
let finalTranscript = "";
let speechSupported = true;

/* ------------------------------ Elements ------------------------------ */

const el = {
  topicTag: document.getElementById("topicTag"),
  topicPrompt: document.getElementById("topicPrompt"),
  shuffleBtn: document.getElementById("shuffleBtn"),
  onAirIndicator: document.getElementById("onAirIndicator"),
  onAirText: document.getElementById("onAirText"),
  timer: document.getElementById("timer"),
  waveform: document.getElementById("waveform"),
  micBtn: document.getElementById("micBtn"),
  micIcon: document.getElementById("micIcon"),
  recordHint: document.getElementById("recordHint"),
  transcript: document.getElementById("transcript"),
  wordcount: document.getElementById("wordcount"),
  wordcountText: document.getElementById("wordcountText"),
  wordcountCheck: document.getElementById("wordcountCheck"),
  clearBtn: document.getElementById("clearBtn"),
  evaluateBtn: document.getElementById("evaluateBtn"),
  emptyState: document.getElementById("emptyState"),
  loadingState: document.getElementById("loadingState"),
  errorState: document.getElementById("errorState"),
  reportState: document.getElementById("reportState"),
  overallGauge: document.getElementById("overallGauge"),
  overallFeedback: document.getElementById("overallFeedback"),
  grammarGauge: document.getElementById("grammarGauge"),
  grammarFeedback: document.getElementById("grammarFeedback"),
  vocabGauge: document.getElementById("vocabGauge"),
  vocabFeedback: document.getElementById("vocabFeedback"),
  suggestionsList: document.getElementById("suggestionsList"),
  demoNote: document.getElementById("demoNote"),
};

/* ---------------------------- Helpers --------------------------------- */

function countWords(text) {
  const t = text.trim();
  return t.length ? t.split(/\s+/).length : 0;
}

function formatTime(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function scoreColor(score) {
  if (score >= 85) return "var(--mint)";
  if (score >= 70) return "var(--amber)";
  return "var(--coral)";
}

function overallLabel(score) {
  if (score >= 90) return "Broadcast Ready";
  if (score >= 75) return "On Point";
  if (score >= 60) return "Needs Polish";
  return "Off Air";
}

function normalizeEvaluationResponse(raw, transcript, topic) {
  const payload = raw && typeof raw === "object" ? raw.result ?? raw.data ?? raw.payload ?? raw : null;

  if (!payload || typeof payload !== "object") {
    return generateMockEvaluation(transcript, topic);
  }

  const coerceScore = (value) => {
    const score = Number(value);
    return Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  };

  const suggestions = Array.isArray(payload.suggestions)
    ? payload.suggestions.map((item) => String(item))
    : generateMockEvaluation(transcript, topic).suggestions;

  return {
    _demo: Boolean(payload._demo),
    grammar: {
      score: coerceScore(payload.grammar?.score ?? payload.grammar),
      feedback: String(payload.grammar?.feedback ?? "Grammar feedback was not returned."),
    },
    vocabulary: {
      score: coerceScore(payload.vocabulary?.score ?? payload.vocabulary),
      feedback: String(payload.vocabulary?.feedback ?? "Vocabulary feedback was not returned."),
    },
    overall: {
      score: coerceScore(payload.overall?.score ?? payload.overallScore ?? payload.overall),
      feedback: String(payload.overall?.feedback ?? payload.overallFeedback ?? "Overall feedback was not returned."),
    },
    suggestions,
  };
}

/* ------------------------------- Topic --------------------------------- */

function renderTopic() {
  const topic = TOPICS[topicIndex];
  el.topicTag.textContent = topic.category;
  el.topicPrompt.textContent = topic.prompt;
}

el.shuffleBtn.addEventListener("click", () => {
  let next = Math.floor(Math.random() * TOPICS.length);
  if (next === topicIndex) next = (next + 1) % TOPICS.length;
  topicIndex = next;
  renderTopic();
  resetSession();
});

/* ----------------------------- Waveform -------------------------------- */

function buildWaveformBars(count) {
  el.waveform.innerHTML = "";
  for (let i = 0; i < count; i++) {
    const bar = document.createElement("span");
    bar.style.height = "8%";
    el.waveform.appendChild(bar);
  }
}
buildWaveformBars(28);

function animateWaveform() {
  const bars = el.waveform.querySelectorAll("span");
  bars.forEach((bar) => {
    bar.style.height = `${10 + Math.random() * 90}%`;
  });
}

function resetWaveform() {
  const bars = el.waveform.querySelectorAll("span");
  bars.forEach((bar) => (bar.style.height = "8%"));
}

/* --------------------------- Speech recognition -------------------------- */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

if (!SR) {
  speechSupported = false;
  el.micBtn.style.display = "none";
  el.recordHint.textContent = "Voice capture isn't supported in this browser — type your response below.";
} else {
  recognition = new SR();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onresult = (event) => {
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const text = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += (finalTranscript ? " " : "") + text.trim();
      } else {
        interimText += text;
      }
    }
    el.transcript.value = finalTranscript + (interimText ? (finalTranscript ? " " : "") + interimText : "");
    updateWordcount();
  };

  recognition.onerror = () => {
    /* fail silently — user can still type manually */
  };
}

/* ----------------------------- Recording -------------------------------- */

function startRecording() {
  el.reportState.style.display = "none";
  el.errorState.style.display = "none";
  el.loadingState.style.display = "none";
  el.emptyState.style.display = "flex";

  elapsedSeconds = 0;
  el.timer.textContent = formatTime(0);

  if (recognition) {
    finalTranscript = el.transcript.value ? el.transcript.value.trim() + " " : "";
    try {
      recognition.start();
    } catch (e) {
      /* already started */
    }
  }

  isRecording = true;
  el.onAirIndicator.classList.add("ac-onair--live");
  el.onAirText.textContent = "ON AIR";
  el.waveform.classList.add("ac-waveform--live");
  el.micBtn.classList.add("ac-mic-btn--stop");
  el.micIcon.innerHTML = `<rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />`;
  el.recordHint.textContent = "Listening — speak naturally, then press stop.";
  el.transcript.disabled = true;
  el.clearBtn.disabled = true;

  timerInterval = setInterval(() => {
    elapsedSeconds += 1;
    el.timer.textContent = formatTime(elapsedSeconds);
  }, 1000);

  barInterval = setInterval(animateWaveform, 120);
}

function stopRecording() {
  if (recognition) {
    recognition.stop();
  }
  isRecording = false;
  el.onAirIndicator.classList.remove("ac-onair--live");
  el.onAirText.textContent = "STANDBY";
  el.waveform.classList.remove("ac-waveform--live");
  el.micBtn.classList.remove("ac-mic-btn--stop");
  el.micIcon.innerHTML = `
    <path d="M12 15a3.5 3.5 0 0 0 3.5-3.5V6a3.5 3.5 0 0 0-7 0v5.5A3.5 3.5 0 0 0 12 15Z" stroke="currentColor" stroke-width="1.8" />
    <path d="M6.5 11.5a5.5 5.5 0 0 0 11 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
    <path d="M12 17v3.2M9 20.2h6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />`;
  el.recordHint.textContent = speechSupported
    ? "Press the mic and speak for 100–200 words."
    : "Voice capture isn't supported in this browser — type your response below.";
  el.transcript.disabled = false;
  el.clearBtn.disabled = false;

  clearInterval(timerInterval);
  clearInterval(barInterval);
  resetWaveform();
  updateWordcount();
}

el.micBtn.addEventListener("click", () => {
  if (isRecording) stopRecording();
  else startRecording();
});

/* ------------------------------ Transcript ------------------------------ */

function updateWordcount() {
  const count = countWords(el.transcript.value);
  const inRange = count >= WORD_MIN && count <= WORD_MAX;
  el.wordcountText.textContent = `${count} words`;
  el.wordcount.classList.toggle("ac-wordcount--good", inRange);
  el.wordcountCheck.style.display = inRange ? "inline-block" : "none";
  el.evaluateBtn.disabled = count === 0 || isRecording;
}

el.transcript.addEventListener("input", () => {
  finalTranscript = el.transcript.value;
  updateWordcount();
});

el.clearBtn.addEventListener("click", () => {
  resetSession();
});

function resetSession() {
  if (isRecording) stopRecording();
  el.transcript.value = "";
  finalTranscript = "";
  elapsedSeconds = 0;
  el.timer.textContent = formatTime(0);
  updateWordcount();
  el.reportState.style.display = "none";
  el.errorState.style.display = "none";
  el.loadingState.style.display = "none";
  el.emptyState.style.display = "flex";
}

/* ------------------------------- Gauges --------------------------------- */

function renderGauge(container, score, label, sub, large) {
  const size = large ? 132 : 108;
  const stroke = large ? 12 : 10;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = scoreColor(score);

  container.innerHTML = `
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}" />
      <circle class="gauge-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${color}"
        stroke-width="${stroke}" stroke-dasharray="${c}" stroke-dashoffset="${c}" stroke-linecap="round"
        transform="rotate(-90 ${size / 2} ${size / 2})"
        style="transition: stroke-dashoffset 1s cubic-bezier(.4,0,.2,1)" />
      <text x="50%" y="47%" text-anchor="middle" dominant-baseline="middle" class="ac-gauge__number">${score}</text>
      <text x="50%" y="66%" text-anchor="middle" dominant-baseline="middle" class="ac-gauge__of">/100</text>
    </svg>
    <div class="ac-gauge__label">${label}</div>
    ${sub ? `<div class="ac-gauge__sub">${sub}</div>` : ""}
  `;

  // animate the fill in on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const fill = container.querySelector(".gauge-fill");
      fill.style.strokeDashoffset = c * (1 - score / 100);
    });
  });
}

/* ---------------------------- Evaluation logic --------------------------- */

function generateMockEvaluation(transcript, topic) {
  const words = transcript.trim().split(/\s+/).filter(Boolean);
  const sentences = transcript.split(/[.!?]+/).filter((s) => s.trim().length > 2);
  const avgSentenceLen = words.length / Math.max(sentences.length, 1);
  const uniqueWords = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z']/g, "")));
  const lexicalDiversity = uniqueWords.size / Math.max(words.length, 1);

  const grammarScore = Math.max(50, Math.min(97, Math.round(95 - Math.abs(avgSentenceLen - 14) * 2)));
  const vocabScore = Math.max(50, Math.min(97, Math.round(lexicalDiversity * 140)));
  const overallScore = Math.round(grammarScore * 0.45 + vocabScore * 0.45 + Math.min(words.length / 150, 1) * 10);

  return {
    _demo: true,
    grammar: {
      score: grammarScore,
      feedback:
        avgSentenceLen > 20
          ? "Several sentences run long — try breaking complex ideas into two shorter clauses."
          : avgSentenceLen < 8
          ? "Sentences are quite short and clipped. Try joining related ideas with linking words like 'because' or 'while'."
          : "Sentence length is well balanced and mostly grammatically sound.",
    },
    vocabulary: {
      score: vocabScore,
      feedback:
        lexicalDiversity < 0.5
          ? "Some words are repeated often — swapping in synonyms would make the response feel richer."
          : "Good range of vocabulary with varied word choice throughout.",
    },
    overall: {
      score: overallScore,
      feedback: `A ${words.length}-word response on "${topic.prompt}" with a ${
        overallScore >= 75 ? "clear and confident" : "reasonable but improvable"
      } delivery.`,
    },
    suggestions: [
      words.length < WORD_MIN
        ? "Add another example or a short personal anecdote to reach the target length."
        : words.length > WORD_MAX
        ? "Trim a supporting point so the response stays within the target length."
        : "Length is well within the target range — keep this pacing.",
      "Use a few linking words (however, therefore, for instance) to connect ideas more smoothly.",
      "Vary your sentence openers instead of starting consecutive sentences the same way.",
    ],
  };
}

async function evaluateSpeech(topic, transcript) {
  try {
    const res = await fetch(EVAL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: topic.prompt, transcript }),
    });
    if (!res.ok) throw new Error("Evaluation service unavailable");
    const payload = await res.json();
    return normalizeEvaluationResponse(payload, transcript, topic);
  } catch (err) {
    // No backend wired up yet (or it errored) — use the local demo evaluator.
    await new Promise((r) => setTimeout(r, 900));
    return normalizeEvaluationResponse(generateMockEvaluation(transcript, topic), transcript, topic);
  }
}

el.evaluateBtn.addEventListener("click", async () => {
  const topic = TOPICS[topicIndex];
  const transcript = el.transcript.value;

  el.emptyState.style.display = "none";
  el.errorState.style.display = "none";
  el.reportState.style.display = "none";
  el.loadingState.style.display = "flex";
  el.evaluateBtn.disabled = true;
  el.evaluateBtn.textContent = "Analyzing…";

  try {
    const result = await evaluateSpeech(topic, transcript);

    renderGauge(el.overallGauge, result.overall.score, "Overall", overallLabel(result.overall.score), true);
    el.overallFeedback.textContent = result.overall.feedback;

    renderGauge(el.grammarGauge, result.grammar.score, "Grammar");
    el.grammarFeedback.textContent = result.grammar.feedback;

    renderGauge(el.vocabGauge, result.vocabulary.score, "Vocabulary");
    el.vocabFeedback.textContent = result.vocabulary.feedback;

    el.suggestionsList.innerHTML = result.suggestions
      .map(
        (s, i) => `
      <li>
        <span class="ac-suggestion-index">${String(i + 1).padStart(2, "0")}</span>
        <span>${s}</span>
      </li>`
      )
      .join("");

    el.demoNote.style.display = result._demo ? "block" : "none";

    el.loadingState.style.display = "none";
    el.reportState.style.display = "block";
  } catch (err) {
    el.loadingState.style.display = "none";
    el.errorState.style.display = "block";
    el.errorState.textContent = "Couldn't score this response. Please try again.";
  } finally {
    el.evaluateBtn.disabled = countWords(el.transcript.value) === 0;
    el.evaluateBtn.textContent = "Evaluate response";
  }
});

/* ------------------------------- Init ------------------------------------ */

renderTopic();
updateWordcount();