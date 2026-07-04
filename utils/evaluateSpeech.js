import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function stripCodeFences(text) {
  return text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");
}

function buildFallbackEvaluation(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 2);
  const avgSentenceLen = words.length / Math.max(sentences.length, 1);
  const uniqueWords = new Set(words.map((w) => w.toLowerCase().replace(/[^a-z']/g, "")));
  const lexicalDiversity = uniqueWords.size / Math.max(words.length, 1);

  const grammarScore = Math.max(50, Math.min(97, Math.round(95 - Math.abs(avgSentenceLen - 14) * 2)));
  const vocabScore = Math.max(50, Math.min(97, Math.round(lexicalDiversity * 140)));
  const overallScore = Math.round(grammarScore * 0.45 + vocabScore * 0.45 + Math.min(words.length / 150, 1) * 10);

  return {
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
      feedback: `A ${words.length}-word response with a ${overallScore >= 75 ? "clear and confident" : "reasonable but improvable"} delivery.`,
    },
    suggestions: [
      words.length < 100
        ? "Add another example or a short personal anecdote to reach the target length."
        : words.length > 200
        ? "Trim a supporting point so the response stays within the target length."
        : "Length is well within the target range — keep this pacing.",
      "Use a few linking words (however, therefore, for instance) to connect ideas more smoothly.",
      "Vary your sentence openers instead of starting consecutive sentences the same way.",
    ],
  };
}

function normalizeEvaluation(raw, text) {
  if (!raw || typeof raw !== "object") {
    return buildFallbackEvaluation(text);
  }

  const grammarScore = Number(raw.grammar?.score ?? raw.grammar);
  const vocabularyScore = Number(raw.vocabulary?.score ?? raw.vocabulary);
  const overallScore = Number(raw.overall?.score ?? raw.overallScore ?? raw.overall);
  const maxScore = Math.max(grammarScore, vocabularyScore, overallScore);
  const scaleFactor = maxScore <= 5 ? 20 : maxScore <= 10 ? 10 : 1;

  return {
    grammar: {
      score: clampScore(grammarScore * scaleFactor),
      feedback: String(raw.grammar?.feedback ?? "Grammar feedback was not returned."),
    },
    vocabulary: {
      score: clampScore(vocabularyScore * scaleFactor),
      feedback: String(raw.vocabulary?.feedback ?? "Vocabulary feedback was not returned."),
    },
    overall: {
      score: clampScore(overallScore * scaleFactor),
      feedback: String(raw.overall?.feedback ?? raw.overallFeedback ?? "Overall feedback was not returned."),
    },
    suggestions: Array.isArray(raw.suggestions)
      ? raw.suggestions.map((suggestion) => String(suggestion))
      : ["No suggestions were returned."],
  };
}

export async function evaluateSpeech(text) {
  const prompt = `
Evaluate the following speech.

Return JSON only:

{
  "grammar": {
    "score": number, // 0-100 integer
    "feedback": string
  },
  "vocabulary": {
    "score": number, // 0-100 integer
    "feedback": string
  },
  "overall": {
    "score": number, // 0-100 integer
    "feedback": string
  },
  "suggestions": [
    "suggestion1",
    "suggestion2"
  ]
}

Speech:
${text}
`;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    const rawText = response.text ?? "";
    const parsed = JSON.parse(stripCodeFences(rawText));
    return normalizeEvaluation(parsed, text);
  } catch {
    return buildFallbackEvaluation(text);
  }
}