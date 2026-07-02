const express = require("express");
const router = express.Router();
const Anthropic = require("@anthropic-ai/sdk");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const INFERMEDICA_BASE = "https://api.infermedica.com/v3";

const DISCLAIMER =
  "\n\n---\n*⚠️ Ava provides general health information only — not a medical diagnosis. Always consult a qualified doctor for medical decisions.*";

const AVA_SYSTEM_PROMPT = `
You are Ava, a safe AI health assistant for CareGuruPlus.

Your job is to guide users step by step, not diagnose them.

Very important rules:
- Do NOT give a final diagnosis.
- Do NOT prescribe medicines.
- Do NOT write long medical explanations.
- Ask only ONE follow-up question at a time.
- Keep replies under 80 words.
- For symptoms, first collect: age, duration, severity, temperature if fever, and any red flags.
- If symptoms seem mild, give simple self-care and suggest monitoring.
- If symptoms are persistent, worsening, severe, or unclear, suggest consulting a doctor.
- If the user asks to book a doctor, lab test, or pharmacy, include the correct action tag.

Emergency cases are already handled before you reply, so do not handle emergencies yourself.

Response style:
Warm, simple, beginner-friendly, and careful.

Action tags:
Use [BOOK_DOCTOR] when doctor consultation is relevant.
Use [ORDER_LAB] only when lab test guidance is relevant.
Use [BUY_MEDICINE] only when pharmacy help is relevant.
`;

// In-memory session store. For production, replace this with Redis/MongoDB/PostgreSQL.
const sessions = {};


const LOG_DIR = path.join(__dirname, "..", "data");
const LOG_FILE = path.join(LOG_DIR, "chat_logs.json");

function fileLoggingEnabled() {
  // Vercel serverless file storage is not permanent, so skip file logs online.
  if (process.env.VERCEL) return false;
  return process.env.FILE_LOGGING_ENABLED !== "false";
}

function ensureLogFile() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, "[]", "utf8");
  }
}

function anonymizeSessionId(sessionId) {
  return crypto
    .createHash("sha256")
    .update(String(sessionId))
    .digest("hex")
    .slice(0, 16);
}

function maskSensitiveText(text) {
  return String(text || "")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email-hidden]")
    .replace(/\b\d{10}\b/g, "[phone-hidden]");
}

function saveChatLog({ session_id, userMessage, avaReply, provider, urgency, actions, consent }) {
  if (!consent || !fileLoggingEnabled()) return;

  try {
    ensureLogFile();

    const existingLogs = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));

    existingLogs.push({
      timestamp: new Date().toISOString(),
      session_hash: anonymizeSessionId(session_id),
      user_message: maskSensitiveText(userMessage),
      ava_reply: maskSensitiveText(avaReply),
      provider,
      urgency,
      actions: (actions || []).map(action => action.type)
    });

    fs.writeFileSync(LOG_FILE, JSON.stringify(existingLogs, null, 2), "utf8");
  } catch (err) {
    console.warn("Chat log save failed:", err.message);
  }
}

function hasValue(value) {
  return value && String(value).trim() !== "" && !String(value).includes("your_");
}

function addActionButtons(reply) {
  const actions = [];

  if (reply.includes("[BOOK_DOCTOR]")) {
    actions.push({
      label: "📅 Book a Doctor",
      type: "BOOK_DOCTOR",
      url: "booking.html"
    });
  }

  if (reply.includes("[ORDER_LAB]")) {
    actions.push({
      label: "🧪 Order Lab Test",
      type: "ORDER_LAB",
      url: "lab-test.html"
    });
  }

  if (reply.includes("[BUY_MEDICINE]")) {
    actions.push({
      label: "💊 Buy Medicine",
      type: "BUY_MEDICINE",
      url: "pharmacy.html"
    });
  }

  const cleanReply = reply
    .replace(/\[BOOK_DOCTOR\]/g, "")
    .replace(/\[ORDER_LAB\]/g, "")
    .replace(/\[BUY_MEDICINE\]/g, "")
    .trim();

  return { cleanReply, actions };
}

