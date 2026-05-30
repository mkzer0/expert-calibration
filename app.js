import { questions } from "./questions.js";

export const CONFIDENCE_LEVELS = [0.5, 0.6, 0.7, 0.8, 0.9];
const ROUND_SIZE = 5;

const state = {
  currentView: "landing",
  questions: [],
  currentIndex: 0,
  answers: [],
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
  render();
}

function formatNumber(value, maximumFractionDigits = 2) {
  return new Intl.NumberFormat("en", { maximumFractionDigits }).format(value);
}

function formatConfidence(value) {
  return `${Math.round(value * 100)}%`;
}

function getRoundStats() {
  const actualHits = state.answers.filter((answer) => answer.hit).length;
  const expectedHits = state.answers.reduce((total, answer) => total + answer.confidence, 0);
  const averageConfidence = expectedHits / state.answers.length;
  const totalIntervalScore = state.answers.at(-1)?.cumulativeScore || 0;
  const averageWidthRatio = state.answers.reduce((total, answer) => {
    const question = state.questions.find((item) => item.id === answer.questionId);
    return total + ((answer.high - answer.low) / question.normalizer);
  }, 0) / state.answers.length;

  return {
    actualHits,
    expectedHits,
    averageConfidence,
    totalIntervalScore,
    averageWidthRatio
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
          <span>Interval score</span>
          <strong>${formatNumber(stats.totalIntervalScore)}</strong>
        </article>
      </div>

      <p class="interpretation">${getInterpretation(stats)}</p>

      <section class="chart-section" aria-labelledby="chart-heading">
        <div class="section-heading">
          <h2 id="chart-heading">Cumulative interval score</h2>
          <p>Lower is better. Green points contained the truth; red points missed.</p>
        </div>
        ${renderChart(state.answers)}
      </section>

      <section class="chart-section" aria-labelledby="calibration-chart-heading">
        <div class="section-heading">
          <h2 id="calibration-chart-heading">Calibration progress</h2>
          <p>The teal line is your cumulative hits. The gold line is what perfect calibration would predict from your confidence choices.</p>
        </div>
        ${renderCalibrationChart(state.answers)}
      </section>

      ${renderResultRows()}

      <section class="tips">
        <h2>Next-round tips</h2>
        <ul>
          <li>Use Fermi decomposition: break the unknown into smaller estimable parts.</li>
          <li>Ask why your first answer might be wrong before committing to a range.</li>
          <li>Before submitting, ask whether you would rather bet on your range or on a lottery with the same odds.</li>
          <li>For unfamiliar quantities, estimate the order of magnitude first.</li>
          <li>High confidence should usually feel wider than your first instinct.</li>
        </ul>
      </section>

      <div class="actions">
        <button class="primary-action" data-start>Play again</button>
        <button class="secondary-action" data-stop>Stop</button>
      </div>
    </section>
  `;

  app.querySelector("[data-start]").addEventListener("click", startRound);
  app.querySelector("[data-stop]").addEventListener("click", stopSession);
}

function renderChart(answers) {
  const width = 760;
  const height = 340;
  const margin = { top: 26, right: 28, bottom: 54, left: 62 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  const maxScore = Math.max(...answers.map((answer) => answer.cumulativeScore), 1);
  const points = answers.map((answer, index) => {
    const x = margin.left + (plotWidth * index) / Math.max(answers.length - 1, 1);
    const y = margin.top + plotHeight - (answer.cumulativeScore / maxScore) * plotHeight;
    return { ...answer, x, y, index };
  });
  const polyline = points.map((point) => `${point.x},${point.y}`).join(" ");

  return `
    <svg class="score-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative interval score over five questions">
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="axis"></line>
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="axis"></line>
      ${[0, 0.25, 0.5, 0.75, 1].map((tick) => {
        const y = margin.top + plotHeight - tick * plotHeight;
        return `
          <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="gridline"></line>
          <text x="${margin.left - 12}" y="${y + 4}" text-anchor="end" class="tick-label">${formatNumber(maxScore * tick)}</text>
        `;
      }).join("")}
      <polyline points="${polyline}" class="score-line"></polyline>
      ${points.map((point) => `
        <g>
          <circle cx="${point.x}" cy="${point.y}" r="8" class="${point.hit ? "hit-dot" : "miss-dot"}"></circle>
          <text x="${point.x}" y="${height - margin.bottom + 28}" text-anchor="middle" class="tick-label">Q${point.index + 1}</text>
          <text x="${point.x}" y="${point.y - 14}" text-anchor="middle" class="confidence-label">${formatConfidence(point.confidence)}</text>
        </g>
      `).join("")}
      <text x="18" y="${height / 2}" class="axis-title" transform="rotate(-90 18 ${height / 2})">Cumulative score</text>
      <text x="${width / 2}" y="${height - 12}" text-anchor="middle" class="axis-title">Questions in this round</text>
    </svg>
  `;
}

export function renderCalibrationChart(answers) {
  const width = 760;
  const height = 340;
  const margin = { top: 30, right: 34, bottom: 58, left: 58 };
  const plotWidth = width - margin.left - margin.right;
  const plotHeight = height - margin.top - margin.bottom;
  let cumulativeHits = 0;
  let cumulativeExpected = 0;
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
      actualY: margin.top + plotHeight - (cumulativeHits / answers.length) * plotHeight,
      expectedY: margin.top + plotHeight - (cumulativeExpected / answers.length) * plotHeight
    };
  });
  const actualLine = points.map((point) => `${point.x},${point.actualY}`).join(" ");
  const expectedLine = points.map((point) => `${point.x},${point.expectedY}`).join(" ");

  return `
    <svg class="score-chart calibration-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cumulative actual hits versus perfectly calibrated expected hits">
      <line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${height - margin.bottom}" class="axis"></line>
      <line x1="${margin.left}" y1="${height - margin.bottom}" x2="${width - margin.right}" y2="${height - margin.bottom}" class="axis"></line>
      ${[0, 1, 2, 3, 4, 5].map((tick) => {
        const y = margin.top + plotHeight - (tick / answers.length) * plotHeight;
        return `
          <line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" class="gridline"></line>
          <text x="${margin.left - 12}" y="${y + 4}" text-anchor="end" class="tick-label">${tick}</text>
        `;
      }).join("")}
      <polyline points="${expectedLine}" class="expected-line"></polyline>
      <polyline points="${actualLine}" class="actual-line"></polyline>
      ${points.map((point) => `
        <g>
          <circle cx="${point.x}" cy="${point.actualY}" r="7" class="${point.answer.hit ? "hit-dot" : "miss-dot"}"></circle>
          <circle cx="${point.x}" cy="${point.expectedY}" r="5" class="expected-dot"></circle>
          <text x="${point.x}" y="${height - margin.bottom + 28}" text-anchor="middle" class="tick-label">Q${point.index + 1}</text>
        </g>
      `).join("")}
      <g class="chart-legend">
        <line x1="${width - 245}" y1="24" x2="${width - 210}" y2="24" class="actual-line"></line>
        <text x="${width - 202}" y="29">Your cumulative hits</text>
        <line x1="${width - 245}" y1="46" x2="${width - 210}" y2="46" class="expected-line"></line>
        <text x="${width - 202}" y="51">Perfectly calibrated</text>
      </g>
      <text x="18" y="${height / 2}" class="axis-title" transform="rotate(-90 18 ${height / 2})">Cumulative hits</text>
      <text x="${width / 2}" y="${height - 12}" text-anchor="middle" class="axis-title">Questions in this round</text>
    </svg>
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
