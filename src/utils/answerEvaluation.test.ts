import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  EvaluateAnswerPayload,
  buildSemanticEvaluationPrompt,
  evaluateDeterministicQuestion,
  extractCurriculumConcepts,
  normalizeAiEvaluationResponse,
} from './answerEvaluation';
import { soundEffects } from './soundEffects';

const SAMPLE_QUESTION: EvaluateAnswerPayload = {
  questionId: 'u1_p2_q2a_why',
  questionPrompt: 'بم تفسر؟ الأهمية الحضارية لموقع قارة آسيا.',
  unitTitle: 'الوحدة الأولى: الملامح الطبيعية لقارتي آسيا وأوروبا',
  lessonTitle: 'الدرس الأول: موقع ومظاهر سطح قارتي آسيا وأوروبا',
  correctAnswer:
    'لأنها مهد الديانات السماوية الثلاث وموطن الحضارات القديمة كحضارات بلاد الرافدين والهند والصين القديمة.',
  acceptableAnswers: ['مهد الديانات والحضارات القديمة'],
  explanation: 'انطلقت منها الرسالات السماوية وقامت على أرضها أقدم الحضارات الإنسانية.',
  studentAnswer: '',
};

test('Test 1: Exact model-answer wording normalizes as correct and preserves official model answer', () => {
  const payload: EvaluateAnswerPayload = {
    ...SAMPLE_QUESTION,
    studentAnswer: SAMPLE_QUESTION.correctAnswer,
  };
  const prompt = buildSemanticEvaluationPrompt(payload);
  assert.ok(prompt.includes(SAMPLE_QUESTION.correctAnswer));

  const normalized = normalizeAiEvaluationResponse(
    {
      status: 'correct',
      correctnessScore: 100,
      matchedConcepts: ['مهد الديانات السماوية الثلاث', 'موطن الحضارات القديمة كالرافدين والهند والصين'],
      missingConcepts: [],
      feedback: 'ممتاز! إجابة رائعة وصحيحة تماماً 🎉',
      explanation: 'انطلقت منها الرسالات السماوية وقامت على أرضها أقدم الحضارات الإنسانية.',
    },
    payload
  );

  assert.equal(normalized.status, 'correct');
  assert.equal(normalized.correctnessScore, 100);
  assert.equal(normalized.modelAnswer, SAMPLE_QUESTION.correctAnswer);
  assert.equal(normalized.missingConcepts.length, 0);
  assert.equal(normalized.evaluatedBy, 'gemini_ai');
});

test('Test 2 & 3: Completely different wording / synonyms normalize as correct with matched concepts', () => {
  const payload: EvaluateAnswerPayload = {
    ...SAMPLE_QUESTION,
    studentAnswer:
      'لأنها كانت المنبع الذي ظهرت فيه الأديان السماوية، كما نشأت فوق أراضيها أرقى المدنيات البشرية القديمة مثل حضارة العراق والصين والهند.',
  };

  // Must NOT be resolved by deterministic MCQ guard — requires Gemini AI semantic grading
  assert.equal(evaluateDeterministicQuestion(payload), null);

  const prompt = buildSemanticEvaluationPrompt(payload);
  assert.ok(prompt.includes('اقبل المرادفات'));
  assert.ok(prompt.includes(payload.studentAnswer));

  const result = normalizeAiEvaluationResponse(
    {
      status: 'correct',
      correctnessScore: 95,
      matchedConcepts: ['ظهور الديانات السماوية', 'قيام الحضارات البشرية القديمة بالعراق والهند والصين'],
      missingConcepts: [],
      feedback: 'ممتاز! عبّرت عن المعنى بأسلوبك ومرادفاتك بدقة كاملة 🎉',
    },
    payload
  );

  assert.equal(result.status, 'correct');
  assert.ok(result.correctnessScore >= 80);
  assert.equal(result.matchedConcepts.length, 2);
});

test('Test 4: Partially correct answer missing one important concept enables improve flow', () => {
  const payload: EvaluateAnswerPayload = {
    ...SAMPLE_QUESTION,
    studentAnswer: 'لأنها مهد الديانات السماوية الثلاث.',
  };

  const result = normalizeAiEvaluationResponse(
    {
      status: 'partially_correct',
      correctnessScore: 55,
      matchedConcepts: ['مهد الديانات السماوية الثلاث'],
      missingConcepts: ['موطن الحضارات القديمة كبلاد الرافدين والهند والصين'],
      feedback: 'أحسنت! اقتربت جداً من الإجابة الكاملة، لنُكمل الجزء الناقص حول الحضارات القديمة.',
    },
    payload
  );

  assert.equal(result.status, 'partially_correct');
  assert.equal(result.correctnessScore, 55);
  assert.equal(result.canRetryToImprove, true);
  assert.ok(result.matchedConcepts.length >= 1);
  assert.ok(result.missingConcepts.length >= 1);
});

