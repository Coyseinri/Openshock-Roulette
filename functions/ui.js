function log(msg) {
  const el = document.getElementById("log");
  if (!el) return;
  el.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n` + el.textContent;
}

function setMainResult(text, mode = "") {
  if (!mainResult) return;
  mainResult.textContent = text;
  mainResult.className = `bigResult ${mode || ""}`.trim();
}

function clearElement(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = Boolean(hidden);
}

function showEventResult(message) {
  if (!eventResult) return;
  eventResult.textContent = message || "";
}

function clearEventOptions() {
  clearElement(eventOptions);
}

function hideEventOverlay() {
  if (!eventOverlay) return;
  eventOverlay.hidden = true;
  clearEventOptions();
  showEventResult("");
  if (eventContinueBtn) eventContinueBtn.hidden = true;
}

function showEventOverlay(card, pickerLine = "Event card active") {
  if (!eventOverlay) return;
  if (eventTitle) eventTitle.textContent = card?.title || "Event Card";
  if (eventDescription) eventDescription.textContent = card?.description || "A round modifier has appeared.";
  if (eventPickerLine) eventPickerLine.textContent = pickerLine;
  clearEventOptions();
  showEventResult("");
  if (eventContinueBtn) eventContinueBtn.hidden = true;
  eventOverlay.hidden = false;
}

function updateEventCardPanel(card) {
  const panel = document.getElementById("eventCardPanel");
  const title = document.getElementById("eventCardTitle");
  const description = document.getElementById("eventCardDescription");
  if (!panel || !title || !description) return;

  if (!card) {
    panel.classList.add("none");
    title.textContent = "No Event Card";
    description.textContent = "Waiting for the next event roll...";
    return;
  }

  panel.classList.remove("none");
  title.textContent = card.title || "Event Card";
  description.textContent = card.description || "A round modifier has appeared.";
}

function clearActiveEventCardPanel() {
  updateEventCardPanel(null);
}

function waitForEventContinue(timeoutMs = 0) {
  return new Promise(resolve => {
    if (!eventContinueBtn) return resolve();

    let resolved = false;
    let timer = null;
    const finish = () => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      eventContinueBtn.onclick = null;
      eventContinueBtn.hidden = true;
      resolve();
    };

    eventContinueBtn.hidden = false;
    eventContinueBtn.onclick = finish;

    if (Number(timeoutMs || 0) > 0) {
      timer = setTimeout(finish, Number(timeoutMs));
    }
  });
}

function choiceButtons(options, onPick) {
  clearEventOptions();
  if (!eventOptions) return;

  (options || []).forEach(option => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = option.label || option.name || String(option.value || "Choose");
    button.onclick = () => onPick(option);
    eventOptions.appendChild(button);
  });
}