function simpleFallbackReply(message) {
  const text = message.toLowerCase();

  if (["hi", "hello", "hey"].some(word => text === word || text.startsWith(word + " "))) {
    return "👋 Hi, I’m Ava from CareGuruPlus. Tell me what symptoms you’re having, and I’ll guide you step by step.";
  }

  if (text.includes("book") || text.includes("doctor") || text.includes("appointment")) {
    return "I can help you book a doctor consultation. Please choose the Book Doctor option and share your main concern with the doctor. [BOOK_DOCTOR]";
  }

  if (text.includes("lab") || text.includes("test")) {
    return "I can guide you to the lab test section. A doctor should suggest the correct test based on your symptoms. [ORDER_LAB]";
  }

  if (text.includes("medicine") || text.includes("pharmacy")) {
    return "I can guide you to the pharmacy section, but please avoid starting new medicines without a qualified doctor’s advice. [BUY_MEDICINE]";
  }

  return "I understand. To guide you better, can you tell me your age, how long this has been happening, and how severe it feels from 1 to 10?";
}

function guidedSymptomReply(message) {
  const text = message.toLowerCase();

  const hasFever = text.includes("fever") || text.includes("temperature");
  const hasHeadache = text.includes("headache") || text.includes("head pain");
  const hasCough = text.includes("cough");
  const hasCold = text.includes("cold") || text.includes("runny nose");
  const hasStomachPain = text.includes("stomach pain") || text.includes("abdominal pain") || text.includes("loose motion");
  const hasVomiting = text.includes("vomit") || text.includes("vomiting");
  const hasPain = text.includes("pain") || text.includes("ache");

  if (hasFever && hasHeadache) {
    return "I’m sorry you’re feeling unwell. To guide you safely, how many days have you had fever and headache, and do you know your temperature?";
  }

  if (hasFever) {
    return "I understand. How many days have you had fever, and do you know your temperature reading?";
  }

  if (hasHeadache) {
    return "I’m sorry you have a headache. How long has it been happening, and how severe is the pain from 1 to 10?";
  }

  if (hasCough || hasCold) {
    return "I understand. How many days have you had cough or cold symptoms, and do you also have fever or breathing difficulty?";
  }

  if (hasStomachPain || hasVomiting) {
    return "I’m sorry you’re feeling this. How long has the stomach problem been happening, and is the pain mild, moderate, or severe?";
  }

  if (hasPain) {
    return "I understand. Where exactly is the pain, how long has it been happening, and how severe is it from 1 to 10?";
  }

  return null;
}

function serviceIntentReply(message) {
  const text = message.toLowerCase();

  if (
    text.includes("book doctor") ||
    text.includes("book a doctor") ||
    text.includes("book appointment") ||
    text.includes("doctor appointment") ||
    text.includes("consult doctor") ||
    text.includes("see doctor")
  ) {
    return "Sure, I can help you book a doctor consultation. Please click the button below and share your symptoms with the doctor. [BOOK_DOCTOR]";
  }

  if (
    text.includes("lab test") ||
    text.includes("blood test") ||
    text.includes("order test") ||
    text.includes("diagnostic test")
  ) {
    return "I can guide you to the lab test section. Please remember that a doctor should suggest the correct test based on your symptoms. [ORDER_LAB]";
  }

  if (
    text.includes("buy medicine") ||
    text.includes("order medicine") ||
    text.includes("pharmacy") ||
    text.includes("medicine")
  ) {
    return "I can guide you to the pharmacy section. Please avoid starting new medicines without advice from a qualified doctor. [BUY_MEDICINE]";
  }

  return null;
}
function detectAssessmentType(message) {
  const text = message.toLowerCase();

  if (
    (text.includes("fever") || text.includes("temperature")) &&
    (text.includes("headache") || text.includes("head pain"))
  ) {
    return "fever_headache";
  }

  if (text.includes("fever") || text.includes("temperature")) {
    return "fever";
  }

  if (text.includes("headache") || text.includes("head pain")) {
    return "headache";
  }

  if (text.includes("cough") || text.includes("cold") || text.includes("runny nose")) {
    return "cough_cold";
  }

  if (
    text.includes("sore throat") ||
    text.includes("throat pain") ||
    text.includes("throat infection")
  ) {
    return "sore_throat";
  }

  if (
    text.includes("stomach pain") ||
    text.includes("abdominal pain") ||
    text.includes("loose motion") ||
    text.includes("diarrhea") ||
    text.includes("vomit") ||
    text.includes("vomiting") ||
    text.includes("nausea")
  ) {
    return "stomach";
  }

  if (
    text.includes("burning urine") ||
    text.includes("burning while urinating") ||
    text.includes("urine pain") ||
    text.includes("frequent urination") ||
    text.includes("uti")
  ) {
    return "urinary";
  }

  if (
    text.includes("rash") ||
    text.includes("itching") ||
    text.includes("skin allergy") ||
    text.includes("red spots")
  ) {
    return "skin";
  }

  if (
    text.includes("dizzy") ||
    text.includes("dizziness") ||
    text.includes("lightheaded")
  ) {
    return "dizziness";
  }

  if (
    text.includes("weakness") ||
    text.includes("tired") ||
    text.includes("fatigue") ||
    text.includes("low energy")
  ) {
    return "weakness";
  }

  if (text.includes("back pain")) {
    return "back_pain";
  }

  if (text.includes("body pain") || text.includes("body ache")) {
    return "body_pain";
  }

  if (text.includes("pain") || text.includes("ache")) {
    return "pain";
  }

  return null;
}

