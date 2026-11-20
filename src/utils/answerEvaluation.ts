import { AnswerEvaluationResult, EvaluationStatus, QuestionType } from '../types/assessment.ts';
import { normalizeArabicText } from './arabicValidation.ts';

export interface EvaluateAnswerPayload {
  questionId: string;
  questionPrompt: string;
  subPrompt?: string;
  questionType?: QuestionType;
  unitTitle?: string;
  lessonTitle?: string;
  options?: string[];
  correctAnswer: string;
  acceptableAnswers?: string[];
  explanation: string;
  learningRule?: string;
  lessonContext?: string;
  studentAnswer: string;
}

export interface RawAiEvaluationJson {
  status?: string;
  correctnessScore?: number;
  matchedConcepts?: unknown;
  missingConcepts?: unknown;
  feedback?: unknown;
  explanation?: unknown;
}

/**
 * Extracts concise key clauses directly from the textbook model answer
 * without inventing external keywords or content.
 */
export function extractCurriculumConcepts(
  modelAnswer: string,
  acceptableAnswers?: string[]
): string[] {
  const cleaned = (modelAnswer || '').trim();
  if (!cleaned) return [];

  // Split by Arabic/standard clause delimiters (؛ ، . ,) or conjunctions when multi-part
  const parts = cleaned
    .split(/[؛،.]+|\s+و(?=(?:تُعد|تعد|يعد|بسبب|لأن|منها|أهم|مما|كـ|حيث))/)
    .map(p => p.trim())
    .filter(p => p.length >= 3);

  const unique: string[] = [];
  for (const part of parts) {
    if (!unique.includes(part)) {
      unique.push(part);
    }
  }

  if (unique.length === 0 && acceptableAnswers && acceptableAnswers.length > 0) {
    return acceptableAnswers.slice(0, 3);
  }

  return unique.slice(0, 5);
}

/**
 * Evaluates empty inputs and objective fixed-choice questions (MCQ / True-False)
 * deterministically without calling an LLM, returning the unified structured evaluation shape.
 * Returns null when the question requires Gemini AI semantic evaluation.
 */
export function evaluateDeterministicQuestion(
  payload: EvaluateAnswerPayload
): AnswerEvaluationResult | null {
  const studentAnswer = (payload.studentAnswer ?? '').trim();
  const modelAnswer = (payload.correctAnswer ?? '').trim();
  const explanation = (payload.explanation ?? '').trim();
  const baseConcepts = extractCurriculumConcepts(modelAnswer, payload.acceptableAnswers);

  // 1. Empty answer guard
  if (!studentAnswer) {
    return {
      status: 'incorrect',
      correctnessScore: 0,
      matchedConcepts: [],
      missingConcepts: baseConcepts.length > 0 ? baseConcepts : [modelAnswer],
      feedback: 'لم تكتب إجابة بعد. لا تقلق! اقرأ السؤال جيداً وعبّر عن فهمك بأسلوبك ثم أعد المحاولة.',
      modelAnswer,
      explanation: explanation || 'راجع فقرة الدرس في كتاب الطالب لتذكر العناصر الأساسية للإجابة.',
      canRetryToImprove: true,
      evaluatedBy: 'empty_guard',
    };
  }

  // 2. Objective fixed-option questions (MCQ / True-False)
  if (payload.options && payload.options.length > 0) {
    const isExactMatch =
      normalizeArabicText(studentAnswer) === normalizeArabicText(modelAnswer);

    if (isExactMatch) {
      return {
        status: 'correct',
        correctnessScore: 100,
        matchedConcepts: [modelAnswer],
        missingConcepts: [],
        feedback: 'ممتاز! إجابة صحيحة وموفقة تماماً 🎉',
        modelAnswer,
        explanation: explanation || modelAnswer,
        canRetryToImprove: false,
        evaluatedBy: 'objective_match',
      };
    }

    return {
      status: 'incorrect',
      correctnessScore: 0,
      matchedConcepts: [],
      missingConcepts: [modelAnswer],
      feedback: `لا تقلق! كل خطأ يساعدك على التعلم. اخترت «${studentAnswer}»، بينما الاختيار الصحيح وفق كتاب الطالب هو «${modelAnswer}».`,
      modelAnswer,
      explanation: explanation || `الإجابة المعتمدة في كتاب الطالب هي: ${modelAnswer}`,
      canRetryToImprove: false,
      evaluatedBy: 'objective_match',
    };
  }

  // Open-ended text answers must be evaluated semantically by Gemini AI
  return null;
}

