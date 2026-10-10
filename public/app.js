import { mode } from "./runtime-config.js";

const demo = mode === "demo";
const $ = (selector) => document.querySelector(selector);
const names = { ollama: "Ollama", claude: "Claude", openai: "OpenAI", gemini: "Gemini" };
const icons = { ollama: "⌂", claude: "✳", openai: "◎", gemini: "✧" };
const messages = $("#messages");
const empty = $("#empty").cloneNode(true);
const input = $("#message");
const send = $("#send");
let status;
let selected;
let busy = false;

$("#mode").textContent = demo ? "互動示範" : "本機限定";
$("#intro-text").textContent = "由一個主模型帶隊，整合不同觀點。清楚選擇資料的去向，專心處理眼前的任務。";
$("#mode-title").textContent = demo ? "先試操作，再連接自己的模型" : "這是你電腦上的工作台";
$("#mode-description").textContent = demo
  ? "此示範只顯示預設範例回覆，不會連接任何模型、傳送輸入內容或讀取你的電腦。"
  : "這個網址只供這部電腦使用。雲端模型會接收送出的內容；私人資料請使用本機模型。";
$("#privacy-note").textContent = demo
  ? "示範內容只留在此分頁，重新載入即清除。不會傳送提問。"
  : "畫面只保留在此分頁；模型供應商可能保留請求。生成的圖片會儲存在本機。";
$("#provider-note").textContent = demo ? "範例模型，全部使用預設回覆。" : "「已設定」不代表服務已連線。";
$("#refresh").hidden = demo;

function updateControls() {
  send.disabled = busy || !selected || !status;
  send.textContent = busy ? "處理中…" : demo ? "查看示範回覆 ↗" : "開始協作 ↗";
  $("#clear").disabled = busy;
  $("#refresh").disabled = busy;
  input.disabled = busy;
  $("#form").setAttribute("aria-busy", String(busy));
  for (const button of document.querySelectorAll(".provider")) button.disabled = busy || !status?.[button.dataset.provider];
}

function drawProviders() {
  $("#providers").replaceChildren();
  for (const id of Object.keys(names)) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "provider";
    button.dataset.provider = id;
    button.setAttribute("aria-pressed", String(selected === id));
    const icon = document.createElement("span");
    icon.className = "provider-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = icons[id];
    const text = document.createElement("span");
    for (const [className, value] of [
      ["provider-name", names[id]],
      ["provider-model", status?.models?.[id] || "未取得設定"],
      ["provider-state", demo ? "示範" : `${id === "ollama" ? "本機" : "雲端"} · ${status?.[id] ? "已設定" : "未設定"}`],
    ]) {
      const line = document.createElement("span");
      line.className = className;
      line.textContent = value;
      text.append(line);
    }
    button.append(icon, text);
    button.addEventListener("click", () => { selected = id; drawProviders(); });
    $("#providers").append(button);
  }
  updateControls();
}

async function loadStatus() {
  $("#refresh").disabled = true;
  $("#connection").textContent = "正在讀取設定…";
  try {
    if (demo) {
      status = { ollama: true, claude: true, openai: true, gemini: true, models: { ollama: "Local model", claude: "Cloud model", openai: "Cloud model", gemini: "Cloud model" } };
    } else {
      const response = await fetch("./api/status", { cache: "no-store", signal: AbortSignal.timeout(5000) });
      const data = await response.json();
      if (!response.ok || data.apiVersion !== 1 || data.mode !== "local") throw new Error();
      status = data;
    }
    if (!status[selected]) selected = Object.keys(names).find((id) => status[id]);
    $("#connection").textContent = demo ? "示範模式 · 不使用 API，也不產生模型費用。" : selected ? "本機工作台已連接。選擇模型後可送出任務。" : "尚未設定模型。請依安裝說明完成設定，再重新檢查。";
  } catch {
    status = undefined;
    selected = undefined;
    $("#connection").textContent = "無法連接本機工作台。請確認 pnpm start 仍在執行，再按「重新檢查」。";
  }
  drawProviders();
}

