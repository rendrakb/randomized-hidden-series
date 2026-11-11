const CONFIG = {
  MAX_ATTEMPTS: 1000,
  COLORS: {
    CORRECT: "lightgreen",
    INCORRECT: "red",
  },
};

const state = {
  config: null,
  currentTable: [],
  currentAnswer: null,
  currentLogic: "",
  currentQuestionText: "",
  pageStartTime: Date.now(),
  lastSubmitTime: null,
  correctCount: 0,
  totalAttempts: 0,
  currentQuestionSubmitted: false,
};

const rand = {
  int(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  },
  pick(array) {
    return array[Math.floor(Math.random() * array.length)];
  },
  // Pick `n` distinct items from an array
  sample(array, n) {
    const copy = [...array];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, n);
  },
};

class SeriesGenerator {
  // Hidden rule: value(unit) = offset + sign * step * unit
  // addition => sign +1, subtraction => sign -1
  buildRule(pattern) {
    const sign = pattern.type === "subtraction" ? -1 : 1;
    const step = rand.int(pattern.step.min, pattern.step.max);
    const offset = rand.int(pattern.offset.min, pattern.offset.max);
    const fn = (unit) => offset + sign * step * unit;

    const op = sign > 0 ? "+" : "−";
    const logic =
      offset === 0
        ? `Value = ${sign > 0 ? "" : "−"}${step} × unit`
        : `Value = ${offset} ${op} ${step} × unit`;
    return { fn, logic };
  }

  generate() {
    const cfg = state.config;
    if (!cfg) {
      console.warn("Cannot generate question: config not loaded");
      return null;
    }

    const { unit, value, rows } = cfg;

    for (let attempt = 0; attempt < CONFIG.MAX_ATTEMPTS; attempt++) {
      const pattern = rand.pick(cfg.patterns);
      const { fn, logic } = this.buildRule(pattern);

      // Only units whose resulting value stays inside [value.min, value.max].
      // Values are always integers because step/offset/unit are integers.
      const validUnits = [];
      for (let u = unit.min; u <= unit.max; u++) {
        const v = fn(u);
        if (Number.isInteger(v) && v >= value.min && v <= value.max) {
          validUnits.push(u);
        }
      }

      // Need `rows` table units + 1 hidden (questioned) unit
      if (validUnits.length < rows + 1) continue;

      const picked = rand.sample(validUnits, rows + 1);
      const queriedUnit = picked.pop();
      const table = picked
        .sort((a, b) => a - b)
        .map((u) => ({ unit: u, value: fn(u) }));

      const question = rand.pick(cfg.questions);
      const queriedValue = fn(queriedUnit);
      let answer;
      if (question.type === "valueOfUnit") {
        answer = queriedValue;
      } else if (question.type === "unitOfValue") {
        answer = queriedUnit;
      } else {
        console.warn(`Unknown question type: ${question.type}`);
        continue;
      }

      const text = question.text
        .replace("{unit}", queriedUnit)
        .replace("{value}", queriedValue);

      state.currentTable = table;
      state.currentAnswer = answer;
      state.currentLogic = logic;
      state.currentQuestionText = text;
      return { table, answer, logic, text };
    }

    console.warn("Could not generate a valid question.");
    return null;
  }
}

