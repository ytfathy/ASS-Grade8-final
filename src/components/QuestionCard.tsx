import React, { useRef, useState } from 'react';
import { AnswerEvaluationResult, Question } from '../types/assessment';
import { evaluateStudentAnswer } from '../services/answerEvaluationService';
import { soundEffects } from '../utils/soundEffects';
import { TextbookPageModal } from './TextbookPageModal';
import { LessonPosterModal } from './LessonPosterModal';
import { Maximize2, ZoomIn, BookOpen, Loader2, RefreshCw, Sparkles, AlertTriangle, Edit3 } from 'lucide-react';

interface QuestionCardProps {
  question: Question;
  questionIndex: number;
  totalQuestions: number;
  mode: 'practice' | 'formal' | 'revision';
  onAnswerSubmit: (
    questionId: string,
    isCorrect: boolean,
    studentAnswer: string,
    evaluation?: AnswerEvaluationResult
  ) => void;
  showLearningAids?: boolean;
  onOpenInfographic?: (lessonId: string) => void;
}

export const QuestionCard: React.FC<QuestionCardProps> = ({
  question,
  questionIndex,
  totalQuestions,
  mode,
  onAnswerSubmit,
  showLearningAids = true,
  onOpenInfographic,
}) => {
  const [selectedOption, setSelectedOption] = useState<string>('');
  const [textInput, setTextInput] = useState<string>('');
  const [submitted, setSubmitted] = useState<boolean>(mode === 'revision');
  const [isCorrect, setIsCorrect] = useState<boolean | null>(mode === 'revision' ? true : null);
  const [evaluation, setEvaluation] = useState<AnswerEvaluationResult | null>(
    mode === 'revision'
      ? {
          status: 'correct',
          correctnessScore: 100,
          matchedConcepts: [question.correctAnswer],
          missingConcepts: [],
          feedback: 'وضع المراجعة يعرض الإجابة النموذجية المعتمدة مباشرة.',
          modelAnswer: question.correctAnswer,
          explanation: question.explanation,
          canRetryToImprove: false,
          evaluatedBy: 'objective_match',
        }
      : null
  );
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evaluationError, setEvaluationError] = useState<string | null>(null);
  const [revealedHint, setRevealedHint] = useState<boolean>(false);
  const [showPageModal, setShowPageModal] = useState<boolean>(false);
  const [showPosterModal, setShowPosterModal] = useState<boolean>(false);
  const textInputRef = useRef<HTMLTextAreaElement>(null);

  const hasOptions = Boolean(question.options && question.options.length > 0);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isEvaluating) return;
    if (submitted && mode !== 'formal') return;

    const answerToCheck = hasOptions ? selectedOption : textInput;
    if (hasOptions && !answerToCheck.trim()) return;

    setIsEvaluating(true);
    setEvaluationError(null);

    try {
      const result = await evaluateStudentAnswer(question, answerToCheck);
      const passed = result.status === 'correct';

      setEvaluation(result);
      setIsCorrect(passed);
      setSubmitted(true);

      if (mode !== 'formal') {
        soundEffects.playForEvaluation(result.status);
      } else {
        soundEffects.play('click');
      }

      onAnswerSubmit(question.id, passed, answerToCheck, result);
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'تعذر إتمام التقييم الذكي للإجابة حالياً. يرجى المحاولة مرة أخرى.';
      setEvaluationError(msg);
      soundEffects.play('partially_correct');
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleImproveAnswer = () => {
    soundEffects.play('click');
    setSubmitted(false);
    setEvaluationError(null);
    setTimeout(() => {
      textInputRef.current?.focus();
    }, 50);
  };

  const getDifficultyBadge = () => {
    switch (question.difficulty) {
      case 'سهل':
        return <span className="bg-emerald-100 text-emerald-800 text-xs px-2.5 py-0.5 rounded-full font-bold">سهل</span>;
      case 'متوسط':
        return <span className="bg-amber-100 text-amber-800 text-xs px-2.5 py-0.5 rounded-full font-bold">متوسط</span>;
      case 'متقدم':
        return <span className="bg-purple-100 text-purple-800 text-xs px-2.5 py-0.5 rounded-full font-bold">متقدم</span>;
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 mb-6 transition-all hover:shadow-md">
      {/* Textbook Page Lightbox Modal */}
      <TextbookPageModal
        initialPage={question.sourcePage || (question.pageCrop ? question.pageCrop.pageNumber : 1)}
        isOpen={showPageModal}
        onClose={() => setShowPageModal(false)}
      />

      {/* Lesson in a Picture Lightbox Modal (الدرس في صورة) */}
      <LessonPosterModal
        initialLessonId={question.lessonId}
        isOpen={showPosterModal}
        onClose={() => setShowPosterModal(false)}
      />

      {/* Top Meta info */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-100 pb-3 mb-4 text-xs sm:text-sm font-bold text-slate-600">
        <div className="flex flex-wrap items-center gap-2">
          <span className="bg-blue-100 text-blue-900 px-3 py-1 rounded-xl font-black text-xs sm:text-sm">
            سؤال {questionIndex + 1} من {totalQuestions}
          </span>
          <span className="text-slate-300">|</span>
          <span className="text-slate-700 bg-slate-100 px-3 py-1 rounded-xl font-bold">{question.section}</span>
          <span className="text-slate-300">|</span>
          <span className="text-blue-800 bg-blue-50 px-3 py-1 rounded-xl font-black">{question.skillCategory}</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {getDifficultyBadge()}
          {onOpenInfographic && (
            <button
              type="button"
              onClick={() => onOpenInfographic(question.lessonId)}
              className="flex items-center gap-1.5 text-amber-950 bg-amber-50 hover:bg-amber-100 border border-amber-300 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer shadow-2xs"
              title="فتح لوحة الشرح البصري والإنفوجرافيك لهذا الدرس في ذاكر لي"
            >
              <span>💡</span>
              <span>ذاكر لي</span>
            </button>
          )}
          {/* USER REQUESTED: الدرس في صورة */}
          <button
            type="button"
            onClick={() => setShowPosterModal(true)}
            className="flex items-center gap-1.5 text-amber-950 bg-gradient-to-r from-amber-200 to-amber-300 hover:from-amber-300 hover:to-amber-400 border border-amber-400/80 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-black transition-all cursor-pointer shadow-2xs active:scale-95"
            title="عرض ملصق الدرس في صورة لهذا السؤال بدقة فائقة"
          >
            <span>🖼️</span>
            <span>الدرس في صورة</span>
          </button>
          <button
            type="button"
            onClick={() => setShowPageModal(true)}
            className="flex items-center gap-1.5 text-blue-800 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer shadow-2xs"
            title="فتح صفحة الكتاب المدرسي كاملة بدقة فائقة"
          >
            <BookOpen className="w-4 h-4 text-blue-600" />
            <span>ص {question.sourcePage} بالكتاب الأصلي</span>
          </button>
        </div>
      </div>

      {/* Lesson title */}
      <div className="text-xs sm:text-sm text-slate-500 mb-2 font-bold flex items-center gap-1.5">
        <span>📖</span>
        <span>{question.unitTitle} • {question.lessonTitle}</span>
      </div>

      {/* Main Prompt */}
      <h3 className="text-lg sm:text-xl lg:text-2xl font-black text-slate-950 mb-3.5 leading-relaxed tracking-tight">
        {question.prompt}
      </h3>

      {question.subPrompt && (
        <div className="p-3.5 bg-amber-50/80 border border-amber-200 rounded-2xl text-amber-950 text-sm sm:text-base mb-4 leading-relaxed font-semibold">
          💡 <span className="font-black">إرشاد السؤال:</span> {question.subPrompt}
        </div>
      )}

      {/* Visual illustration / Map cropped from official textbook page */}
      {question.pageCrop && (
        <div className="my-4 rounded-2xl overflow-hidden border-2 border-amber-300 shadow-md bg-white">
          <div className="bg-gradient-to-r from-amber-100 to-amber-50 px-3 py-2 border-b border-amber-200 text-xs font-bold text-amber-900 flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>🗺️</span>
              <span>خريطة / شكل توضيحي من الكتاب الأصلي (صفحة {question.pageCrop.pageNumber})</span>
            </span>
            <button
              type="button"
              onClick={() => setShowPageModal(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-600 hover:bg-amber-700 active:scale-95 text-white rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span>تكبير الصفحة بالكامل بدقة عالية</span>
            </button>
          </div>
          <div 
            onClick={() => setShowPageModal(true)}
            title="انقر لتكبير وتصفح الخريطة بالكامل بدقة فائقة"
            className="w-full relative overflow-hidden bg-slate-100 flex items-start justify-center cursor-pointer group"
            style={{
              height: '300px'
            }}
          >
            <img
              src={`/assets/pages/page_${question.pageCrop.pageNumber}.jpg`}
              alt={`خريطة توضيحية صفحة ${question.pageCrop.pageNumber}`}
              className="w-full object-cover select-none pointer-events-none transition-transform duration-300 group-hover:scale-[1.02]"
              style={{
                transform: `translateY(-${question.pageCrop.top}%)`,
              }}
            />
            <div className="absolute inset-0 bg-blue-950/15 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
              <span className="bg-slate-900/85 backdrop-blur text-white px-3.5 py-2 rounded-full text-xs font-bold flex items-center gap-1.5 shadow-xl">
                <ZoomIn className="w-4 h-4 text-amber-300" />
                <span>انقر لفتح الصفحة كاملة والتكبير بحرية</span>
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Direct image url if provided */}
      {question.imageUrl && !question.pageCrop && (
        <div 
          className="my-4 rounded-2xl overflow-hidden border border-slate-200 shadow-sm cursor-pointer" 
          onClick={() => setShowPageModal(true)}
          title="انقر لتكبير الصورة"
        >
          <img
            src={question.imageUrl}
            alt="صورة السؤال"
            className="w-full max-h-72 object-contain bg-slate-50"
          />
        </div>
      )}

      {/* Interactive Answer Area */}
      {question.options && question.options.length > 0 ? (
        // Multiple Choice
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5 my-5">
          {question.options.map((opt, idx) => {
            const isSelected = selectedOption === opt;
            const isThisCorrect = opt === question.correctAnswer;
            let btnClass = 'border-slate-200 hover:border-blue-400 hover:bg-blue-50/50 text-slate-900 bg-white shadow-2xs';

            if (submitted && mode !== 'formal') {
              if (isThisCorrect) {
                btnClass = 'border-emerald-500 bg-emerald-50/90 text-emerald-950 font-black ring-2 ring-emerald-500 shadow-sm';
              } else if (isSelected && !isCorrect) {
                btnClass = 'border-rose-400 bg-rose-50 text-rose-950 line-through opacity-80';
              }
            } else if (isSelected) {
              btnClass = 'border-blue-600 bg-blue-50 text-blue-950 font-black ring-2 ring-blue-500 shadow-sm';
            }

            return (
              <button
                key={idx}
                type="button"
                disabled={(submitted && mode !== 'formal') || isEvaluating}
                onClick={() => {
                  soundEffects.play('click');
                  setSelectedOption(opt);
                }}
                className={`flex items-center justify-between p-4 rounded-2xl border-2 text-right transition-all text-base sm:text-lg font-bold cursor-pointer ${btnClass}`}
              >
                <div className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-xl bg-slate-100 text-slate-800 flex items-center justify-center font-black text-sm border border-slate-300">
                    {String.fromCharCode(65 + idx)}
                  </span>
                  <span className="leading-snug">{opt}</span>
                </div>
                {submitted && mode !== 'formal' && isThisCorrect && (
                  <span className="text-emerald-700 font-black text-sm bg-emerald-100/80 px-2 py-0.5 rounded-lg">✓ صحيحة</span>
                )}
              </button>
            );
          })}
        </div>
      ) : (
        // Text / Definition / Reason / Sentence Completion
        <form onSubmit={handleSubmit} className="my-5">
          <label className="block text-sm sm:text-base font-black text-slate-800 mb-2">
            اكتب إجابتك هنا بدقة ووضوح:
          </label>
          <div className="relative">
            <textarea
              ref={textInputRef}
              rows={3}
              value={textInput}
              disabled={(submitted && mode !== 'formal') || isEvaluating}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder="اكتب الإجابة باللغة العربية بأسلوبك وفهمك للدرس..."
              className="w-full p-4 rounded-2xl border-2 border-slate-300 focus:border-blue-600 focus:ring-4 focus:ring-blue-100 text-base sm:text-lg font-bold text-slate-900 transition-all resize-y leading-relaxed bg-slate-50/50 focus:bg-white disabled:opacity-75"
            />
          </div>
        </form>
      )}

      {/* AI Evaluation Error Banner */}
      {evaluationError && (
        <div
          role="alert"
          className="mt-4 p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 text-rose-950 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5 text-sm font-bold leading-relaxed">
            <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <span>{evaluationError}</span>
          </div>
          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={isEvaluating}
            className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white font-black text-xs rounded-xl flex items-center gap-1.5 shrink-0 cursor-pointer transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isEvaluating ? 'animate-spin' : ''}`} />
            <span>إعادة المحاولة</span>
          </button>
        </div>
      )}

      {/* Action button */}
      {(!submitted || mode === 'formal') && (
        <div className="flex items-center justify-between mt-5 pt-4 border-t border-slate-100 gap-3 flex-wrap">
          <button
            type="button"
            onClick={() => {
              soundEffects.play('click');
              setRevealedHint(!revealedHint);
            }}
            className="text-sm font-black text-blue-700 hover:text-blue-900 flex items-center gap-1.5 py-1.5 px-3 rounded-xl hover:bg-blue-50 transition-colors cursor-pointer"
          >
            <span>💡</span>
            <span>{revealedHint ? 'إخفاء التلميح' : 'عرض فكرة الحل'}</span>
          </button>

          <button
            type="button"
            onClick={() => handleSubmit()}
            disabled={isEvaluating || (hasOptions && !selectedOption)}
            className="bg-blue-700 hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-base px-7 py-3 rounded-2xl shadow-lg shadow-blue-700/25 transition-all cursor-pointer active:scale-98 flex items-center gap-2"
          >
            {isEvaluating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري التقييم الذكي للإجابة...</span>
              </>
            ) : (
              <>
                {!hasOptions && <Sparkles className="w-4 h-4 text-amber-300" />}
                <span>{submitted && mode === 'formal' ? 'تحديث الإجابة' : 'تأكيد الإجابة'}</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Formal mode confirmation */}
      {submitted && mode === 'formal' && !evaluationError && (
        <div className="mt-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
          <span>✓</span>
          <span>تم حفظ وتقييم هذه الإجابة ضمن الاختبار الرسمي — ستظهر التفاصيل الكاملة بعد تسليم الاختبار.</span>
        </div>
      )}

      {/* Hint display */}
      {revealedHint && (
        <div className="mt-3 p-3 bg-blue-50 rounded-xl border border-blue-200 text-xs text-blue-900">
          <span className="font-bold">تلميح لمساعدتك:</span> ابحث في موضوع ({question.lessonTitle}) وركز في المصطلحات والمواقع الجغرافية أو الأحداث التاريخية المرتبطة.
        </div>
      )}

      {/* 3-Tier Semantic Evaluation Feedback Panel (practice & revision mode) */}
      {submitted && mode !== 'formal' && evaluation && (
        <div
          data-evaluation-status={evaluation.status}
          className={`mt-6 p-5 rounded-2xl border-2 transition-all ${
            evaluation.status === 'correct'
              ? 'bg-emerald-50 border-emerald-400 text-emerald-950 shadow-sm'
              : evaluation.status === 'partially_correct'
                ? 'bg-amber-50 border-amber-400 text-amber-950 shadow-sm'
                : 'bg-rose-50 border-rose-400 text-rose-950 shadow-sm'
          }`}
        >
          {/* Header Row: Status Icon + Encouraging Title + Score Badge */}
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 font-black text-base sm:text-lg">
              <span>
                {evaluation.status === 'correct'
                  ? '🎉 ممتاز! إجابة صحيحة تماماً'
                  : evaluation.status === 'partially_correct'
                    ? '🌟 أحسنت! إجابة صحيحة جزئياً — اقتربت من الإجابة الكاملة'
                    : '💡 لا تقلق! إجابة غير مكتملة أو تحتاج مراجعة'}
              </span>
            </div>

            <div className="flex items-center gap-2">
              {evaluation.evaluatedBy === 'gemini_ai' && (
                <span className="text-[11px] font-black px-2.5 py-1 rounded-full bg-white/90 text-indigo-800 border border-indigo-200 flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-indigo-600" />
                  <span>تقييم دلالي ذكي</span>
                </span>
              )}
              <span
                className={`text-xs sm:text-sm font-black px-3 py-1 rounded-full border ${
                  evaluation.status === 'correct'
                    ? 'bg-emerald-600 text-white border-emerald-700'
                    : evaluation.status === 'partially_correct'
                      ? 'bg-amber-500 text-slate-950 border-amber-600'
                      : 'bg-rose-600 text-white border-rose-700'
                }`}
              >
                الدقة: {evaluation.correctnessScore}%
              </span>
            </div>
          </div>

          <div className="space-y-3 text-sm sm:text-base leading-relaxed">
            {/* Encouraging Semantic Feedback */}
            <div className="p-3.5 bg-white/95 rounded-xl border border-slate-200/90 font-bold text-slate-900">
              {evaluation.feedback}
            </div>

            {/* Matched Concepts (for correct & partially_correct) */}
            {evaluation.matchedConcepts.length > 0 && (
              <div className="p-3.5 bg-emerald-100/60 rounded-xl border border-emerald-300">
                <span className="font-black text-emerald-900 text-xs sm:text-sm block mb-2">
                  ✅ المفاهيم الصحيحة التي غطيتها:
                </span>
                <div className="flex flex-wrap gap-2">
                  {evaluation.matchedConcepts.map((concept, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-white text-emerald-900 border border-emerald-300 rounded-xl text-xs sm:text-sm font-bold shadow-2xs"
                    >
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Missing Concepts (for partially_correct & incorrect) */}
            {evaluation.missingConcepts.length > 0 && evaluation.status !== 'correct' && (
              <div className="p-3.5 bg-amber-100/70 rounded-xl border border-amber-300">
                <span className="font-black text-amber-950 text-xs sm:text-sm block mb-2">
                  {evaluation.status === 'partially_correct'
                    ? '🧩 المفاهيم الناقصة لإكمال إجابتك:'
                    : '📌 المفاهيم الأساسية المطلوبة في السؤال:'}
                </span>
                <div className="flex flex-wrap gap-2">
                  {evaluation.missingConcepts.map((concept, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 bg-white text-amber-950 border border-amber-300 rounded-xl text-xs sm:text-sm font-bold shadow-2xs"
                    >
                      {concept}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Complete Model Answer */}
            <div className="p-3 bg-white/90 rounded-xl border border-slate-200">
              <span className="font-black text-slate-800">الإجابة النموذجية الكاملة المعتمدة في كتاب الطالب: </span>
              <span className="font-extrabold text-blue-900 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200 block sm:inline-block mt-1 sm:mt-0">
                {evaluation.modelAnswer}
              </span>
            </div>

            {/* Educational Explanation */}
            {evaluation.explanation && (
              <div className="text-slate-800 leading-relaxed bg-white/80 p-3.5 rounded-xl border border-slate-200 mt-2 font-medium whitespace-pre-line">
                <span className="font-black text-blue-900 block mb-1">الشرح والتوضيح العلمي المعتمد: </span>
                {evaluation.explanation}
              </div>
            )}

            {question.learningRule && showLearningAids && (
              <div className="text-amber-950 bg-amber-100/70 p-3.5 rounded-xl border border-amber-300 font-semibold leading-relaxed">
                <span className="font-black text-amber-900 block mb-1">قاعدة تعليمية هامة من الكتاب: </span>
                {question.learningRule}
              </div>
            )}

            {/* Opportunity to improve / try again for text answers */}
            {!hasOptions && evaluation.status !== 'correct' && (
              <div className="pt-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={handleImproveAnswer}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-black text-xs sm:text-sm transition-all shadow-sm cursor-pointer active:scale-95 ${
                    evaluation.status === 'partially_correct'
                      ? 'bg-amber-600 hover:bg-amber-700 text-white'
                      : 'bg-slate-800 hover:bg-slate-900 text-white'
                  }`}
                >
                  <Edit3 className="w-4 h-4" />
                  <span>
                    {evaluation.status === 'partially_correct'
                      ? 'حسّن إجابتك وأكمل الجزء الناقص'
                      : 'حاول مرة أخرى بإجابة جديدة'}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