/**
 * Builds the system instruction & evaluation prompt for Gemini semantic grading.
 */
export function buildSemanticEvaluationPrompt(payload: EvaluateAnswerPayload): string {
  const alternatives =
    payload.acceptableAnswers && payload.acceptableAnswers.length > 0
      ? payload.acceptableAnswers.join(' | ')
      : 'لا يوجد';

  return `أنت مصحح ومعلم خبير لمادة الدراسات الاجتماعية (المنهج المصري المعتمد).
مهمتك تقييم إجابة الطالب تقييماً دلالياً (Semantic Evaluation) بناءً على الفهم والمعنى الحقيقي، وليس بمجرد تطابق الحروف أو وجود كلمات مفتاحية منفردة.

بيانات السؤال من كتاب الطالب:
- الوحدة: ${payload.unitTitle || 'غير محدد'}
- الدرس: ${payload.lessonTitle || 'غير محدد'}
- نص السؤال: ${payload.questionPrompt}
${payload.subPrompt ? `- إرشاد السؤال: ${payload.subPrompt}` : ''}
- الإجابة النموذجية المعتمدة: ${payload.correctAnswer}
- صيغ بديلة مقبولة من الكتاب: ${alternatives}
- التوضيح العلمي المعتمد: ${payload.explanation || 'غير متوفر'}
${payload.learningRule ? `- القاعدة التعليمية: ${payload.learningRule}` : ''}
${payload.lessonContext ? `- سياق الدرس المعتمد:\n${payload.lessonContext}` : ''}

إجابة الطالب:
"""
${payload.studentAnswer}
"""

قواعد التصحيح الإلزامية الصارمة:
1. قيّم المعنى والفهم العلمي/الجغرافي/التاريخي المقصود:
   - اقبل المرادفات، والصياغة العربية المختلفة، واختلاف ترتيب الجمل، والتفسيرات المكافئة علمياً ما دام المعنى صحيحاً.
   - تجاوز الأخطاء الإملائية البسيطة (مثل الهمزات أ/إ/ا، التاء المربوطة ة/ه، الياء/الألف المقصورة، أو أخطاء نحوية طفيفة) إذا كان المقصود واضحاً وصحيحاً.
2. قاعدة منع خداع الكلمات المفتاحية (حاسمة جداً):
   - وجود كلمة أو أكثر من كلمات الإجابة النموذجية لا يجعل الإجابة صحيحة أو صحيحة جزئياً تلقائياً!
   - إذا كتب الطالب كلمة مفتاحية منفردة فقط (كلمة أو كلمتين دون جملة مفيدة تشرح المعنى أو السبب أو العلاقة المطلوبة لأسئلة «بم تفسر» أو «ما النتائج» أو «دلل» أو «قارن»)، أو وضع الكلمة في سياق خاطئ أو منفي أو مناقض للحقيقة (مثال: ذكر اسم القارة أو النهر أو المعدن في سبب خاطئ أو عكس الحقيقة)، فيجب تصنيفها على أنها "incorrect" بدرجة أقل من 30، مع توضيح لطيف أن ذكر كلمة بمفردها لا يوضح الفهم المطلوب.
   - استثناء وحيد: الأسئلة التي يكون مطلوبها الأصلي كلمة واحدة أو اسم مكان محدد (مثل «اكتب ما تشير إليه العبارة» أو «أكمل باسم قارة/جبل/ملك») تُقيّم وفق دقة المصطلح نفسه.
3. لا تخترع إجابات نموذجية أو مفاهيم خارج كتاب الطالب والنصوص المرفقة أعلاه. التزم حصرياً بمفاهيم الإجابة النموذجية والدرس المرفق.
4. التصنيف والدرجة (correctnessScore من 0 إلى 100):
   - "correct" (الدرجة 80 إلى 100): الطالب أظهر فهماً كاملاً وصحيحاً لكافة المفاهيم الأساسية المطلوبة في الإجابة النموذجية (ولو بألفاظه الخاصة ومرادفاته).
   - "partially_correct" (الدرجة 35 إلى 79): الطالب فهم وعبّر بجملة واضحة عن جزء حقيقي وصحيح من الإجابة، لكنه أغفل مفهوماً أو عنصراً مهماً من الإجابة النموذجية (مثلاً ذكر سبباً واحداً من سببين مطلوبين).
   - "incorrect" (الدرجة 0 إلى 34): الإجابة خاطئة علمياً، أو مناقضة للمعنى، أو غير ذات صلة، أو مجرد كلمة مفتاحية معزولة لا تدل على فهم السؤال.
5. صغ التغذية الراجعة (feedback) والشرح (explanation) بلغة السؤال (العربية الفصحى المبسطة المشجعة):
   - عند "correct": ابدأ بعبارة تشجيعية مثل "ممتاز! إجابة رائعة وصحيحة تماماً 🎉" واذكر باختصار ما أحسن الطالب في توضيحه.
   - عند "partially_correct": شجع الطالب بعبارة مثل "أحسنت! اقتربت جداً من الإجابة الكاملة، لنُكمل الجزء الناقص." ووضح ما أصاب فيه وما ينقصه لإكمال الإجابة.
   - عند "incorrect": شجع الطالب بعبارة لطيفة مثل "لا تقلق! كل خطأ يساعدك على التعلم. لنحاول مرة أخرى!" واشرح باختصار لماذا الإجابة غير دقيقة مع توجيه بسيط.`;
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const clean: string[] = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const trimmed = item.trim();
      if (trimmed && !clean.includes(trimmed)) {
        clean.push(trimmed);
      }
    }
  }
  return clean.slice(0, 6);
}

