// safetyFilter.js — Emergency keyword detection
// Must run BEFORE any AI/Infermedica call

const RED_FLAG_KEYWORDS = [
  "chest pain", "heart attack", "can't breathe", "cannot breathe",
  "difficulty breathing", "shortness of breath", "severe bleeding",
  "not stop bleeding", "stroke", "face drooping", "arm weakness",
  "speech difficulty", "suicidal", "want to die", "kill myself",
  "overdose", "unconscious", "not responding", "seizure",
  "severe head injury", "poisoning"
];

const EMERGENCY_RESPONSE = {
  reply: `🚨 *This sounds like a medical emergency.*\n\nPlease **call emergency services immediately**:\n\n• 🇮🇳 India: **112** or **108** (ambulance)\n• 🇱🇰 Sri Lanka: **1990**\n• 🇦🇪 UAE: **998**\n• 🇳🇵 Nepal: **102**\n\nDo not wait — go to your nearest emergency room or call for help now.\n\n*Ava is not able to assist with emergencies. Please seek immediate professional help.*`,
  urgency: "EMERGENCY",
  isEmergency: true
};

function safetyFilter(req, res, next) {
  const message = (req.body.message || "").toLowerCase();
  const triggered = RED_FLAG_KEYWORDS.find(kw => message.includes(kw));

  if (triggered) {
    return res.json(EMERGENCY_RESPONSE);
  }
  next();
}

module.exports = { safetyFilter, EMERGENCY_RESPONSE };