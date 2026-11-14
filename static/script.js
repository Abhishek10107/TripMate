// =========================================================
// TRIPMATE AI — CLIENT CONTROLLER (v2.5 SaaS)
// State management, multi-agent stepper, auth, dashboard, and continuous refinement
// =========================================================

let currentThreadId = localStorage.getItem("travel_thread_id") || null;
let currentTripId = null;
let latestAnswerMarkdown = "";
let currentQuery = "";
let currentVersion = 1;
let waitingForApproval = false;
let currentUser = null;
let allTrips = [];
let progressInterval = null;

const AGENT_LABELS = {
  flight_agent: "✈️ Flight Specialist",
  hotel_agent: "🏨 Accommodations Agent",
  weather_agent: "🌦️ Weather Forecaster",
  budget_agent: "💰 Budget Analyst",
  itinerary_agent: "🗓️ Itinerary Architect"
};

const TICKER_MESSAGES = [
  "Supervisor checking constraints and routing specialist agents...",
  "Querying flight connection schedules and family fare availability...",
  "Scanning central Midtown and Brooklyn suites with kitchenettes...",
  "Evaluating seasonal temperatures and packing recommendations...",
  "Estimating 7-day MetroCard fares, airport transit, and daily meal costs...",
  "Balancing pacing for senior travelers (49 & 56 yrs) and toddler (3 yrs)...",
  "Structuring comprehensive day-by-day morning, midday, and evening schedule...",
  "Finalizing draft recommendations and preparing human review..."
];

// =========================================================
// INITIALIZATION
// =========================================================

document.addEventListener("DOMContentLoaded", () => {
  if (window.marked) {
    marked.setOptions({
      gfm: true,
      breaks: true,
      pedantic: false
    });
  }
  initTheme();
  checkAuthStatus();
  loadTripsCount();

  // If a thread was previously saved in localStorage, load it
  if (currentThreadId) {
    loadTripByThreadId(currentThreadId, false);
  }

  // Handle Ctrl+Enter to send
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "Enter") {
      const userInput = document.getElementById("userInput");
      const refineInput = document.getElementById("refineFeedback");
      if (document.activeElement === refineInput) {
        submitRefinement();
      } else if (document.activeElement === userInput) {
        sendMessage();
      }
    }
  });
});

// =========================================================
// THEME MANAGEMENT (NEUMORPHIC LIGHT & DARK)
// =========================================================

