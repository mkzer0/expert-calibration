import assert from "node:assert/strict";
import { CONFIDENCE_LEVELS, calculateIntervalScore, calculateRoundStats, drawRoundQuestions, getCalibrationStatus, getCalibrationTips, getInputUnit, renderCalibrationChart, scoreAnswer } from "../app.js";
import { questions } from "../questions.js";

const drawn = drawRoundQuestions(questions, 5, (() => {
  const values = [0.1, 0.7, 0.3, 0.9, 0.2, 0.8, 0.4, 0.6, 0.5];
  let index = 0;
  return () => values[index++ % values.length];
})());

assert.equal(drawn.length, 5);
assert.equal(new Set(drawn.map((question) => question.id)).size, 5);
assert.deepEqual(CONFIDENCE_LEVELS, [0.5, 0.6, 0.7, 0.8, 0.9]);

assert.deepEqual(getInputUnit({ answer: 68300000, unit: "people" }), {
  scale: 1000000,
  unit: "millions of people",
  hint: "Enter values in millions of people. For example, 68.3 means 68.3 million people.",
  placeholderLow: "e.g. 20",
  placeholderHigh: "e.g. 90"
});

assert.equal(getInputUnit({ answer: 8848.86, unit: "metres" }).unit, "metres");

const question = {
  id: "example",
  answer: 100,
  normalizer: 100
};

const narrowCorrect = calculateIntervalScore({
  low: 95,
  high: 105,
  answer: 100,
  confidence: 0.9,
  normalizer: 100
});

const wideCorrect = calculateIntervalScore({
  low: 50,
  high: 150,
  answer: 100,
  confidence: 0.9,
  normalizer: 100
});

assert.ok(narrowCorrect < wideCorrect);

const lowConfidenceMiss = scoreAnswer(question, {
  low: 80,
  high: 90,
  confidence: 0.5
});

const highConfidenceMiss = scoreAnswer(question, {
  low: 80,
  high: 90,
  confidence: 0.9
});

assert.equal(lowConfidenceMiss.hit, false);
assert.equal(highConfidenceMiss.hit, false);
assert.ok(highConfidenceMiss.intervalScore > lowConfidenceMiss.intervalScore);

const calibrationChart = renderCalibrationChart([
  { hit: true, confidence: 0.9 },
  { hit: false, confidence: 0.8 },
  { hit: true, confidence: 0.7 },
  { hit: true, confidence: 0.6 },
  { hit: false, confidence: 0.5 }
]);

assert.match(calibrationChart, /actual cumulative hits/);
assert.match(calibrationChart, /expected hits/);
assert.match(calibrationChart, /class="actual-line"/);
assert.match(calibrationChart, /class="expected-line"/);

const multiRoundChart = renderCalibrationChart([
  {
    roundNumber: 1,
    answers: [
      { hit: true, confidence: 0.8 },
      { hit: false, confidence: 0.8 },
      { hit: true, confidence: 0.8 },
      { hit: false, confidence: 0.8 },
      { hit: true, confidence: 0.8 }
    ]
  },
  {
    roundNumber: 2,
    answers: [
      { hit: true, confidence: 0.9 },
      { hit: true, confidence: 0.9 },
      { hit: false, confidence: 0.9 },
      { hit: true, confidence: 0.9 },
      { hit: true, confidence: 0.9 }
    ]
  }
]);

assert.match(multiRoundChart, /Round 1/);
assert.match(multiRoundChart, /Round 2/);
assert.match(multiRoundChart, /Solid line:/);
assert.match(multiRoundChart, /Dashed line:/);

const stats = calculateRoundStats(
  [
    { hit: false, confidence: 0.9, high: 90, low: 80 },
    { hit: false, confidence: 0.9, high: 90, low: 80 },
    { hit: true, confidence: 0.9, high: 120, low: 80 },
    { hit: false, confidence: 0.9, high: 90, low: 80 },
    { hit: true, confidence: 0.9, high: 120, low: 80 }
  ],
  Array.from({ length: 5 }, () => ({ id: "example", normalizer: 100 }))
);

assert.equal(stats.actualHits, 2);
assert.equal(stats.expectedHits, 4.5);
assert.ok(getCalibrationTips(stats).some((tip) => tip.includes("below the calibrated line")));
assert.equal(getCalibrationStatus(-0.8).tone, "overconfident");
assert.equal(getCalibrationStatus(0.8).tone, "underconfident");
assert.equal(getCalibrationStatus(0.2).tone, "calibrated");

console.log("All scoring tests passed.");
