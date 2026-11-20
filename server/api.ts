import express, { Request, Response } from 'express';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  EvaluateAnswerPayload,
  RawAiEvaluationJson,
  buildSemanticEvaluationPrompt,
  evaluateDeterministicQuestion,
  normalizeAiEvaluationResponse,
} from '../src/utils/answerEvaluation.ts';

const PRIMARY_EVAL_MODEL = 'gemini-3.1-flash-lite';
const FALLBACK_EVAL_MODEL = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function isRetryableGeminiError(err: unknown): boolean {
  const errMsg = err instanceof Error ? err.message : String(err);
  const errName = err instanceof Error ? err.name : '';
  return (
    errName === 'TimeoutError' ||
    errName === 'AbortError' ||
    errMsg.includes('aborted') ||
    errMsg.includes('timed out') ||
    errMsg.includes('429') ||
    errMsg.includes('503') ||
    errMsg.includes('500') ||
    errMsg.includes('UNAVAILABLE') ||
    errMsg.includes('ECONNRESET') ||
    errMsg.includes('fetch failed')
  );
}

async function callWithModelFailover<T>(
  runner: (model: string) => Promise<T>,
  models: string[] = [PRIMARY_EVAL_MODEL, FALLBACK_EVAL_MODEL]
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < models.length; i++) {
    try {
      return await runner(models[i]);
    } catch (err: unknown) {
      lastErr = err;
      if (!isRetryableGeminiError(err) || i === models.length - 1) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
  throw lastErr;
}

function extractJsonObject(rawText: string): string {
  const trimmed = rawText.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const unfenced = fenceMatch ? fenceMatch[1].trim() : trimmed;
  const firstBrace = unfenced.indexOf('{');
  const lastBrace = unfenced.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return unfenced.slice(firstBrace, lastBrace + 1);
  }
  return unfenced;
}

function mapGeminiHttpError(err: unknown): {
  status: number;
  code: string;
  message: string;
  retryable: boolean;
} {
  const rawMessage = err instanceof Error ? err.message : String(err);
  const errName = err instanceof Error ? err.name : '';

  if (
    errName === 'TimeoutError' ||
    errName === 'AbortError' ||
    rawMessage.includes('aborted') ||
    rawMessage.includes('timed out')
  ) {
    return {
      status: 504,
      code: 'AI_TIMEOUT',
      message: 'استغرق التقييم الذكي وقتاً أطول من المعتاد. يرجى الضغط على إعادة المحاولة.',
      retryable: true,
    };
  }

  if (
    rawMessage.includes('API_KEY_INVALID') ||
    rawMessage.includes('PERMISSION_DENIED') ||
    rawMessage.includes('403') ||
    rawMessage.includes('401')
  ) {
    return {
      status: 403,
      code: 'AI_AUTH_ERROR',
      message:
        'تعذر التحقق من صلاحية مفتاح الذكاء الاصطناعي في إعدادات الخادم (Settings > Secrets).',
      retryable: false,
    };
  }

  if (rawMessage.includes('RESOURCE_EXHAUSTED') || rawMessage.includes('429')) {
    return {
      status: 429,
      code: 'AI_RATE_LIMIT',
      message: 'خدمة التقييم الذكي مشغولة حالياً بكثرة الطلبات. يرجى الانتظار لحظة ثم إعادة المحاولة.',
      retryable: true,
    };
  }

  return {
    status: 502,
    code: 'AI_EVALUATION_FAILED',
    message: 'تعذر إتمام التقييم الذكي عبر Gemini حالياً. يرجى الضغط على إعادة المحاولة.',
    retryable: true,
  };
}

// API routes shared by the local server (server.ts) and the Vercel function (api/index.ts).
export const app = express();
app.use(express.json({ limit: '1mb' }));

// Health & AI availability check
app.get('/api/health', (_req: Request, res: Response) => {
  const aiConfigured = Boolean(getGeminiClient());
  res.json({ ok: true, aiConfigured, model: PRIMARY_EVAL_MODEL });
});