function initTheme() {
  const savedTheme = localStorage.getItem("tripmate_theme");
  const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  const initialTheme = savedTheme || (prefersLight ? "light" : "dark");
  applyTheme(initialTheme);
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("tripmate_theme", theme);

  const sunIcon = document.getElementById("sunIcon");
  const moonIcon = document.getElementById("moonIcon");
  const toggleBtn = document.getElementById("themeToggleBtn");

  if (theme === "light") {
    // In light mode, show moon icon to allow switching to dark
    if (sunIcon) sunIcon.classList.add("hidden");
    if (moonIcon) moonIcon.classList.remove("hidden");
    if (toggleBtn) toggleBtn.setAttribute("title", "Switch to Dark Mode");
  } else {
    // In dark mode, show sun icon to allow switching to light
    if (moonIcon) moonIcon.classList.add("hidden");
    if (sunIcon) sunIcon.classList.remove("hidden");
    if (toggleBtn) toggleBtn.setAttribute("title", "Switch to Light Mode");
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute("data-theme") || "dark";
  const newTheme = currentTheme === "light" ? "dark" : "light";
  applyTheme(newTheme);
  // showToast(`Switched to ${newTheme === "light" ? "Light" : "Dark"} Neumorphic Theme`);
}

// =========================================================
// NAVIGATION & VIEW SWITCHING
// =========================================================

function switchView(viewName) {
  const views = {
    landing: document.getElementById("viewLanding"),
    planner: document.getElementById("viewPlanner"),
    dashboard: document.getElementById("viewDashboard")
  };

  const navLinks = {
    landing: document.getElementById("navLinkLanding"),
    planner: document.getElementById("navLinkPlanner"),
    dashboard: document.getElementById("navLinkDashboard")
  };

  // Hide all views, deactivate all links
  Object.keys(views).forEach((key) => {
    if (views[key]) views[key].classList.add("hidden");
    if (navLinks[key]) navLinks[key].classList.remove("active");
  });

  // Activate selected
  if (views[viewName]) {
    views[viewName].classList.remove("hidden");
  }
  if (navLinks[viewName]) {
    navLinks[viewName].classList.add("active");
  }

  window.scrollTo({ top: 0, behavior: "smooth" });

  if (viewName === "dashboard") {
    loadDashboardTrips();
  }
}

// =========================================================
// AUTHENTICATION
// =========================================================

async function checkAuthStatus() {
  try {
    const res = await fetch("/api/auth/me", {
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (data.authenticated && data.user) {
      currentUser = data.user;
      renderAuthenticatedState(currentUser);
    } else {
      currentUser = null;
      renderGuestState();
    }
  } catch (err) {
    console.warn("Could not verify auth status:", err);
    renderGuestState();
  }
}

function getAuthHeaders() {
  const token = localStorage.getItem("auth_token");
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

function renderAuthenticatedState(user) {
  document.getElementById("navGuestActions").classList.add("hidden");
  const authNav = document.getElementById("navAuthActions");
  authNav.classList.remove("hidden");

  document.getElementById("userNameDisplay").textContent = user.name || user.email;
  const initial = (user.name || user.email || "U").charAt(0).toUpperCase();
  document.getElementById("userAvatar").textContent = initial;
}

function renderGuestState() {
  document.getElementById("navGuestActions").classList.remove("hidden");
  document.getElementById("navAuthActions").classList.add("hidden");
}

function openAuthModal(tab = "login") {
  const modal = document.getElementById("authModal");
  modal.classList.remove("hidden");
  switchAuthTab(tab);
  document.getElementById("authErrorAlert").classList.add("hidden");
}

function closeAuthModal() {
  document.getElementById("authModal").classList.add("hidden");
}

function handleBackdropClick(e) {
  if (e.target.id === "authModal") {
    closeAuthModal();
  }
}

function switchAuthTab(tab) {
  const loginForm = document.getElementById("loginForm");
  const signupForm = document.getElementById("signupForm");
  const tabLogin = document.getElementById("authTabLogin");
  const tabSignup = document.getElementById("authTabSignup");
  document.getElementById("authErrorAlert").classList.add("hidden");

  if (tab === "login") {
    loginForm.classList.remove("hidden");
    signupForm.classList.add("hidden");
    tabLogin.classList.add("active");
    tabSignup.classList.remove("active");
  } else {
    loginForm.classList.add("hidden");
    signupForm.classList.remove("hidden");
    tabLogin.classList.remove("active");
    tabSignup.classList.add("active");
  }
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const errorAlert = document.getElementById("authErrorAlert");
  errorAlert.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Login failed.");
    }

    if (data.token) {
      localStorage.setItem("auth_token", data.token);
    }

    currentUser = data.user;
    renderAuthenticatedState(currentUser);
    closeAuthModal();
    showToast(`Welcome back, ${currentUser.name}!`);
    loadTripsCount();
  } catch (err) {
    errorAlert.textContent = err.message;
    errorAlert.classList.remove("hidden");
  }
}

async function handleSignupSubmit(e) {
  e.preventDefault();
  const name = document.getElementById("signupName").value.trim();
  const email = document.getElementById("signupEmail").value.trim();
  const password = document.getElementById("signupPassword").value;
  const errorAlert = document.getElementById("authErrorAlert");
  errorAlert.classList.add("hidden");

  try {
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password })
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Account creation failed.");
    }

    if (data.token) {
      localStorage.setItem("auth_token", data.token);
    }

    currentUser = data.user;
    renderAuthenticatedState(currentUser);
    closeAuthModal();
    showToast(`Account created! Welcome, ${currentUser.name}.`);
    loadTripsCount();
  } catch (err) {
    errorAlert.textContent = err.message;
    errorAlert.classList.remove("hidden");
  }
}

async function handleLogout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: getAuthHeaders()
    });
  } catch (err) {
    console.error(err);
  }
  localStorage.removeItem("auth_token");
  currentUser = null;
  renderGuestState();
  showToast("Logged out successfully.");
  loadTripsCount();
}

// =========================================================
// INTERACTIVE MULTI-AGENT PROGRESS STEPPER
// =========================================================