function normalizeStatus(rawStatus: unknown, score: number): EvaluationStatus {
  if (rawStatus === 'correct' || rawStatus === 'partially_correct' || rawStatus === 'incorrect') {
    // Keep status and score bands mutually consistent
    if (rawStatus === 'correct' && score < 60) return 'partially_correct';
    if (rawStatus === 'incorrect' && score >= 80) return 'partially_correct';
    return rawStatus;
  }
  if (score >= 80) return 'correct';
  if (score >= 35) return 'partially_correct';
  return 'incorrect';
}

function defaultFeedbackForStatus(status: EvaluationStatus): string {
  switch (status) {
    case 'correct':
      return 'ممتاز! إجابتك صحيحة وتعبر عن فهم دقيق لمفاهيم الدرس 🎉';
    case 'partially_correct':
      return 'أحسنت! إجابتك صحيحة جزئياً واقتربت من الإجابة الكاملة، يمكنك إضافة المفاهيم الناقصة لتحسين إجابتك.';
    case 'incorrect':
      return 'لا تقلق! كل خطأ يساعدك على التعلم. راجع الإجابة النموذجية والتوضيح العلمي ثم حاول مجدداً!';
  }
}

/**
 * Validates and normalizes the JSON output from Gemini into a consistent AnswerEvaluationResult.
 * Always preserves the official curriculum `correctAnswer` verbatim.
 */
export function normalizeAiEvaluationResponse(
  raw: RawAiEvaluationJson,
  payload: EvaluateAnswerPayload
): AnswerEvaluationResult {
  const rawScore =
    typeof raw.correctnessScore === 'number' && Number.isFinite(raw.correctnessScore)
      ? Math.round(Math.max(0, Math.min(100, raw.correctnessScore)))
      : raw.status === 'correct'
        ? 95
        : raw.status === 'partially_correct'
          ? 60
          : 15;

  const status = normalizeStatus(raw.status, rawScore);
  const matchedConcepts = sanitizeStringArray(raw.matchedConcepts);
  let missingConcepts = sanitizeStringArray(raw.missingConcepts);

  if (status !== 'correct' && missingConcepts.length === 0) {
    missingConcepts = extractCurriculumConcepts(
      payload.correctAnswer,
      payload.acceptableAnswers
    ).slice(0, 3);
  }

  const feedback =
    typeof raw.feedback === 'string' && raw.feedback.trim().length > 0
      ? raw.feedback.trim()
      : defaultFeedbackForStatus(status);

  const aiExplanation =
    typeof raw.explanation === 'string' && raw.explanation.trim().length > 0
      ? raw.explanation.trim()
      : '';

  const officialExplanation = (payload.explanation || '').trim();
  const explanation =
    officialExplanation && aiExplanation && aiExplanation !== officialExplanation
      ? `${officialExplanation}\n${aiExplanation}`
      : officialExplanation || aiExplanation || payload.correctAnswer;

  return {
    status,
    correctnessScore: rawScore,
    matchedConcepts,
    missingConcepts: status === 'correct' ? [] : missingConcepts,
    feedback,
    modelAnswer: payload.correctAnswer,
    explanation,
    canRetryToImprove: status === 'partially_correct' || status === 'incorrect',
    evaluatedBy: 'gemini_ai',
  };
}
