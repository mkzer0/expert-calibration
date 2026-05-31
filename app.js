import { questions } from "./questions.js";

export const CONFIDENCE_LEVELS = [0.5, 0.6, 0.7, 0.8, 0.9];
const ROUND_SIZE = 5;

const state = {
  currentView: "landing",
  questions: [],
  currentIndex: 0,
  answers: [],
  roundHistory: [],
  hasCompletedFirstRound: false
};

const app = typeof document === "undefined" ? null : document.querySelector("#app");

export function shuffle(items, random = Math.random) {
  const copy = [...items];

  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }

  return copy;
}

export function drawRoundQuestions(questionPool, roundSize = ROUND_SIZE, random = Math.random) {
  return shuffle(questionPool, random).slice(0, roundSize);
}

export function calculateIntervalScore({ low, high, answer, confidence, normalizer }) {
  const alpha = 1 - confidence;
  const scale = normalizer || Math.max(Math.abs(answer), 1);
  const widthCost = (high - low) / scale;
  const missCost =
    answer < low ? (2 / alpha) * ((low - answer) / scale) :
    answer > high ? (2 / alpha) * ((answer - high) / scale) :
    0;

  return widthCost + missCost;
}

export function scoreAnswer(question, answer) {
  const hit = question.answer >= answer.low && question.answer <= answer.high;
  const intervalScore = calculateIntervalScore({
    low: answer.low,
    high: answer.high,
    answer: question.answer,
    confidence: answer.confidence,
    normalizer: question.normalizer
  });

  return {
    ...answer,
    hit,
    intervalScore
  };
}

export function getInputUnit(question) {
  if (Math.abs(question.answer) >= 1000000) {
    return {
      scale: 1000000,
      unit: `millions of ${question.unit}`,
      hint: `Enter values in millions of ${question.unit}. For example, 68.3 means 68.3 million ${question.unit}.`,
      placeholderLow: "e.g. 20",
      placeholderHigh: "e.g. 90"
    };
  }

  return {
    scale: 1,
    unit: question.unit,
    hint: `Enter values in ${question.unit}.`,
    placeholderLow: "e.g. 1000",
    placeholderHigh: "e.g. 5000"
  };
}

function startRound() {
  state.questions = drawRoundQuestions(questions);
  state.currentIndex = 0;
  state.answers = [];
  state.currentView = "question";
  render();
}

function submitAnswer(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const question = state.questions[state.currentIndex];
  const inputUnit = getInputUnit(question);
  const inputLow = Number(form.low.value);
  const inputHigh = Number(form.high.value);
  const low = inputLow * inputUnit.scale;
  const high = inputHigh * inputUnit.scale;
  const confidence = Number(form.confidence.value);
  const error = form.querySelector("[data-error]");

  if (!Number.isFinite(inputLow) || !Number.isFinite(inputHigh)) {
    error.textContent = "Enter numeric lower and upper bounds.";
    return;
  }

  if (inputLow > inputHigh) {
    error.textContent = "The lower bound must be less than or equal to the upper bound.";
    return;
  }

  if (!CONFIDENCE_LEVELS.includes(confidence)) {
    error.textContent = "Choose one of the listed confidence levels.";
    return;
  }

  const scored = scoreAnswer(question, {
    questionId: question.id,
    inputLow,
    inputHigh,
    inputUnit: inputUnit.unit,
    low,
    high,
    confidence
  });

  const previousCumulative = state.answers.at(-1)?.cumulativeScore || 0;
  state.answers.push({
    ...scored,
    cumulativeScore: previousCumulative + scored.intervalScore
  });

  if (state.answers.length === state.questions.length) {
    state.hasCompletedFirstRound = true;
    state.roundHistory.push({
      roundNumber: state.roundHistory.length + 1,
      questions: [...state.questions],
      answers: [...state.answers]
    });
    state.currentView = "results";
  } else {
    state.currentIndex += 1;
  }

  render();
}

function stopSession() {
  state.currentView = "landing";
  state.questions = [];
  state.currentIndex = 0;
  state.answers = [];
  state.roundHistory = [];
  render();
}

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en", { maximumFractionDigits }).format(value);
}

function formatConfidence(value) {
  return `${Math.round(value * 100)}%`;
}

function getRoundStats() {
  return calculateRoundStats(state.answers, state.questions);
}