function startProgressAnimation() {
  const section = document.getElementById("progressSection");
  section.classList.remove("hidden");

  const steps = [
    { id: "stepGuardrail", title: "Validating Travel Request", pct: 15 },
    { id: "stepSupervisor", title: "Routing Specialist Agents", pct: 30 },
    { id: "stepFlight", title: "Searching Flights & Airport Routes", pct: 45 },
    { id: "stepHotel", title: "Finding Accommodations & Suites", pct: 60 },
    { id: "stepWeather", title: "Retrieving Forecast & Climate Trends", pct: 75 },
    { id: "stepBudget", title: "Estimating Transit, Meals & Passes", pct: 88 },
    { id: "stepItinerary", title: "Synthesizing Full Daily Itinerary", pct: 95 }
  ];

  // Reset steps
  steps.forEach(s => {
    const el = document.getElementById(s.id);
    if (el) el.className = "step-node";
  });

  const progressBar = document.getElementById("progressBar");
  const progressTitle = document.getElementById("progressTitle");
  const tickerText = document.getElementById("liveTickerText");

  let currentStepIdx = 0;
  let tickerIdx = 0;

  function updateStep(idx) {
    if (idx >= steps.length) return;
    const step = steps[idx];
    steps.forEach((s, i) => {
      const el = document.getElementById(s.id);
      if (!el) return;
      if (i < idx) {
        el.className = "step-node completed";
      } else if (i === idx) {
        el.className = "step-node active";
      } else {
        el.className = "step-node";
      }
    });

    if (progressBar) progressBar.style.width = `${step.pct}%`;
    if (progressTitle) progressTitle.textContent = step.title;
  }

  updateStep(0);

  // Rotate steps and ticker smoothly
  clearInterval(progressInterval);
  progressInterval = setInterval(() => {
    currentStepIdx = Math.min(currentStepIdx + 1, steps.length - 1);
    updateStep(currentStepIdx);

    tickerIdx = (tickerIdx + 1) % TICKER_MESSAGES.length;
    if (tickerText) {
      tickerText.textContent = TICKER_MESSAGES[tickerIdx];
    }
  }, 2400);

  section.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function stopProgressAnimation() {
  clearInterval(progressInterval);
  const section = document.getElementById("progressSection");
  section.classList.add("hidden");
}

// =========================================================
// TRIP GENERATION & EXECUTION
// =========================================================

function setPrompt(text) {
  const input = document.getElementById("userInput");
  input.value = text;
  input.focus();
  input.scrollIntoView({ behavior: "smooth", block: "center" });
}

function loadSamplePrompt() {
  switchView("planner");
  setPrompt(`I want to have a New York trip for the 12 days from India.

Please itinerary for the complete 12 days and for Six members and their details are given below:
1. Me (Name: Manishkumar Gupta, Age: 31)
2. My Wife (Name: Ruchika Gupta, Age: 29)
3. First Son (Name: Prativindya, Age: 3)
4. My Brother (Name: Ankit Gupta, Age: 29)
5. Mom (Name: Poonam Gupta, Age: 49)
6. Dad (Name: Munnalal Gupta, Age: 56)

Requirements:
- Kid-friendly and senior-friendly pacing with afternoon rest periods
- Multi-bedroom suite or serviced apartment with kitchenette for toddler meals
- Breakdown of flights from India, MetroCard passes, sights, and estimated budget`);
}

function hideError() {
  const errorBox = document.getElementById("errorBox");
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function showError(msg) {
  const errorBox = document.getElementById("errorBox");
  errorBox.textContent = msg;
  errorBox.classList.remove("hidden");
  errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
}

function showToast(msg) {
  const toast = document.getElementById("toastNotification");
  toast.textContent = msg;
  toast.classList.remove("hidden");
  setTimeout(() => {
    toast.classList.add("hidden");
  }, 3200);
}

function startNewTrip() {
  const newThreadId = "thread_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
  currentThreadId = newThreadId;
  currentTripId = null;
  latestAnswerMarkdown = "";
  currentQuery = "";
  currentVersion = 1;
  waitingForApproval = false;
  localStorage.setItem("travel_thread_id", currentThreadId);

  const input = document.getElementById("userInput");
  if (input) {
    input.value = "";
    input.focus();
  }

  const resultSection = document.getElementById("resultSection");
  if (resultSection) resultSection.classList.add("hidden");

  const refineSection = document.getElementById("refineSection");
  if (refineSection) refineSection.classList.add("hidden");

  const approvalSection = document.getElementById("approvalSection");
  if (approvalSection) approvalSection.classList.add("hidden");

  const progressSection = document.getElementById("progressSection");
  if (progressSection) progressSection.classList.add("hidden");

  hideError();
  switchView("planner");
  showToast("Started a new travel planning session!");
}

async function sendMessage() {
  hideError();

  const input = document.getElementById("userInput");
  const message = input.value.trim();

  if (!message) {
    showError("Please enter your travel request first.");
    return;
  }

  currentQuery = message;
  const sendBtn = document.getElementById("sendBtn");
  sendBtn.disabled = true;
  document.getElementById("btnText").textContent = "Planning...";

  startProgressAnimation();

  try {
    // Always isolate each new prompt in a dedicated thread
    const newThreadId = "thread_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
    currentThreadId = newThreadId;
    currentTripId = null;
    localStorage.setItem("travel_thread_id", currentThreadId);

    const res = await fetch("/api/travel", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        message: message,
        thread_id: newThreadId
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Trip generation failed.");
    }

    currentThreadId = data.thread_id;
    currentTripId = data.trip_id || data.thread_id;
    localStorage.setItem("travel_thread_id", currentThreadId);

    showWorkflow(data);

    currentVersion = 1;
    document.getElementById("versionBadge").textContent = "Version 1";

    const itineraryContent = data.itinerary || data.answer || "";

    if (data.requires_approval) {
      waitingForApproval = true;
      showApproval(data);
      showResult(itineraryContent, data.thread_id, true);
    } else {
      waitingForApproval = false;
      hideApproval();
      showResult(itineraryContent, data.thread_id, false);
    }

    // Always reveal continuous refinement section
    showRefineSection();
    loadTripsCount();

  } catch (err) {
    showError(err.message);
  } finally {
    stopProgressAnimation();
    sendBtn.disabled = false;
    document.getElementById("btnText").textContent = "Generate Plan";
  }
}

function showWorkflow(data) {
  const section = document.getElementById("workflowSection");
  const reasoning = document.getElementById("supervisorReasoning");
  const chips = document.getElementById("agentChips");
  const guardrailBadge = document.getElementById("guardrailBadge");

  reasoning.textContent = data.supervisor_reasoning || "Supervisor allocated specialists based on constraints.";
  chips.innerHTML = "";

  (data.selected_agents || []).forEach((agent) => {
    const chip = document.createElement("span");
    chip.className = "agent-chip";
    chip.textContent = AGENT_LABELS[agent] || agent;
    chips.appendChild(chip);
  });

  if (data.guardrail_allowed === false) {
    guardrailBadge.textContent = "Guardrail flagged";
    guardrailBadge.classList.add("blocked");
  } else {
    guardrailBadge.textContent = "Guardrail passed";
    guardrailBadge.classList.remove("blocked");
  }

  section.classList.remove("hidden");
}

function showResult(answer, threadId, isDraft = false) {
  latestAnswerMarkdown = answer || "";

  const resultSection = document.getElementById("resultSection");
  const resultBox = document.getElementById("resultBox");
  const threadInfo = document.getElementById("threadInfo");
  const resultTitle = document.getElementById("resultTitle");

  if (typeof marked !== "undefined") {
    resultBox.innerHTML = marked.parse(latestAnswerMarkdown);
  } else {
    resultBox.innerText = latestAnswerMarkdown;
  }

  threadInfo.textContent = `Thread ID: ${threadId}`;
  resultTitle.textContent = isDraft ? "Draft Travel Itinerary (Review Required)" : "Your Custom Travel Itinerary";
  resultSection.classList.remove("hidden");

  resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showApproval(data) {
  const section = document.getElementById("approvalSection");
  const reqText = document.getElementById("approvalRequest");
  reqText.textContent = data.approval_request || "Approve this draft or request changes before the final version is generated.";
  section.classList.remove("hidden");
}

function hideApproval() {
  document.getElementById("approvalSection").classList.add("hidden");
  document.getElementById("approvalFeedback").value = "";
}

async function submitApproval(approved) {
  hideError();

  if (!currentThreadId) {
    showError("No active travel thread found.");
    return;
  }

  const feedbackInput = document.getElementById("approvalFeedback");
  const feedback = feedbackInput.value.trim();

  if (!approved && !feedback) {
    showError("Please enter your revision feedback before requesting changes.");
    feedbackInput.focus();
    return;
  }

  const approveBtn = document.getElementById("approveBtn");
  const reviseBtn = document.getElementById("reviseBtn");
  approveBtn.disabled = true;
  reviseBtn.disabled = true;

  startProgressAnimation();

  try {
    const res = await fetch("/api/travel/approve", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        thread_id: currentThreadId,
        approved: approved,
        feedback: feedback
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Could not process approval.");
    }

    waitingForApproval = false;
    hideApproval();
    currentVersion += 1;
    document.getElementById("versionBadge").textContent = `Version ${currentVersion}`;

    showResult(data.answer, data.thread_id, false);
    showRefineSection();
    showToast(approved ? "Plan finalized! You can still refine anytime below." : "Itinerary revised based on your feedback.");
    loadTripsCount();

  } catch (err) {
    showError(err.message);
  } finally {
    stopProgressAnimation();
    approveBtn.disabled = false;
    reviseBtn.disabled = false;
  }
}

// =========================================================
// CONTINUOUS REFINEMENT LOOP
// =========================================================

function showRefineSection() {
  const section = document.getElementById("refineSection");
  section.classList.remove("hidden");
  renderHistoryPills();
}

function setRefinePrompt(text) {
  const input = document.getElementById("refineFeedback");
  input.value = text;
  input.focus();
}

function renderHistoryPills() {
  const container = document.getElementById("revisionHistoryPills");
  container.innerHTML = "";
  for (let i = 1; i <= currentVersion; i++) {
    const pill = document.createElement("span");
    pill.className = "history-pill";
    pill.textContent = `v${i}${i === currentVersion ? " (current)" : ""}`;
    container.appendChild(pill);
  }
}

async function submitRefinement() {
  hideError();

  if (!currentThreadId || !latestAnswerMarkdown) {
    showError("There is no active itinerary to refine. Please generate a trip first.");
    return;
  }

  const feedbackInput = document.getElementById("refineFeedback");
  const feedback = feedbackInput.value.trim();

  if (!feedback) {
    showError("Please enter what changes you'd like made to the itinerary.");
    feedbackInput.focus();
    return;
  }

  const refineBtn = document.getElementById("refineBtn");
  refineBtn.disabled = true;
  document.getElementById("refineBtnText").textContent = "Refining Itinerary...";

  startProgressAnimation();

  try {
    const res = await fetch("/api/travel/refine", {
      method: "POST",
      headers: getAuthHeaders(),
      body: JSON.stringify({
        thread_id: currentThreadId,
        feedback: feedback,
        current_itinerary: latestAnswerMarkdown,
        user_query: currentQuery
      })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Refinement failed.");
    }

    currentVersion = data.version || (currentVersion + 1);
    document.getElementById("versionBadge").textContent = `Version ${currentVersion}`;

    latestAnswerMarkdown = data.itinerary;
    showResult(latestAnswerMarkdown, currentThreadId, false);

    feedbackInput.value = "";
    renderHistoryPills();
    showToast(`Updated to Version ${currentVersion}!`);
    loadTripsCount();

  } catch (err) {
    showError(err.message);
  } finally {
    stopProgressAnimation();
    refineBtn.disabled = false;
    document.getElementById("refineBtnText").textContent = "Update Itinerary";
  }
}

// =========================================================
// DASHBOARD & TRIPS PERSISTENCE
// =========================================================

async function loadTripsCount() {
  try {
    const res = await fetch("/api/trips", { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success && Array.isArray(data.trips)) {
      allTrips = data.trips;
      const badge = document.getElementById("tripCountBadge");
      if (allTrips.length > 0) {
        badge.textContent = allTrips.length;
        badge.classList.remove("hidden");
      } else {
        badge.classList.add("hidden");
      }
    }
  } catch (err) {
    console.warn("Could not load trips count:", err);
  }
}

async function loadDashboardTrips() {
  const grid = document.getElementById("tripsGrid");
  const empty = document.getElementById("tripsEmptyState");
  
  // Render Animated Neumorphic Skeleton Loader
  grid.innerHTML = `
    <div class="dashboard-loading-state" style="grid-column: 1 / -1;">
      <div class="radar-status-bar">
        <div class="radar-pulse-ring">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="3 11 22 2 13 21 11 13 3 11"/>
          </svg>
        </div>
        <span class="radar-status-text">Syncing your travel itineraries...</span>
      </div>
      <div class="skeleton-grid">
        <div class="skeleton-card">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="skeleton-bar" style="width: 100px; height: 26px; border-radius: 9999px;"></div>
            <div class="skeleton-bar" style="width: 38px; height: 20px; border-radius: 6px;"></div>
          </div>
          <div class="skeleton-bar" style="width: 80%; height: 22px; margin-top: 4px;"></div>
          <div class="skeleton-bar" style="width: 100%; height: 38px; border-radius: 8px;"></div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border);">
            <div class="skeleton-bar" style="width: 90px; height: 16px;"></div>
            <div style="display: flex; gap: 8px;">
              <div class="skeleton-bar" style="width: 60px; height: 32px; border-radius: 8px;"></div>
              <div class="skeleton-bar" style="width: 32px; height: 32px; border-radius: 8px;"></div>
            </div>
          </div>
        </div>
        <div class="skeleton-card">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="skeleton-bar" style="width: 120px; height: 26px; border-radius: 9999px;"></div>
            <div class="skeleton-bar" style="width: 38px; height: 20px; border-radius: 6px;"></div>
          </div>
          <div class="skeleton-bar" style="width: 75%; height: 22px; margin-top: 4px;"></div>
          <div class="skeleton-bar" style="width: 100%; height: 38px; border-radius: 8px;"></div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border);">
            <div class="skeleton-bar" style="width: 90px; height: 16px;"></div>
            <div style="display: flex; gap: 8px;">
              <div class="skeleton-bar" style="width: 60px; height: 32px; border-radius: 8px;"></div>
              <div class="skeleton-bar" style="width: 32px; height: 32px; border-radius: 8px;"></div>
            </div>
          </div>
        </div>
        <div class="skeleton-card">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <div class="skeleton-bar" style="width: 90px; height: 26px; border-radius: 9999px;"></div>
            <div class="skeleton-bar" style="width: 38px; height: 20px; border-radius: 6px;"></div>
          </div>
          <div class="skeleton-bar" style="width: 85%; height: 22px; margin-top: 4px;"></div>
          <div class="skeleton-bar" style="width: 100%; height: 38px; border-radius: 8px;"></div>
          <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--border);">
            <div class="skeleton-bar" style="width: 90px; height: 16px;"></div>
            <div style="display: flex; gap: 8px;">
              <div class="skeleton-bar" style="width: 60px; height: 32px; border-radius: 8px;"></div>
              <div class="skeleton-bar" style="width: 32px; height: 32px; border-radius: 8px;"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  empty.classList.add("hidden");

  try {
    const res = await fetch("/api/trips", { headers: getAuthHeaders() });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Could not fetch trips.");
    }

    allTrips = data.trips || [];
    renderTripsGrid(allTrips);

  } catch (err) {
    grid.innerHTML = `<div class="alert-error">${err.message}</div>`;
  }
}

function renderTripsGrid(trips) {
  const grid = document.getElementById("tripsGrid");
  const empty = document.getElementById("tripsEmptyState");

  if (!trips || trips.length === 0) {
    grid.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  grid.innerHTML = "";

  trips.forEach((trip) => {
    const card = document.createElement("div");
    card.className = "trip-card";

    const dateStr = trip.updated_at ? new Date(trip.updated_at).toLocaleDateString(undefined, {
      month: "short", day: "numeric", year: "numeric"
    }) : "Recent";

    const excerpt = trip.user_query || (trip.itinerary ? trip.itinerary.slice(0, 140) + "..." : "No preview available.");
    const versions = trip.version_count || 1;

    card.innerHTML = `
      <div>
        <div class="trip-card-header">
          <span class="trip-dest-badge">${trip.destination || "Trip"}</span>
          <span class="trip-status-badge ${trip.status || 'draft'}">${trip.status || 'draft'}</span>
        </div>
        <h3 class="trip-card-title">${trip.title || "Custom Itinerary"}</h3>
        <p class="trip-card-date">Updated ${dateStr} • v${versions}</p>
        <p class="trip-card-excerpt">${excerpt}</p>
      </div>

      <div class="trip-card-footer">
        <button class="btn btn-secondary btn-sm" onclick="openTrip('${trip.id || trip.thread_id}')">
          Open in Planner
        </button>
        <button class="btn btn-outline btn-sm" style="color: #f87171;" onclick="deleteTrip('${trip.id || trip.thread_id}')">
          Delete
        </button>
      </div>
    `;

    grid.appendChild(card);
  });
}

function filterTrips() {
  const q = document.getElementById("tripSearchInput").value.toLowerCase().trim();
  if (!q) {
    renderTripsGrid(allTrips);
    return;
  }
  const filtered = allTrips.filter((t) => {
    return (
      (t.title && t.title.toLowerCase().includes(q)) ||
      (t.destination && t.destination.toLowerCase().includes(q)) ||
      (t.user_query && t.user_query.toLowerCase().includes(q))
    );
  });
  renderTripsGrid(filtered);
}

async function openTrip(tripId) {
  try {
    const res = await fetch(`/api/trips/${tripId}`, { headers: getAuthHeaders() });
    const data = await res.json();

    if (!res.ok || !data.success || !data.trip) {
      throw new Error("Could not load trip.");
    }

    const trip = data.trip;
    currentThreadId = trip.thread_id;
    currentTripId = trip.id;
    localStorage.setItem("travel_thread_id", currentThreadId);
    currentQuery = trip.user_query;
    latestAnswerMarkdown = trip.itinerary;

    const hist = trip.history ? (typeof trip.history === "string" ? JSON.parse(trip.history) : trip.history) : [];
    currentVersion = hist.length || 1;
    document.getElementById("versionBadge").textContent = `Version ${currentVersion}`;

    switchView("planner");

    document.getElementById("userInput").value = trip.user_query || "";
    showResult(trip.itinerary, trip.thread_id, trip.status === "draft");
    showRefineSection();
    showToast(`Opened "${trip.title}"`);

  } catch (err) {
    showToast(err.message);
  }
}

async function deleteTrip(tripId) {
  if (!confirm("Are you sure you want to delete this trip?")) {
    return;
  }

  try {
    const res = await fetch(`/api/trips/${tripId}`, {
      method: "DELETE",
      headers: getAuthHeaders()
    });
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Could not delete trip.");
    }

    showToast("Trip deleted.");
    loadDashboardTrips();
    loadTripsCount();

  } catch (err) {
    showToast(err.message);
  }
}

async function loadTripByThreadId(threadId, switchNow = false) {
  try {
    const res = await fetch(`/api/trips/${threadId}`, { headers: getAuthHeaders() });
    const data = await res.json();
    if (data.success && data.trip) {
      latestAnswerMarkdown = data.trip.itinerary;
      currentQuery = data.trip.user_query;
      currentTripId = data.trip.id;
      if (switchNow) {
        openTrip(data.trip.id);
      }
    }
  } catch (err) {
    console.warn("Could not restore trip:", err);
  }
}

function saveToDashboardPrompt() {
  if (!currentUser) {
    showToast("Sign in to sync all your trips across devices!");
    openAuthModal("login");
  } else {
    showToast("Trip is already automatically synced to your Dashboard!");
  }
}

// =========================================================
// UTILITIES (COPY, PDF)
// =========================================================

function copyResult() {
  if (!latestAnswerMarkdown) return;

  navigator.clipboard.writeText(latestAnswerMarkdown)
    .then(() => {
      const copyText = document.getElementById("copyBtnText");
      copyText.textContent = "Copied!";
      setTimeout(() => {
        copyText.textContent = "Copy Markdown";
      }, 1500);
      showToast("Copied markdown to clipboard!");
    })
    .catch(() => {
      showError("Could not copy markdown to clipboard.");
    });
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, function(s) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s];
  });
}

function downloadPDF() {
  if (!latestAnswerMarkdown) {
    showError("No travel plan available to download.");
    return;
  }

  const btnText = document.getElementById("downloadBtnText");
  const originalText = btnText ? btnText.textContent : "Download PDF";
  if (btnText) btnText.textContent = "Generating PDF...";

  // 1. Extract clean trip title
  let tripTitle = "Custom Travel Itinerary";
  const titleMatch = latestAnswerMarkdown.match(/^#+\s*(.+)$/m);
  if (titleMatch && titleMatch[1]) {
    tripTitle = titleMatch[1].replace(/[*_#`]/g, "").trim();
  } else if (currentQuery) {
    tripTitle = currentQuery.slice(0, 50).trim();
  }

  const safeFilename = (tripTitle.slice(0, 24) || "Itinerary")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/_+/g, "_");

  // 2. Parse Markdown to clean HTML
  let parsedContent = "";
  try {
    parsedContent = marked.parse(latestAnswerMarkdown);
  } catch (e) {
    const resBox = document.getElementById("resultBox");
    parsedContent = resBox ? resBox.innerHTML : latestAnswerMarkdown;
  }

  // 3. Build in-flow container with standard A4 dimensions for html2pdf
  const printWrapper = document.createElement("div");
  printWrapper.id = "activePrintContainer";
  printWrapper.className = "markdown-body";
  printWrapper.style.width = "750px";
  printWrapper.style.margin = "0 auto";
  printWrapper.style.padding = "28px 32px";
  printWrapper.style.boxSizing = "border-box";
  printWrapper.style.background = "#ffffff";
  printWrapper.style.color = "#0f172a";
  printWrapper.style.fontFamily = "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
  printWrapper.style.lineHeight = "1.6";

  const todayStr = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  printWrapper.innerHTML = `
    <div class="pdf-doc-header">
      <div class="pdf-doc-branding">
        <div class="pdf-logo-icon">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
          </svg>
        </div>
        <div>
          <span class="pdf-app-title">TripMate AI</span>
          <span style="font-size: 0.75rem; color: #64748b; margin-left: 8px;">Multi-Agent Travel Dossier</span>
        </div>
      </div>
      <span class="pdf-doc-tag">Verified Plan • v${currentVersion}</span>
    </div>
    <h1 class="pdf-trip-title">${escapeHtml(tripTitle)}</h1>
    <div class="pdf-meta-row">
      <span class="pdf-meta-item">🗓️ ${todayStr}</span>
      <span class="pdf-meta-item">👥 Multi-Gen Family Optimized</span>
      <span class="pdf-meta-item">🛡️ Guardrail Verified</span>
      <span class="pdf-meta-item">✈️ Live MCP Coordinated</span>
    </div>

    <div class="pdf-print-content">
      ${parsedContent}
    </div>

    <div class="pdf-doc-footer">
      <span>TripMate AI • Autonomous Multi-Agent Travel Planner</span>
      <span>Executive Travel Itinerary • Generated via LangGraph & Groq</span>
    </div>
  `;

  const cleanup = () => {
    if (btnText) btnText.textContent = originalText;
  };

  // 4. Configure html2pdf with precision pagination
  const opt = {
    margin: [10, 10, 10, 10], // mm: [top, right, bottom, left]
    filename: `TripMate-${safeFilename}.pdf`,
    image: { type: "jpeg", quality: 0.98 },
    html2canvas: {
      scale: 2,
      useCORS: true,
      backgroundColor: "#ffffff",
      logging: false,
      scrollY: 0,
      scrollX: 0
    },
    jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    pagebreak: {
      mode: ["css", "legacy"],
      avoid: ["tr", "table", "h1", "h2", "h3", ".pdf-meta-row", "blockquote"]
    }
  };

  if (typeof html2pdf !== "undefined") {
    html2pdf()
      .set(opt)
      .from(printWrapper)
      .toPdf()
      .get("pdf")
      .then((pdf) => {
        try {
          const blob = pdf.output("blob");
          const url = URL.createObjectURL(blob);
          const link = document.createElement("a");
          link.href = url;
          link.download = `TripMate-${safeFilename}.pdf`;
          document.body.appendChild(link);
          link.click();
          setTimeout(() => {
            if (link.parentNode) document.body.removeChild(link);
            URL.revokeObjectURL(url);
          }, 60000);
        } catch (saveErr) {
          pdf.save(`TripMate-${safeFilename}.pdf`);
        }
        cleanup();
        showToast("PDF downloaded successfully!");
      })
      .catch((err) => {
        console.error("PDF generation failed:", err);
        cleanup();
        showError("Could not generate PDF: " + (err.message || err));
      });
  } else {
    cleanup();
    showError("PDF engine not loaded yet. Please refresh the page and try again.");
  }
}
