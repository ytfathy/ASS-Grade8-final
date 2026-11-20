import { AnswerEvaluationResult, Question } from '../types/assessment';
import { InfographicGenerator } from './InfographicGenerator';
import {
  EvaluateAnswerPayload,
  evaluateDeterministicQuestion,
} from '../utils/answerEvaluation';

export class AnswerEvaluationError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(message: string, code: string = 'AI_EVALUATION_FAILED', retryable: boolean = true) {
    super(message);
    this.name = 'AnswerEvaluationError';
    this.code = code;
    this.retryable = retryable;
  }
}

function buildLessonContext(lessonId: string): string | undefined {
  const info = InfographicGenerator.getInfographicByLessonId(lessonId);
  if (!info) return undefined;

  const branchTitles = info.mindMap?.branches
    ?.slice(0, 4)
    .map(b => `${b.title}: ${b.summary} (${b.subBranches?.slice(0, 3).map(sb => sb.name).join('، ') || ''})`)
    .join('\n');

  return [
    info.mainConcept?.mainIdea ? `الفكرة الرئيسية: ${info.mainConcept.mainIdea}` : '',
    branchTitles ? `المفاهيم الفرعية:\n${branchTitles}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

export function buildEvaluationPayload(
  question: Question,
  studentAnswer: string
): EvaluateAnswerPayload {
  return {
    questionId: question.id,
    questionPrompt: question.prompt,
    subPrompt: question.subPrompt,
    questionType: question.questionType,
    unitTitle: question.unitTitle,
    lessonTitle: question.lessonTitle,
    options: question.options,
    correctAnswer: question.correctAnswer,
    acceptableAnswers: question.acceptableAnswers,
    explanation: question.explanation,
    learningRule: question.learningRule,
    lessonContext: buildLessonContext(question.lessonId),
    studentAnswer,
  };
}

/**
 * Evaluates a student's answer:
 * - Empty answers & objective MCQs return deterministic structured results immediately.
 * - Open-ended / written answers are evaluated semantically via server-side Gemini AI (/api/evaluate-answer).
 * Throws AnswerEvaluationError if the AI endpoint fails or is unavailable.
 */
export async function evaluateStudentAnswer(
  question: Question,
  studentAnswer: string
): Promise<AnswerEvaluationResult> {
  const payload = buildEvaluationPayload(question, studentAnswer);

  // Instant deterministic path for empty input or fixed MCQ choices
  const deterministic = evaluateDeterministicQuestion(payload);
  if (deterministic) {
    return deterministic;
  }

  let response: Response;
  try {
    response = await fetch('/api/evaluate-answer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AnswerEvaluationError(
      'تعذر الاتصال بخادم التقييم الذكي. يرجى التحقق من الاتصال ثم المحاولة مرة أخرى.',
      'NETWORK_ERROR',
      true
    );
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    throw new AnswerEvaluationError(
      'استجابة غير صالحة من خادم التقييم الذكي. يرجى إعادة المحاولة.',
      'INVALID_RESPONSE',
      true
    );
  }

  if (!response.ok) {
    const errObj = data as { message?: string; code?: string; retryable?: boolean } | null;
    throw new AnswerEvaluationError(
      errObj?.message || 'حدث خطأ أثناء التقييم الذكي للإجابة. يرجى المحاولة مرة أخرى.',
      errObj?.code || `HTTP_${response.status}`,
      errObj?.retryable ?? response.status >= 500
    );
  }

  return data as AnswerEvaluationResult;
}