export function calculateRoundStats(answers, roundQuestions = []) {
  const actualHits = answers.filter((answer) => answer.hit).length;
  const expectedHits = answers.reduce((total, answer) => total + answer.confidence, 0);
  const averageConfidence = expectedHits / answers.length;
  const totalIntervalScore = answers.at(-1)?.cumulativeScore || 0;
  const averageWidthRatio = answers.reduce((total, answer, index) => {
    const question = roundQuestions.find((item) => item.id === answer.questionId) || roundQuestions[index];
    if (!question) {
      return total;
    }

    return total + ((answer.high - answer.low) / question.normalizer);
  }, 0) / answers.length;
  const calibrationGap = actualHits - expectedHits;

  return {
    actualHits,
    expectedHits,
    averageConfidence,
    totalIntervalScore,
    averageWidthRatio,
    calibrationGap
  };
}

function getInterpretation(stats) {
  if (stats.actualHits + 0.5 < stats.expectedHits) {
    return "Your ranges missed more often than your confidence implied. That is a classic overconfidence signal: try widening intervals or challenging the first anchor.";
  }

  if (stats.actualHits > stats.expectedHits + 1 && stats.averageWidthRatio > 0.75) {
    return "You contained the truth often, but your ranges may be too broad to support a business decision. Try decomposing the question to reduce uncertainty.";
  }

  return "Your hit rate is close to your stated confidence for this round. Keep repeating rounds to see whether that pattern holds.";
}

export function getCalibrationTips(stats, previousStats = null) {
  const tips = [];
  const absoluteGap = Math.abs(stats.calibrationGap);
  const previousGap = previousStats ? Math.abs(previousStats.calibrationGap) : null;

  if (stats.actualHits + 0.5 < stats.expectedHits) {
    tips.push("Your actual hits are below the calibrated line. Next round, widen ranges or lower confidence when you do not have strong evidence.");
  } else if (stats.actualHits > stats.expectedHits + 1 && stats.averageWidthRatio > 0.75) {
    tips.push("You are beating the calibrated line, but your ranges are very wide. Try narrowing ranges until the equivalence bet feels like a close call.");
  } else {
    tips.push("Your actual hits are close to what your confidence predicted. Keep repeating rounds to see whether that pattern holds.");
  }

  if (previousGap !== null) {
    if (absoluteGap < previousGap) {
      tips.push("Your calibration gap improved versus the previous round. That is the skill building: estimate, get feedback, adjust.");
    } else if (absoluteGap > previousGap) {
      tips.push("Your calibration gap widened versus the previous round. Look back at the misses and ask whether the ranges were too narrow or the confidence was too high.");
    } else {
      tips.push("Your calibration gap is unchanged from the previous round. Try changing one thing deliberately: range width, confidence level, or decomposition.");
    }
  }

  if (stats.averageConfidence >= 0.85 && stats.actualHits < stats.expectedHits) {
    tips.push("You used high confidence and still missed. Use the bet test before submitting: would you really prefer your range over the same-odds lottery?");
  }

  if (stats.averageWidthRatio > 1.5) {
    tips.push("Your average range is wider than the answer scale. Before the next round, decompose the question so the interval becomes more decision-useful.");
  }

  return tips.slice(0, 4);
}