function extractAge(message) {
  const match = message.match(/\b(\d{1,3})\b/);
  if (!match) return null;

  const age = Number(match[1]);

  if (age >= 1 && age <= 120) {
    return age;
  }

  return null;
}

function extractSex(message) {
  const text = message.toLowerCase();

  if (
    text.includes("female") ||
    text.includes("woman") ||
    text.includes("girl")
  ) {
    return "female";
  }

  if (
    text.includes("male") ||
    text.includes("man") ||
    text.includes("boy")
  ) {
    return "male";
  }

  if (
    text.includes("prefer not") ||
    text.includes("rather not") ||
    text.includes("skip")
  ) {
    return "not specified";
  }

  return null;
}

function extractDurationDays(message) {
  const text = message.toLowerCase();

  if (text.includes("today")) return 1;
  if (text.includes("yesterday")) return 1;
  if (text.includes("few hours")) return 1;

  const dayMatch = text.match(/(\d+)\s*(day|days)/);
  if (dayMatch) return Number(dayMatch[1]);

  const weekMatch = text.match(/(\d+)\s*(week|weeks)/);
  if (weekMatch) return Number(weekMatch[1]) * 7;

  const hourMatch = text.match(/(\d+)\s*(hour|hours)/);
  if (hourMatch) return 1;

  return null;
}

function extractSeverity(message) {
  const text = message.toLowerCase();

  if (text.includes("mild")) return 2;
  if (text.includes("moderate")) return 5;
  if (text.includes("severe")) return 8;
  if (text.includes("very painful")) return 8;

  const scoreMatch = text.match(/\b(10|[1-9])\b/);
  if (scoreMatch) {
    const score = Number(scoreMatch[1]);
    if (score >= 1 && score <= 10) {
      return score;
    }
  }

  return null;
}

function extractTemperatureF(message) {
  const text = message.toLowerCase();

  const matches = text.match(/\b(9[5-9]|10[0-6])(\.\d+)?\b/g);
  if (!matches) return null;

  const temps = matches
    .map(Number)
    .filter(temp => temp >= 95 && temp <= 106);

  return temps.length ? temps[0] : null;
}

function extractRedFlags(message) {
  const text = message.toLowerCase();
  const flags = [];

  if (text.includes("breathing difficulty") || text.includes("difficulty breathing") || text.includes("can't breathe") || text.includes("cannot breathe")) {
    flags.push("breathing difficulty");
  }

  if (text.includes("blood") || text.includes("black stool") || text.includes("bloody vomit")) {
    flags.push("bleeding/blood symptom");
  }

  if (text.includes("faint") || text.includes("fainted") || text.includes("unconscious")) {
    flags.push("fainting/unconsciousness");
  }

  if (text.includes("confusion") || text.includes("confused")) {
    flags.push("confusion");
  }

  if (text.includes("stiff neck") && text.includes("fever")) {
    flags.push("fever with stiff neck");
  }

  if (text.includes("dehydration") || text.includes("not urinating") || text.includes("very weak")) {
    flags.push("possible dehydration/severe weakness");
  }

  return flags;
}