class TableRenderer {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
  }

  render(table) {
    const rows = table
      .map((r) => `<tr><td>${r.unit}</td><td>${r.value}</td></tr>`)
      .join("");
    this.container.innerHTML = `
      <table>
        <thead><tr><th>Unit</th><th>Value</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }
}

class UIController {
  constructor() {
    this.elements = {
      questionDisplay: document.querySelector(".questions"),
      answerInput: document.getElementById("answerInput"),
      feedback: document.getElementById("feedback"),
      answerDiv: null,
      score: document.getElementById("score"),
      lastTime: document.getElementById("last-time"),
      totalTime: document.getElementById("total-time"),
    };
  }

  displayQuestion(text, answer, logic) {
    this.elements.questionDisplay.innerHTML = `
      <strong>${text}</strong><br>
      <div id="answer" style="display:none;">Answer: ${answer}<br>Logic: ${logic}</div>
    `;
    this.clearInput();
    this.clearFeedback();
    this.elements.answerDiv = document.getElementById("answer");
  }

  clearInput() {
    this.elements.answerInput.value = "";
  }

  clearFeedback() {
    this.elements.feedback.textContent = "";
    this.elements.feedback.style.color = "";
  }

  showAnswer() {
    if (this.elements.answerDiv) {
      this.elements.answerDiv.style.display = "block";
    }
  }

  showFeedback(isCorrect) {
    this.elements.feedback.textContent = isCorrect ? "Correct." : "Wrong";
    this.elements.feedback.style.color = isCorrect
      ? CONFIG.COLORS.CORRECT
      : CONFIG.COLORS.INCORRECT;
  }

  updateScore() {
    this.elements.score.textContent = `Score: ${state.correctCount}/${state.totalAttempts}`;
  }

  updateLastTime(seconds) {
    this.elements.lastTime.textContent = `Last time spent: ${this.formatTime(seconds)}`;
  }

  updateTotalTime() {
    const totalSeconds = (Date.now() - state.pageStartTime) / 1000;
    this.elements.totalTime.textContent = `Total time spent: ${this.formatTime(totalSeconds)}`;
  }

  formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  getUserAnswer() {
    return this.elements.answerInput.value;
  }
}

class AnswerValidator {
  static parse(answer) {
    if (answer == null) return NaN;
    const cleaned = String(answer).trim().replace(/,/g, "");
    if (cleaned === "") return NaN;
    return Number(cleaned);
  }

  static isCorrect(userAnswer, correctAnswer) {
    const user = this.parse(userAnswer);
    return !Number.isNaN(user) && user === Number(correctAnswer);
  }
}

class QuizApp {
  constructor() {
    this.renderer = new TableRenderer("table");
    this.generator = new SeriesGenerator();
    this.uiController = new UIController();
    this.initialize();
  }

  async initialize() {
    await this.loadConfig();
    this.setupEventListeners();
    this.startTimers();
    this.generateNewQuestion();
  }

  async loadConfig() {
    try {
      const response = await fetch("q.json");
      state.config = await response.json();
    } catch (error) {
      console.error("Error loading q.json:", error);
      alert("Could not load q.json.");
    }
  }

  setupEventListeners() {
    document
      .getElementById("questionButton")
      .addEventListener("click", () => this.generateNewQuestion());

    document
      .getElementById("answerButton")
      .addEventListener("click", () => this.uiController.showAnswer());

    document
      .getElementById("randomizeButton")
      .addEventListener("click", () => this.generateNewQuestion());

    document
      .getElementById("submitAnswerButton")
      .addEventListener("click", () => this.handleSubmit());

    this.uiController.elements.answerInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") this.handleSubmit();
    });
  }

  startTimers() {
    setInterval(() => this.uiController.updateTotalTime(), 1000);
  }

  generateNewQuestion() {
    const result = this.generator.generate();
    if (!result) return;

    this.renderer.render(result.table);
    this.uiController.displayQuestion(result.text, result.answer, result.logic);
    state.currentQuestionSubmitted = false;
  }

  handleSubmit() {
    if (state.currentQuestionSubmitted) return;

    const isCorrect = AnswerValidator.isCorrect(
      this.uiController.getUserAnswer(),
      state.currentAnswer,
    );

    state.totalAttempts++;
    if (isCorrect) state.correctCount++;

    this.uiController.updateScore();
    this.uiController.showFeedback(isCorrect);

    const now = Date.now();
    if (state.lastSubmitTime) {
      this.uiController.updateLastTime((now - state.lastSubmitTime) / 1000);
    }
    state.lastSubmitTime = now;

    state.currentQuestionSubmitted = true;
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => new QuizApp());
} else {
  new QuizApp();
}