// Server-side semantic evaluation endpoint
app.post('/api/evaluate-answer', async (req: Request, res: Response) => {
  const payload = req.body as Partial<EvaluateAnswerPayload> | undefined;

  if (
    !payload ||
    typeof payload.questionPrompt !== 'string' ||
    typeof payload.correctAnswer !== 'string'
  ) {
    res.status(400).json({
      error: true,
      code: 'BAD_REQUEST',
      message: 'بيانات السؤال غير مكتملة لإجراء التقييم.',
      retryable: false,
    });
    return;
  }

  const normalizedPayload: EvaluateAnswerPayload = {
    questionId: payload.questionId || 'unknown',
    questionPrompt: payload.questionPrompt,
    subPrompt: payload.subPrompt,
    questionType: payload.questionType,
    unitTitle: payload.unitTitle,
    lessonTitle: payload.lessonTitle,
    options: Array.isArray(payload.options) ? payload.options : undefined,
    correctAnswer: payload.correctAnswer,
    acceptableAnswers: Array.isArray(payload.acceptableAnswers)
      ? payload.acceptableAnswers
      : undefined,
    explanation: typeof payload.explanation === 'string' ? payload.explanation : '',
    learningRule: typeof payload.learningRule === 'string' ? payload.learningRule : undefined,
    lessonContext: typeof payload.lessonContext === 'string' ? payload.lessonContext : undefined,
    studentAnswer: typeof payload.studentAnswer === 'string' ? payload.studentAnswer : '',
  };

  // Deterministic empty or objective MCQ/True-False checks
  const deterministic = evaluateDeterministicQuestion(normalizedPayload);
  if (deterministic) {
    res.json(deterministic);
    return;
  }

  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({
      error: true,
      code: 'AI_KEY_MISSING',
      message:
        'خدمة التقييم الدلالي الذكي تتطلب ضبط GEMINI_API_KEY في لوحة الإعدادات (Settings > Secrets).',
      retryable: false,
    });
    return;
  }

  const startedAt = Date.now();
  try {
    const prompt = buildSemanticEvaluationPrompt(normalizedPayload);

    const response = await callWithModelFailover((model) =>
      ai.models.generateContent({
        model,
        contents: prompt,
        config: {
          abortSignal: AbortSignal.timeout(12000),
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              status: {
                type: Type.STRING,
                description:
                  'Must be one of: "correct", "partially_correct", or "incorrect".',
              },
              correctnessScore: {
                type: Type.INTEGER,
                description:
                  'Semantic understanding score from 0 to 100 (80-100 correct, 35-79 partially_correct, 0-34 incorrect).',
              },
              matchedConcepts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                  'Important concepts from the model answer accurately demonstrated by the student in Arabic.',
              },
              missingConcepts: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description:
                  'Important concepts from the model answer missing or misunderstood by the student in Arabic. Empty array when status is correct.',
              },
              feedback: {
                type: Type.STRING,
                description:
                  'Encouraging, personalized Arabic feedback explaining what was right, what is missing, or why incorrect.',
              },
              explanation: {
                type: Type.STRING,
                description:
                  'Simple educational Arabic explanation anchored in the textbook lesson without inventing facts.',
              },
            },
            required: [
              'status',
              'correctnessScore',
              'matchedConcepts',
              'missingConcepts',
              'feedback',
              'explanation',
            ],
          },
        },
      })
    );

    const rawText = (response.text ?? '').trim();
    if (!rawText) {
      throw new Error('Empty response from Gemini');
    }

    const parsed = JSON.parse(extractJsonObject(rawText)) as RawAiEvaluationJson;
    const result = normalizeAiEvaluationResponse(parsed, normalizedPayload);
    res.setHeader('X-Eval-Ms', String(Date.now() - startedAt));
    res.json(result);
  } catch (err: unknown) {
    const elapsedMs = Date.now() - startedAt;
    console.error(`[evaluate-answer] Gemini error after ${elapsedMs}ms:`, err);
    const mapped = mapGeminiHttpError(err);
    res.status(mapped.status).json({
      error: true,
      code: mapped.code,
      message: mapped.message,
      retryable: mapped.retryable,
    });
  }
});

// Server-side Admin Infographic AI generation endpoint
app.post('/api/admin/generate-infographic', async (req: Request, res: Response) => {
  const ai = getGeminiClient();
  if (!ai) {
    res.status(503).json({
      error: true,
      code: 'AI_KEY_MISSING',
      message: 'GEMINI_API_KEY غير مفعّل في إعدادات الخادم (Settings > Secrets).',
    });
    return;
  }

  const { lessonId, lessonTitle, unitTitle, sampleQuestions } = req.body as {
    lessonId?: string;
    lessonTitle?: string;
    unitTitle?: string;
    sampleQuestions?: Array<{ prompt: string; correctAnswer: string; explanation: string }>;
  };

  if (!lessonId) {
    res.status(400).json({ error: true, message: 'lessonId مطلوب.' });
    return;
  }

  try {
    const questionsBlock = (sampleQuestions || [])
      .slice(0, 10)
      .map((q, i) => `${i + 1}- ${q.prompt} (الإجابة: ${q.correctAnswer} - التفسير: ${q.explanation})`)
      .join('\n');

    const promptText = `أنت خبير مناهج دراسات اجتماعية للمرحلة الإعدادية ومصمم إنفوجرافيك تعليمي بأسلوب NotebookLM.
المطلوب استخراج وتوليد لوحة إنفوجرافيك تعليمية بصيغة JSON حصراً للدرس:
عنوان الدرس: ${lessonTitle || lessonId}
الوحدة: ${unitTitle || ''}
نماذج من أسئلة وتفسيرات الكتاب:
${questionsBlock}

المخرجات المطلوبة: كائن JSON صالح فقط يحتوي على mainConcept (centralTitle, tagline, mainIdea, learningObjectives).
يجب ألا تبتكر أي معلومة خارج كتاب الطالب.`;

    const response = await callWithModelFailover((model) =>
      ai.models.generateContent({
        model,
        contents: promptText,
        config: {
          abortSignal: AbortSignal.timeout(12000),
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
        },
      })
    );

    const rawText = (response.text ?? '').trim();
    res.json(JSON.parse(extractJsonObject(rawText)));
  } catch (err: unknown) {
    console.error('[admin/generate-infographic] error:', err);
    const mapped = mapGeminiHttpError(err);
    res.status(mapped.status).json({ error: true, message: mapped.message });
  }
});