function getDurationQuestion(type) {
  if (type === "fever" || type === "fever_headache") {
    return "How many days have the symptoms been happening? Also mention temperature if you know it, like 101°F.";
  }

  if (type === "cough_cold") {
    return "How many days have you had cough/cold symptoms? Also mention if you have fever or breathing difficulty.";
  }

  if (type === "stomach") {
    return "How many days has the stomach problem been happening? Also mention vomiting, loose motion, or blood if present.";
  }

  if (type === "urinary") {
    return "How many days has this urine-related problem been happening? Also mention fever, back pain, or blood in urine if present.";
  }

  if (type === "skin") {
    return "How many days has the skin issue been happening? Also mention swelling, spreading rash, or breathing difficulty if present.";
  }

  if (type === "dizziness" || type === "weakness") {
    return "How long has this been happening? Also mention fainting, confusion, or severe weakness if present.";
  }

  return "How many days have the symptoms been happening?";
}

function getSelfCareAdvice(type) {
  if (type === "fever" || type === "fever_headache") {
    return "Rest, drink enough fluids, monitor your temperature, and avoid overexertion.";
  }

  if (type === "headache") {
    return "Rest in a quiet place, drink water, avoid screen strain, and monitor if the pain increases.";
  }

  if (type === "cough_cold") {
    return "Drink warm fluids, rest, avoid cold drinks, and monitor for fever or breathing difficulty.";
  }

  if (type === "sore_throat") {
    return "Drink warm fluids, avoid spicy/cold foods, and rest your voice.";
  }

  if (type === "stomach") {
    return "Drink fluids, eat light food, and avoid oily or spicy food for now.";
  }

  if (type === "urinary") {
    return "Drink enough water and monitor symptoms. If burning, fever, or pain continues, consult a doctor.";
  }

  if (type === "skin") {
    return "Avoid scratching, keep the area clean, and avoid applying unknown creams or home remedies.";
  }

  if (type === "dizziness") {
    return "Sit or lie down, drink water, and avoid sudden standing.";
  }

  if (type === "weakness") {
    return "Rest, hydrate, eat light nutritious food, and monitor your energy level.";
  }

  if (type === "back_pain" || type === "body_pain" || type === "pain") {
    return "Rest the affected area, avoid heavy activity, and monitor if the pain worsens.";
  }

  return "Rest, hydrate, and monitor your symptoms.";
}

function finishStructuredAssessment(session) {
  const assessment = session.assessment;

  const age = assessment.age;
  const sex = assessment.sex;
  const durationDays = assessment.durationDays;
  const severity = assessment.severity;
  const temperatureF = assessment.temperatureF;
  const type = assessment.type;
  const redFlags = assessment.redFlags || [];

  const hasHighFever = temperatureF && temperatureF >= 102;
  const hasManyDays = durationDays && durationDays >= 3;
  const hasSevereSymptoms = severity && severity >= 8;
  const hasRedFlags = redFlags.length > 0;

  session.assessment = null;

  if (hasRedFlags) {
    return {
      reply:
        `Thanks. I noted age ${age}, sex ${sex}, duration ${durationDays} day(s), and severity ${severity}/10. You also mentioned: ${redFlags.join(", ")}. This may need urgent medical attention. Please consult a doctor immediately. [BOOK_DOCTOR]`,
      provider: "details-flow",
      urgency: "urgent"
    };
  }

  if (hasHighFever || hasManyDays || hasSevereSymptoms) {
    return {
      reply:
        `Thanks. I noted age ${age}, sex ${sex}, duration ${durationDays} day(s), and severity ${severity}/10. Based on this, it would be safer to consult a doctor soon. I can help you book a doctor consultation. [BOOK_DOCTOR]`,
      provider: "details-flow",
      urgency: "consult-soon"
    };
  }

  const advice = getSelfCareAdvice(type);

  return {
    reply:
      `Thanks. I noted age ${age}, sex ${sex}, duration ${durationDays} day(s), and severity ${severity}/10. This sounds mild for now. ${advice} If it worsens, lasts more than 2–3 days, or you feel very weak, consult a doctor.`,
    provider: "details-flow",
    urgency: "self-care"
  };
}