test('Test 5: Incorrect answer containing expected keywords must stay incorrect and guard prompt enforces rule', () => {
  const payload: EvaluateAnswerPayload = {
    ...SAMPLE_QUESTION,
    studentAnswer: 'الديانات والصين لم تقم في قارة آسيا إطلاقاً.',
  };

  const prompt = buildSemanticEvaluationPrompt(payload);
  assert.ok(prompt.includes('وجود كلمة أو أكثر من كلمات الإجابة النموذجية لا يجعل الإجابة صحيحة أو صحيحة جزئياً تلقائياً'));

  // Consistency check: even if raw score was accidentally high while status is incorrect, normalize caps status to partially_correct/incorrect, and low score stays incorrect
  const result = normalizeAiEvaluationResponse(
    {
      status: 'incorrect',
      correctnessScore: 10,
      matchedConcepts: [],
      missingConcepts: ['مهد الديانات السماوية الثلاث', 'موطن الحضارات القديمة'],
      feedback: 'لا تقلق! كل خطأ يساعدك على التعلم. وجود كلمات من السؤال بمفردها في سياق غير صحيح لا يكفي.',
    },
    payload
  );

  assert.equal(result.status, 'incorrect');
  assert.ok(result.correctnessScore < 35);
  assert.equal(result.modelAnswer, SAMPLE_QUESTION.correctAnswer);
});

test('Test 6: Empty answer is caught deterministically as incorrect with curriculum missing concepts', () => {
  const result = evaluateDeterministicQuestion({
    ...SAMPLE_QUESTION,
    studentAnswer: '   ',
  });

  assert.ok(result !== null);
  assert.equal(result?.status, 'incorrect');
  assert.equal(result?.correctnessScore, 0);
  assert.equal(result?.evaluatedBy, 'empty_guard');
  assert.equal(result?.modelAnswer, SAMPLE_QUESTION.correctAnswer);
  assert.ok((result?.missingConcepts.length ?? 0) >= 1);
});

test('Objective MCQ question evaluates deterministically with structured 3-tier shape', () => {
  const mcq: EvaluateAnswerPayload = {
    questionId: 'mcq_1',
    questionPrompt: 'أكبر قارات العالم مساحة هي قارة:',
    options: ['أفريقيا', 'آسيا', 'أوروبا', 'أمريكا الشمالية'],
    correctAnswer: 'آسيا',
    explanation: 'قارة آسيا هي أكبر قارات العالم وتبلغ مساحتها 44.2 مليون كم2.',
    studentAnswer: 'آسيا',
  };

  const correctRes = evaluateDeterministicQuestion(mcq);
  assert.equal(correctRes?.status, 'correct');
  assert.equal(correctRes?.correctnessScore, 100);
  assert.equal(correctRes?.evaluatedBy, 'objective_match');

  const wrongRes = evaluateDeterministicQuestion({ ...mcq, studentAnswer: 'أوروبا' });
  assert.equal(wrongRes?.status, 'incorrect');
  assert.equal(wrongRes?.correctnessScore, 0);
  assert.deepEqual(wrongRes?.missingConcepts, ['آسيا']);
});

test('extractCurriculumConcepts extracts clauses without inventing external facts', () => {
  const concepts = extractCurriculumConcepts(SAMPLE_QUESTION.correctAnswer);
  assert.ok(concepts.length >= 1);
  assert.ok(concepts.some(c => c.includes('الديانات')));
});

test('All 6 WAV audio assets exist with valid RIFF/WAVE headers', () => {
  const soundsDir = path.join(process.cwd(), 'public', 'assets', 'sounds');
  const expectedFiles = [
    'correct.wav',
    'partially_correct.wav',
    'incorrect.wav',
    'quiz_complete.wav',
    'level_up.wav',
    'click.wav',
  ];

  for (const file of expectedFiles) {
    const fullPath = path.join(soundsDir, file);
    assert.ok(fs.existsSync(fullPath), `${file} must exist`);
    const buf = fs.readFileSync(fullPath);
    assert.ok(buf.length > 1000, `${file} must contain non-empty audio samples`);
    assert.equal(buf.toString('ascii', 0, 4), 'RIFF');
    assert.equal(buf.toString('ascii', 8, 12), 'WAVE');
  }
});

test('SoundEffectsManager mute state toggles and triggers listeners cleanly', () => {
  const observed: boolean[] = [];
  const unsub = soundEffects.subscribe((m) => observed.push(m));
  const initial = soundEffects.isMuted();
  const afterToggle = soundEffects.toggleMute();
  assert.equal(afterToggle, !initial);
  assert.equal(observed[observed.length - 1], afterToggle);
  soundEffects.setMuted(initial);
  unsub();
});
