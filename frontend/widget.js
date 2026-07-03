// Ava Widget — CareGuruPlus
// For production, set window.AVA_API_URL before loading this file.

(function () {
  const API_URL = window.AVA_API_URL || "http://localhost:3000/chat";
  const SESSION_ID = "session_" + Math.random().toString(36).slice(2);

  if (!document.querySelector('link[href="widget.css"]')) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "widget.css";
    document.head.appendChild(link);
  }

  document.body.insertAdjacentHTML("beforeend", `
    <button id="ava-launcher" aria-label="Open Ava Health Assistant">💬</button>
    <div id="ava-window" class="hidden" role="dialog" aria-label="Ava Health Assistant">
      <div id="ava-header">
        <div id="ava-avatar">A</div>
        <div id="ava-header-info">
          <p class="name">Ava</p>
          <p class="status">CareGuruPlus Health Assistant</p>
        </div>
      </div>
      <div id="ava-disclaimer">
        ⚠️ General health information only, not a diagnosis. For emergencies call your local emergency number.
      </div>
      <div id="ava-messages" aria-live="polite"></div>
      <div id="ava-consent-row" class="ava-consent">
        <input type="checkbox" id="avaConsent" />
        <label for="avaConsent">I agree to allow anonymized chat logging to improve Ava.</label>
      </div>
      <div id="ava-input-row">
        <input id="ava-input" type="text" placeholder="Describe your symptoms..." autocomplete="off" />
        <button id="ava-send" aria-label="Send">➤</button>
      </div>
    </div>
  `);

  const launcher = document.getElementById("ava-launcher");
  const window_ = document.getElementById("ava-window");
  const messages = document.getElementById("ava-messages");
  const input = document.getElementById("ava-input");
  const sendBtn = document.getElementById("ava-send");
  const consentRow = document.getElementById("ava-consent-row");
  const consentBox = document.getElementById("avaConsent");

  consentRow.addEventListener("click", e => e.stopPropagation());
  consentRow.addEventListener("keydown", e => e.stopPropagation());

  let isOpen = false;
  let busy = false;

  launcher.addEventListener("click", () => {
    isOpen = !isOpen;
    window_.classList.toggle("hidden", !isOpen);
    if (isOpen && messages.children.length === 0) {
      addBotMessage("👋 Hi! I'm **Ava**, your health assistant from CareGuruPlus.\n\nHow are you feeling today? Tell me about your symptoms and I'll guide you.");
    }
    if (isOpen) input.focus();
  });

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendMessage();
    }
  });

  function sendMessage() {
    const text = input.value.trim();
    if (!text || busy) return;

    addUserMessage(text);
    input.value = "";
    showTyping();
    callApi(text);
  }

  async function callApi(message) {
    busy = true;
    sendBtn.disabled = true;

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          session_id: SESSION_ID,
          consent: consentBox ? consentBox.checked : false
        })
      });

      const data = await res.json().catch(() => ({}));
      removeTyping();

      if (!res.ok || data.error) {
        addBotMessage(data.error || "Ava is having trouble connecting. Please try again shortly.");
        return;
      }

      addBotMessage(data.reply, data.actions || [], data.isEmergency);
    } catch (err) {
      removeTyping();
      addBotMessage("Connection error. Please check that the backend is running on http://localhost:3000.");
    } finally {
      busy = false;
      sendBtn.disabled = false;
      input.focus();
    }
  }

  function addUserMessage(text) {
    const div = document.createElement("div");
    div.className = "ava-bubble user";
    div.textContent = text;
    messages.appendChild(div);
    scrollBottom();
  }

  function addBotMessage(text, actions = [], isEmergency = false) {
    const div = document.createElement("div");
    div.className = "ava-bubble bot" + (isEmergency ? " emergency" : "");
    div.innerHTML = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>")
      .replace(/\n/g, "<br>");
    messages.appendChild(div);

    if (actions.length) {
      const actDiv = document.createElement("div");
      actDiv.className = "ava-actions";
      actions.forEach(a => {
        const btn = document.createElement("a");
        btn.className = "ava-action-btn";
        btn.textContent = a.label;
        btn.href = a.url;
        btn.target = "_blank";
        btn.rel = "noopener noreferrer";
        actDiv.appendChild(btn);
      });
      messages.appendChild(actDiv);
    }

    scrollBottom();
  }

  function showTyping() {
    const div = document.createElement("div");
    div.className = "ava-typing";
    div.id = "ava-typing-indicator";
    div.innerHTML = "<span></span><span></span><span></span>";
    messages.appendChild(div);
    scrollBottom();
  }

  function removeTyping() {
    const t = document.getElementById("ava-typing-indicator");
    if (t) t.remove();
  }

  function scrollBottom() {
    messages.scrollTop = messages.scrollHeight;
  }
})();