function runPatientDetailsFlow(session, message) {
  const type = detectAssessmentType(message);

  if (!session.assessment && !type) {
    return null;
  }

  if (!session.assessment && type) {
    session.assessment = {
      type,
      originalSymptom: message,
      age: null,
      sex: null,
      durationDays: null,
      severity: null,
      temperatureF: null,
      redFlags: extractRedFlags(message),
      step: "collect_age"
    };

    return {
      reply:
        "I’ll guide you step by step. First, what is the patient’s age?",
      provider: "details-flow",
      urgency: "collecting-info"
    };
  }

  const assessment = session.assessment;

  if (assessment.step === "collect_age") {
    const age = extractAge(message);

    if (!age) {
      return {
        reply:
          "Please enter the patient’s age as a number. Example: 20",
        provider: "details-flow",
        urgency: "collecting-info"
      };
    }

    assessment.age = age;
    assessment.step = "collect_sex";

    return {
      reply:
        "Thank you. What is the patient’s biological sex for symptom assessment? Please reply male, female, or prefer not to say.",
      provider: "details-flow",
      urgency: "collecting-info"
    };
  }

  if (assessment.step === "collect_sex") {
    const sex = extractSex(message);

    if (!sex) {
      return {
        reply:
          "Please reply with male, female, or prefer not to say.",
        provider: "details-flow",
        urgency: "collecting-info"
      };
    }

    assessment.sex = sex;
    assessment.step = "collect_duration";

    return {
      reply: getDurationQuestion(assessment.type),
      provider: "details-flow",
      urgency: "collecting-info"
    };
  }

  if (assessment.step === "collect_duration") {
    const durationDays = extractDurationDays(message);
    const temperatureF = extractTemperatureF(message);
    assessment.redFlags.push(...extractRedFlags(message));

    if (!durationDays) {
      return {
        reply:
          "Please tell me the duration clearly. Example: 1 day, 3 days, or 1 week.",
        provider: "details-flow",
        urgency: "collecting-info"
      };
    }

    assessment.durationDays = durationDays;

    if (temperatureF) {
      assessment.temperatureF = temperatureF;
    }

    assessment.step = "collect_severity";

    return {
      reply:
        "How severe does it feel from 1 to 10? 1 means very mild and 10 means very severe.",
      provider: "details-flow",
      urgency: "collecting-info"
    };
  }

  if (assessment.step === "collect_severity") {
    const severity = extractSeverity(message);
    assessment.redFlags.push(...extractRedFlags(message));

    if (!severity) {
      return {
        reply:
          "Please rate the severity from 1 to 10. Example: 3 for mild, 5 for moderate, 8 for severe.",
        provider: "details-flow",
        urgency: "collecting-info"
      };
    }

    assessment.severity = severity;

    return finishStructuredAssessment(session);
  }

  return null;
}





function infermedicaEnabled() {
  return hasValue(process.env.INFERMEDICA_APP_ID) && hasValue(process.env.INFERMEDICA_APP_KEY);
}

function ensureInfermedicaSession(session) {
  if (!session.infermedica) {
    session.infermedica = {
      interviewId: crypto.randomUUID(),
      patient: {},
      evidence: [],
      lastQuestion: null,
      pendingComplaint: null,
      lastMentions: []
    };
  }
  return session.infermedica;
}

function updatePatientInfoFromText(session, message) {
  const info = ensureInfermedicaSession(session);
  const text = message.toLowerCase();

  if (!info.patient.age) {
    const ageMatch = text.match(/\b(\d{1,3})\b/);
    if (ageMatch) {
      const age = Number(ageMatch[1]);
      if (age >= 1 && age <= 130) info.patient.age = age;
    }
  }

  if (!info.patient.sex) {
    if (/\b(female|woman|girl)\b/.test(text)) info.patient.sex = "female";
    if (/\b(male|man|boy)\b/.test(text)) info.patient.sex = "male";
  }
}