function renderLanding() {
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow">Calibration Range Trainer</div>
      <h1>Estimate ranges that match your uncertainty.</h1>
      <p>
        This workshop tool trains calibrated estimation: choose a confidence level,
        then give a range where you believe the true answer falls inside that range.
      </p>
      <div class="hero-actions">
        <button class="primary-action" data-start>Start a round</button>
        <a class="secondary-link" href="faq.html">Read the FAQ</a>
      </div>
    </section>

    <section class="info-grid" aria-label="How the exercise works">
      <article>
        <h2>Pick confidence</h2>
        <p>A 50% range should contain about half of similar answers. A 90% range should contain about nine out of ten.</p>
      </article>
      <article>
        <h2>Set a range</h2>
        <p>Enter lower and upper bounds. Wide ranges are safer, but very wide ranges are less useful for decisions.</p>
      </article>
      <article>
        <h2>Test the bet</h2>
        <p>Use the bet test to push your range toward the edge of your understanding: not padded for safety, not narrowed for false precision.</p>
      </article>
      <article>
        <h2>Learn from feedback</h2>
        <p>After every 5-question round, compare actual hits with expected hits and inspect your cumulative score chart.</p>
      </article>
    </section>

    <section class="research-note">
      <h2>Research basis</h2>
      <p>
        Inspired by Douglas Hubbard's calibrated estimation work, Alpert and Raiffa on
        probability assessors, Lichtenstein and Fischhoff on calibration feedback, and
        proper scoring ideas that reward useful uncertainty rather than false precision.
      </p>
    </section>
  `;

  app.querySelector("[data-start]").addEventListener("click", startRound);
}

function renderQuestion() {
  const question = state.questions[state.currentIndex];
  const inputUnit = getInputUnit(question);
  const progress = state.currentIndex + 1;

  app.innerHTML = `
    <section class="question-panel">
      <div class="question-topline">
        <span>${question.category}</span>
        <span>Question ${progress} of ${state.questions.length}</span>
      </div>
      <h1>${question.prompt}</h1>
      <p class="unit-hint">Answer unit: ${inputUnit.unit}</p>
      <p class="unit-guidance">${inputUnit.hint}</p>

      <form class="answer-form" novalidate>
        <fieldset>
          <legend>Select your confidence interval</legend>
          <div class="confidence-row">
            ${CONFIDENCE_LEVELS.map((level) => `
              <label class="confidence-option">
                <input type="radio" name="confidence" value="${level}" ${level === 0.8 ? "checked" : ""}>
                <span>${formatConfidence(level)}</span>
              </label>
            `).join("")}
          </div>
        </fieldset>

        <section class="bet-helper">
          <button class="secondary-action bet-toggle" type="button" data-bet-toggle aria-expanded="false" aria-controls="bet-panel">
            Test your range with a bet
          </button>
          <div class="bet-panel" id="bet-panel" data-bet-panel hidden>
            ${renderBetPrompt(0.8)}
          </div>
        </section>

        <div class="bounds-grid">
          <label>
            Lower bound
            <input name="low" inputmode="decimal" autocomplete="off" placeholder="${inputUnit.placeholderLow}">
          </label>
          <label>
            Upper bound
            <input name="high" inputmode="decimal" autocomplete="off" placeholder="${inputUnit.placeholderHigh}">
          </label>
        </div>

        <p class="form-error" data-error></p>
        <button class="primary-action" type="submit">${progress === state.questions.length ? "Finish round" : "Next question"}</button>
      </form>
    </section>
  `;

  const form = app.querySelector("form");
  form.addEventListener("submit", submitAnswer);
  form.querySelector("[data-bet-toggle]").addEventListener("click", toggleBetPrompt);
  form.querySelectorAll("input[name='confidence']").forEach((input) => {
    input.addEventListener("change", updateBetPrompt);
  });
  form.querySelector("[data-bet-panel]").addEventListener("click", handleBetReflection);
}

function getSelectedConfidence(form) {
  return Number(form.querySelector("input[name='confidence']:checked")?.value || 0.8);
}

function renderBetPrompt(confidence, reflection = "") {
  const confidenceLabel = formatConfidence(confidence);
  return `
    <div class="bet-copy">
      <h2>Equivalent bet test</h2>
      <p>You selected <strong>${confidenceLabel} confidence</strong>. Imagine two bets with the same prize.</p>
      <ul>
        <li><strong>Bet A:</strong> you win if the true answer is inside your range.</li>
        <li><strong>Bet B:</strong> you win a ${confidenceLabel} lottery.</li>
      </ul>
      <p>If Bet A feels clearly safer, your range may be too wide. If Bet B feels safer, your range may be too narrow. Adjust until the choice feels close.</p>
    </div>
    <div class="bet-reflections" aria-label="Bet reflection options">
      <button type="button" data-bet-reflection="If your range feels too narrow, widen one or both bounds until Bet A and Bet B feel close.">My range feels too narrow</button>
      <button type="button" data-bet-reflection="If your range feels too wide, tighten one or both bounds until you would hesitate between the range and the lottery.">My range feels too wide</button>
      <button type="button" data-bet-reflection="Good. Submit when the range and the lottery feel about equally attractive.">This feels close</button>
    </div>
    <p class="bet-note" data-bet-note>${reflection}</p>
  `;
}

function updateBetPrompt(event) {
  const form = event.currentTarget.form;
  const panel = form.querySelector("[data-bet-panel]");

  if (panel.hidden) {
    return;
  }

  panel.innerHTML = renderBetPrompt(getSelectedConfidence(form), panel.querySelector("[data-bet-note]")?.textContent || "");
}

function toggleBetPrompt(event) {
  const button = event.currentTarget;
  const form = button.form;
  const panel = form.querySelector("[data-bet-panel]");
  const willOpen = panel.hidden;

  panel.hidden = !willOpen;
  button.setAttribute("aria-expanded", String(willOpen));

  if (willOpen) {
    panel.innerHTML = renderBetPrompt(getSelectedConfidence(form));
  }
}

function handleBetReflection(event) {
  const reflection = event.target.closest("[data-bet-reflection]");

  if (!reflection) {
    return;
  }

  const note = event.currentTarget.querySelector("[data-bet-note]");
  note.textContent = reflection.dataset.betReflection;
}

function renderResults() {
  const stats = getRoundStats();
  const previousRound = state.roundHistory.at(-2);
  const previousStats = previousRound ? calculateRoundStats(previousRound.answers, previousRound.questions) : null;

  app.innerHTML = `
    <section class="results-panel">
      <div class="eyebrow">Round complete</div>
      <h1>Your calibration summary</h1>
      <div class="stats-grid">
        <article>
          <span>Simple score</span>
          <strong>${stats.actualHits}/5</strong>
        </article>
        <article>
          <span>Expected hits</span>
          <strong>${formatNumber(stats.expectedHits)}</strong>
        </article>
        <article>
          <span>Average confidence</span>
          <strong>${formatConfidence(stats.averageConfidence)}</strong>
        </article>
        <article>
          <span>Calibration gap</span>
          <strong>${formatCalibrationGap(stats.calibrationGap)}</strong>
        </article>
      </div>

      <p class="interpretation">${getInterpretation(stats)}</p>

      <section class="chart-section" aria-labelledby="calibration-chart-heading">
        <div class="section-heading">
          <h2 id="calibration-chart-heading">Calibration progress</h2>
          <p>Each round has its own color. Solid lines are actual hits; dashed lines are expected hits from confidence.</p>
        </div>
        ${renderCalibrationChart(state.roundHistory)}
      </section>

      ${renderCalibrationTips(stats, previousStats)}

      ${renderResultRows()}

      <div class="actions">
        <button class="primary-action" data-start>Play again</button>
        <button class="secondary-action" data-stop>Stop</button>
      </div>
    </section>
  `;

  app.querySelector("[data-start]").addEventListener("click", startRound);
  app.querySelector("[data-stop]").addEventListener("click", stopSession);
}

function formatCalibrationGap(value) {
  const formatted = formatNumber(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : "0";
}

function renderCalibrationTips(stats, previousStats) {
  return `
    <section class="tips">
      <h2>So what? Try this next round</h2>
      <ul>
        ${getCalibrationTips(stats, previousStats).map((tip) => `<li>${tip}</li>`).join("")}
      </ul>
    </section>
  `;
}

export function renderCalibrationChart(roundsOrAnswers) {
  const rounds = Array.isArray(roundsOrAnswers?.[0]?.answers)
    ? roundsOrAnswers
    : [{ roundNumber: 1, answers: roundsOrAnswers }];
  const width = 760;
  const height = 340;
  const margin = { top: 30, right: 34, bottom: 58, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const colors = ["#0b6f70", "#9b5de5", "#d97706", "#2563eb", "#c026d3", "#15803d"];
  const plottedRounds = rounds.map((round, roundIndex) => {
    let cumulativeHits = 0;
    let cumulativeExpected = 0;
    const answers = round.answers;
    const points = answers.map((answer, index) => {
      cumulativeHits += answer.hit ? 1 : 0;
      cumulativeExpected += answer.confidence;
      const x = margin.left + (plotWidth * index) / Math.max(answers.length - 1, 1);

      return {
        index,
        answer,
        x,
        actual: cumulativeHits,
        expected: cumulativeExpected,
        actualY: margin.top + plotHeight - (cumulativeHits / ROUND_SIZE) * plotHeight,
        expectedY: margin.top + plotHeight - (cumulativeExpected / ROUND_SIZE) * plotHeight
      };
    });

    return {
      ...round,
      color: colors[roundIndex % colors.length],
      points,
      actualLine: points.map((point) => `${point.x},${point.actualY}`).join(" "),
      expectedLine: points.map((point) => `${point.x},${point.expectedY}`).join(" ")
    };
  });

  return `
    <svg class="score-chart calibration-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative actual hits versus perfectly calibrated expected hits">
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="axis"></line>
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="axis"></line>
      ${[0, 1, 2, 3, 4, 5].map((tick) => {
        const y = margin.top + plotHeight - (tick / ROUND_SIZE) * plotHeight;
        return `
          <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="gridline"></line>
          <text x="${margin.left - 12}" y="${y + 4}" text-anchor="end" class="tick-label">${tick}</text>
        `;
      }).join("")}
      ${plottedRounds.map((round) => `
        <polyline points="${round.expectedLine}" class="expected-line" style="stroke: ${round.color}"></polyline>
        <polyline points="${round.actualLine}" class="actual-line" style="stroke: ${round.color}"></polyline>
        ${round.points.map((point) => `
          <g>
            <circle cx="${point.x}" cy="${point.actualY}" r="6" class="${point.answer.hit ? "hit-dot" : "miss-dot"}" style="stroke: ${round.color}"></circle>
            <circle cx="${point.x}" cy="${point.expectedY}" r="4" class="expected-dot" style="fill: ${round.color}"></circle>
          </g>
        `).join("")}
      `).join("")}
      ${[0, 1, 2, 3, 4].map((index) => {
        const x = margin.left + (plotWidth * index) / Math.max(ROUND_SIZE - 1, 1);
        return `<text x="${x}" y="${height - margin.bottom + 28}" text-anchor="middle" class="tick-label">Q${index + 1}</text>`;
      }).join("")}
      <g class="chart-legend">
        ${plottedRounds.map((round, index) => {
          const y = 24 + index * 22;
          return `
            <line x1="${width - 245}" y1="${y}" x2="${width - 210}" y2="${y}" class="actual-line" style="stroke: ${round.color}"></line>
            <text x="${width - 202}" y="${y + 5}">Round ${round.roundNumber}</text>
          `;
        }).join("")}
      </g>
      <text x="18" y="${height / 2}" class="axis-title" transform="rotate(-90 18 ${height / 2})">Cumulative hits</text>
      <text x="${width / 2}" y="${height - 12}" text-anchor="middle" class="axis-title">Questions in this round</text>
    </svg>
    <div class="chart-key" aria-label="Chart line key">
      <span><strong>Solid line:</strong> actual cumulative hits</span>
      <span><strong>Dashed line:</strong> expected hits if your confidence is calibrated</span>
    </div>
  `;
}

function renderResultRows() {
  return `
    <section class="details-section">
      <div class="section-heading">
        <h2>Question details</h2>
        <p>Your range, confidence, true answer, and source for each item.</p>
      </div>
      <div class="result-list">
        ${state.answers.map((answer, index) => {
          const question = state.questions[index];
          return `
            <article class="result-row ${answer.hit ? "is-hit" : "is-miss"}">
              <div>
                <span class="result-status">${answer.hit ? "Inside range" : "Outside range"}</span>
                <h3>Q${index + 1}. ${question.prompt}</h3>
                <p>Range: ${formatNumber(answer.inputLow ?? answer.low)} to ${formatNumber(answer.inputHigh ?? answer.high)} ${answer.inputUnit ?? question.unit} at ${formatConfidence(answer.confidence)} confidence.</p>
              </div>
              <dl>
                <div>
                  <dt>True value</dt>
                  <dd>${question.displayAnswer}</dd>
                </div>
                <div>
                  <dt>Score</dt>
                  <dd>${formatNumber(answer.intervalScore)}</dd>
                </div>
                <div>
                  <dt>Cumulative</dt>
                  <dd>${formatNumber(answer.cumulativeScore)}</dd>
                </div>
                <div>
                  <dt>Source</dt>
                  <dd><a href="${question.sourceUrl}" target="_blank" rel="noreferrer">${question.sourceName}</a></dd>
                </div>
              </dl>
            </article>
          `;
        }).join("")}
      </div>
    </section>
  `;
}

function render() {
  if (state.currentView === "landing") {
    renderLanding();
    return;
  }

  if (state.currentView === "question") {
    renderQuestion();
    return;
  }

  renderResults();
}

if (app) {
  render();
}
