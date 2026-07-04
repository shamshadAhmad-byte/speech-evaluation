import rateLimit from "express-rate-limit"; 

// Gemini calls cost money and take a few seconds each, so cap how often
// a single client can hit the evaluation endpoint.
 export const evaluateLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 evaluation requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many evaluation requests. Please wait a moment and try again." },
});

// module.exports = { evaluateLimiter };