function addMessage(role, text, data = {}) {
  $("#empty")?.remove();
  const article = document.createElement("article");
  article.className = `message ${role}`;
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = data.label || (role === "user" ? "你" : "回覆");
  const content = document.createElement("div");
  content.className = "content";
  content.textContent = text;
  article.append(label, content);
  for (const artifact of Array.isArray(data.artifacts) ? data.artifacts : []) {
    if (demo || artifact.type !== "image" || !/^\/generated\/[0-9]+-[a-f0-9]{8}\.png$/.test(artifact.url)) continue;
    const image = document.createElement("img");
    image.className = "artifact";
    image.src = artifact.url;
    image.alt = "模型生成的圖片";
    image.loading = "lazy";
    article.append(image);
  }
  if (Array.isArray(data.trace) && data.trace.length) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = demo ? "範例協作紀錄" : "協作紀錄";
    const list = document.createElement("ul");
    for (const entry of data.trace) {
      const item = document.createElement("li");
      item.textContent = `${entry.provider}: ${entry.event}`;
      list.append(item);
    }
    details.append(summary, list);
    article.append(details);
  }
  if (role === "assistant") {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "text-button copy";
    copy.textContent = "複製回覆";
    copy.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(text); copy.textContent = "已複製"; }
      catch { copy.textContent = "請選取文字複製"; }
    });
    article.append(copy);
  }
  messages.append(article);
  messages.scrollTop = messages.scrollHeight;
}

const errorText = {
  400: "請檢查模型和提問內容。",
  403: "請求被安全規則拒絕。若內容含私人資料，請選擇本機 Ollama；也請從終端顯示的本機網址開啟。",
  409: "這個模型尚未設定。請更新本機 .env 並重新啟動工作台。",
  413: "提問太長，請縮短至 12,000 字以內。",
  429: "工作台仍在處理請求，或已達每分鐘上限。請稍候再送出。",
  502: "模型未能完成請求。請檢查模型名稱、本機服務、登入或 API 額度；系統沒有自動重試。",
};

$("#form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (busy || !selected || !status || !message || message.length > 12000) return;
  const provider = selected;
  busy = true;
  updateControls();
  $("#notice").textContent = demo ? "" : "模型正在處理。這可能需要幾分鐘；離開分頁不一定會停止已送出的請求。";
  addMessage("user", message);
  try {
    let data;
    if (demo) {
      data = {
        text: "這是一段預設示範，並非 AI 對你提問的實際答案。\n\n以開源筆記工具為例：\n• 快速擷取：一個入口記下靈感，減少操作。\n• 依專案整理：集中相關資料，但需要維護分類。\n• 全文搜尋：直接找回內容，先做好搜尋再增加複雜功能。\n\n建議先做擷取與搜尋，再用實際使用回饋決定分類方式。要處理自己的任務，請在電腦安裝並連接模型。",
        trace: [{ provider, event: "範例：整理需求" }, { provider, event: "範例：比較取捨" }],
      };
    } else {
      const response = await fetch("./api/chat", {
        method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Request": "console" },
        body: JSON.stringify({ provider, message }),
      });
      if (!response.ok) throw new Error(errorText[response.status] || "請求失敗，請確認本機工作台仍在執行。原提問保留在輸入框。");
      data = await response.json();
      if (typeof data.text !== "string") throw new Error("回覆格式無法讀取。請重新檢查本機工作台版本。");
    }
    addMessage("assistant", data.text, { ...data, label: `${names[provider]}${demo ? " · 示範回覆" : ""}` });
    input.value = "";
    $("#count").textContent = "0";
  } catch (error) {
    addMessage("error", error instanceof TypeError ? "連線中斷，請檢查本機工作台。原提問仍保留在輸入框。" : error.message, { label: "未完成" });
  } finally {
    busy = false;
    $("#notice").textContent = "";
    updateControls();
    input.focus();
  }
});

document.addEventListener("click", (event) => {
  const example = event.target.closest("[data-prompt]");
  if (!example || busy) return;
  input.value = example.dataset.prompt;
  input.dispatchEvent(new Event("input"));
  input.focus();
});
input.addEventListener("input", () => { $("#count").textContent = String(input.value.length); });
input.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && !event.isComposing) {
    event.preventDefault(); $("#form").requestSubmit();
  }
});
$("#clear").addEventListener("click", () => { if (!busy) messages.replaceChildren(empty.cloneNode(true)); });
$("#refresh").addEventListener("click", loadStatus);
loadStatus();