function looksLikeHealthComplaint(message) {
  const text = message.toLowerCase();
  const keywords = [
    "fever", "headache", "pain", "cough", "cold", "vomit", "vomiting", "loose motion", "diarrhea",
    "stomach", "throat", "rash", "dizzy", "weak", "tired", "nausea", "burning", "swelling"
  ];
  return keywords.some(word => text.includes(word));
}

function infermedicaHeaders(session) {
  const info = ensureInfermedicaSession(session);
  return {
    "App-Id": process.env.INFERMEDICA_APP_ID,
    "App-Key": process.env.INFERMEDICA_APP_KEY,
    "Content-Type": "application/json",
    "Interview-Id": info.interviewId,
    "Dev-Mode": process.env.INFERMEDICA_DEV_MODE || "true"
  };
}

function upsertEvidence(session, item) {
  const info = ensureInfermedicaSession(session);
  const cleanItem = {
    id: item.id,
    choice_id: item.choice_id || "present"
  };

  if (item.source) cleanItem.source = item.source;

  const existingIndex = info.evidence.findIndex(e => e.id === cleanItem.id);
  if (existingIndex >= 0) {
    info.evidence[existingIndex] = { ...info.evidence[existingIndex], ...cleanItem };
  } else {
    if (info.evidence.length === 0 && !cleanItem.source) cleanItem.source = "initial";
    info.evidence.push(cleanItem);
  }
}

function choiceFromUserAnswer(message) {
  const text = message.toLowerCase().trim();
  if (/\b(don't know|dont know|not sure|unknown|skip)\b/.test(text)) return "unknown";
  if (/\b(yes|yep|yeah|present|i do|i have)\b/.test(text)) return "present";
  if (/\b(no|nope|absent|do not|don't|dont|not)\b/.test(text)) return "absent";
  return null;
}

function saveAnswerToInfermedicaQuestion(session, message) {
  const info = ensureInfermedicaSession(session);
  if (!info.lastQuestion) return false;

  const choice = choiceFromUserAnswer(message);
  if (!choice) return false;

  const items = info.lastQuestion.items || [];
  if (!items.length) return false;

  items.forEach(item => upsertEvidence(session, { id: item.id, choice_id: choice }));
  info.lastQuestion = null;
  return true;
}

async function infermedicaParse(message, session) {
  const info = ensureInfermedicaSession(session);

  const response = await axios.post(
    `${INFERMEDICA_BASE}/parse`,
    {
      text: message,
      age: { value: info.patient.age },
      sex: info.patient.sex,
      include_tokens: false,
      concept_types: ["symptom", "risk_factor"]
    },
    { headers: infermedicaHeaders(session), timeout: 15000 }
  );

  const mentions = response.data?.mentions || [];
  info.lastMentions = mentions;
  return mentions;
}

async function infermedicaDiagnosis(session) {
  const info = ensureInfermedicaSession(session);

  const response = await axios.post(
    `${INFERMEDICA_BASE}/diagnosis`,
    {
      sex: info.patient.sex,
      age: { value: info.patient.age },
      evidence: info.evidence,
      extras: { disable_groups: true }
    },
    { headers: infermedicaHeaders(session), timeout: 20000 }
  );

  return response.data;
}

async function infermedicaTriage(session) {
  const info = ensureInfermedicaSession(session);

  try {
    const response = await axios.post(
      `${INFERMEDICA_BASE}/triage`,
      {
        sex: info.patient.sex,
        age: { value: info.patient.age },
        evidence: info.evidence
      },
      { headers: infermedicaHeaders(session), timeout: 20000 }
    );

    return response.data;
  } catch (err) {
    console.warn("Infermedica triage unavailable:", err.message);
    return null;
  }
}

function formatInfermedicaQuestion(question) {
  if (!question || !question.items || question.items.length === 0) return null;
  return `To assess this safely, please answer this: ${question.text}\n\nReply with: yes, no, or don't know.`;
}

function formatInfermedicaResult(diagnosisData, triageData) {
  const triageLevel = triageData?.triage_level;

  if (triageLevel === "emergency_ambulance" || triageLevel === "emergency") {
    return {
      reply: "Infermedica triage marks this as urgent. Please seek emergency care now or call your local emergency number.",
      provider: "infermedica-triage",
      urgency: triageLevel,
      isEmergency: true
    };
  }

  if (triageLevel === "consultation_24" || triageLevel === "consultation") {
    return {
      reply: "Based on the structured symptom assessment, it would be safer to consult a doctor. I can help you book a consultation. [BOOK_DOCTOR]",
      provider: "infermedica-triage",
      urgency: triageLevel,
      isEmergency: false
    };
  }

  if (triageLevel === "self_care") {
    return {
      reply: "Based on the structured symptom assessment, this may be suitable for self-care for now. Rest, hydrate, and monitor symptoms. If symptoms worsen or new symptoms appear, consult a doctor.",
      provider: "infermedica-triage",
      urgency: triageLevel,
      isEmergency: false
    };
  }

  const questionText = formatInfermedicaQuestion(diagnosisData?.question);
  if (questionText) {
    return {
      reply: questionText,
      provider: "infermedica-diagnosis",
      urgency: "assessing",
      isEmergency: false,
      question: diagnosisData.question
    };
  }

  return {
    reply: "I have captured your symptoms. If they are worsening, severe, or lasting more than 2–3 days, it would be safer to consult a doctor. [BOOK_DOCTOR]",
    provider: "infermedica-diagnosis",
    urgency: "consultation",
    isEmergency: false
  };
}

async function runInfermedicaAssessment(session, message) {
  if (!infermedicaEnabled()) return null;

  const info = ensureInfermedicaSession(session);
  updatePatientInfoFromText(session, message);

  const hasPendingComplaint = Boolean(info.pendingComplaint);
  const isAnswerToQuestion = Boolean(info.lastQuestion);
  const isComplaint = looksLikeHealthComplaint(message);

  if (!hasPendingComplaint && !isAnswerToQuestion && !isComplaint) return null;

  if ((!info.patient.age || !info.patient.sex) && (isComplaint || hasPendingComplaint)) {
    if (isComplaint) info.pendingComplaint = message;
    return {
      reply: "Before I run the structured symptom assessment, please tell me the patient's age and biological sex. Example: 20 female or 35 male.",
      provider: "infermedica-intake",
      urgency: "not-assessed",
      isEmergency: false,
      symptoms_detected: []
    };
  }

  try {
    if (isAnswerToQuestion) {
      const saved = saveAnswerToInfermedicaQuestion(session, message);
      if (!saved) return null;

      const diagnosisData = await infermedicaDiagnosis(session);
      const triageData = diagnosisData?.should_stop ? await infermedicaTriage(session) : null;
      const formatted = formatInfermedicaResult(diagnosisData, triageData);

      if (formatted.question) info.lastQuestion = formatted.question;
      return { ...formatted, symptoms_detected: info.lastMentions || [] };
    }

    const complaint = info.pendingComplaint || message;
    const mentions = await infermedicaParse(complaint, session);
    info.pendingComplaint = null;

    const validMentions = mentions.filter(m => m.id && m.choice_id && ["symptom", "risk_factor"].includes(m.type));
    if (validMentions.length === 0) return null;

    validMentions.forEach(m => upsertEvidence(session, {
      id: m.id,
      choice_id: m.choice_id,
      source: info.evidence.length === 0 ? "initial" : undefined
    }));

    const diagnosisData = await infermedicaDiagnosis(session);
    const triageData = diagnosisData?.should_stop ? await infermedicaTriage(session) : null;
    const formatted = formatInfermedicaResult(diagnosisData, triageData);

    if (formatted.question) info.lastQuestion = formatted.question;
    return { ...formatted, symptoms_detected: validMentions };
  } catch (err) {
    console.warn("Infermedica unavailable:", err.response?.data || err.message);
    return null;
  }
}

async function callAnthropic(history) {
  if (!hasValue(process.env.ANTHROPIC_API_KEY)) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-20241022";

  const response = await client.messages.create({
    model,
    max_tokens: 512,
    system: AVA_SYSTEM_PROMPT,
    messages: history
  });

  return response.content?.[0]?.text || "I’m here. Could you tell me more about your symptoms?";
}

function ollamaEnabled() {
  // Ollama runs only on your laptop by default. On Vercel, skip it unless you provide a remote Ollama URL.
  if (process.env.VERCEL && !hasValue(process.env.OLLAMA_BASE_URL)) {
    return false;
  }
  return true;
}

async function callOllama(history) {
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = process.env.OLLAMA_MODEL || "qwen2.5:0.5b";

  const response = await axios.post(
    `${baseUrl}/api/chat`,
    {
      model,
      stream: false,
      messages: [
        { role: "system", content: AVA_SYSTEM_PROMPT },
        ...history
      ],
      options: {
        temperature: 0.2,
        num_predict: 180
      }
    },
    { timeout: 120000 }
  );

  return response.data?.message?.content || "I’m here. Could you tell me more about your symptoms?";
}

async function generateAvaReply(history, latestMessage, session) {
  const errors = [];

  // 1. First check if user wants CareGuruPlus services
  const serviceReply = serviceIntentReply(latestMessage);
  if (serviceReply) {
    return {
      reply: serviceReply,
      provider: "service-flow",
      urgency: "service-request"
    };
  }

  // 2. Then collect age, sex, duration, severity properly
  const patientDetailsReply = runPatientDetailsFlow(session, latestMessage);
  if (patientDetailsReply) {
    return patientDetailsReply;
  }

  // 3. Then use your older guided flow if needed
  const guidedReply = guidedSymptomReply(latestMessage);
  if (guidedReply) {
    return {
      reply: guidedReply,
      provider: "guided-flow",
      urgency: "collecting-info"
    };
  }

  // 4. Then use Anthropic, only if key is present
  if (hasValue(process.env.ANTHROPIC_API_KEY)) {
    try {
      return {
        reply: await callAnthropic(history),
        provider: "anthropic",
        urgency: "not-assessed"
      };
    } catch (err) {
      errors.push(`Anthropic: ${err.message}`);
      console.warn("Anthropic unavailable:", err.message);
    }
  }

  // 5. Then use local free Ollama. This is skipped on Vercel unless OLLAMA_BASE_URL is set.
  if (ollamaEnabled()) {
    try {
      return {
        reply: await callOllama(history),
        provider: "ollama",
        urgency: "not-assessed"
      };
    } catch (err) {
      errors.push(`Ollama: ${err.message}`);
      console.warn("Ollama unavailable:", err.message);
    }
  }

  // 6. Last fallback
  return {
    reply: simpleFallbackReply(latestMessage),
    provider: "fallback",
    urgency: "not-assessed",
    errors
  };
}

router.post("/", async (req, res) => {
  const { message, session_id, user_info, consent } = req.body;
  const consentGiven = consent === true || consent === "true";

  if (!message || !session_id) {
    return res.status(400).json({ error: "message and session_id are required" });
  }

  if (!sessions[session_id]) {
    sessions[session_id] = {
      history: [],
      user_info: user_info || {},
      assessment: null,
      consent: consentGiven
    };
  }

  const session = sessions[session_id];
  session.consent = consentGiven;
  session.history.push({ role: "user", content: message });

  try {
    const result = await generateAvaReply(session.history, message, session);

    const { cleanReply, actions } = addActionButtons(result.reply);
    const finalReply = cleanReply + DISCLAIMER;

    session.history.push({ role: "assistant", content: cleanReply });

    saveChatLog({
      session_id,
      userMessage: message,
      avaReply: cleanReply,
      provider: result.provider,
      urgency: result.urgency || "not-assessed",
      actions,
      consent: consentGiven
    });

    if (session.history.length > 20) {
      session.history = session.history.slice(-20);
    }

    return res.json({
      reply: finalReply,
      actions,
      symptoms_detected: result.symptoms_detected || [],
      urgency: result.urgency || "not-assessed",
      isEmergency: result.isEmergency || false,
      provider: result.provider
    });
  } catch (err) {
    console.error("Chat error:", err.message);
    return res.status(500).json({
      error: "Ava is temporarily unavailable. Please try again.",
      detail: process.env.NODE_ENV === "production" ? undefined : err.message
    });
  }
});

module.exports = router;
