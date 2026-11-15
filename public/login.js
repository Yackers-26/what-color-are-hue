const $ = id => document.getElementById(id);
const signInTab = $("signin-tab"), signUpTab = $("signup-tab");
const status = $("form-status"), submit = $("submit-auth"), form = $("auth-form");
const password = $("auth-password");
let mode = "login";
function selectMode(next) {
  mode = next;
  const create = next === "signup";
  $("name-field").hidden = !create;
  $("auth-name").required = create;
  $("auth-password").autocomplete = create ? "new-password" : "current-password";
  $("password-hint").hidden = !create;
  $("submit-label").textContent = create ? "Create account" : "Sign in";
  $("auth-title").innerHTML = create ? "Make it <em>yours.</em>" : "Welcome <em>back.</em>";
  $("auth-subtitle").textContent = create ? "Create an account to keep your color readings and guides." : "Sign in to access your saved colors and tasks.";
  signInTab.classList.toggle("is-active", !create);
  signUpTab.classList.toggle("is-active", create);
  signInTab.setAttribute("aria-selected", String(!create));
  signUpTab.setAttribute("aria-selected", String(create));
  status.textContent = "";
}
signInTab.addEventListener("click", () => selectMode("login"));
signUpTab.addEventListener("click", () => selectMode("signup"));
$("show-password").addEventListener("click", () => {
  const reveal = password.type === "password";
  password.type = reveal ? "text" : "password";
  $("show-password").textContent = reveal ? "Hide" : "Show";
  $("show-password").setAttribute("aria-pressed", String(reveal));
});
form.addEventListener("submit", async event => {
  event.preventDefault();
  status.textContent = "";
  const email = $("auth-email").value.trim();
  const payload = { email, password: password.value };
  if (mode === "signup") {
    payload.name = $("auth-name").value.trim();
    if (payload.password.length < 12) { status.textContent = "Use a password of at least 12 characters."; return; }
    if (!payload.name) { status.textContent = "Enter your name."; return; }
  }
  if (!email || !payload.password) { status.textContent = "Enter your email and password."; return; }
  submit.disabled = true;
  try {
    const response = await fetch(`/api/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Unable to sign in.");
    location.assign("/app");
  } catch (error) {
    status.textContent = error.message;
  } finally { submit.disabled = false; }
});
const errors = { "existing-email": "This email already has an account. Sign in with your original method.", google: "Google sign-in was not completed. Please try again.", "not-configured": "Google sign-in is not configured yet." };
const reason = new URLSearchParams(location.search).get("error");
if (reason) status.textContent = errors[reason] || "Sign-in could not be completed.";
fetch("/api/auth/config").then(r => r.json()).then(config => {
  if (!config.googleEnabled) {
    $("google-auth").classList.add("is-disabled");
    $("google-auth").removeAttribute("href");
    $("google-auth").setAttribute("aria-disabled", "true");
  }
  if (!config.databaseReady) $("auth-config-note").textContent = "Account storage is not connected yet. Your team must configure MongoDB to enable sign-in.";
  else if (!config.googleEnabled) $("auth-config-note").textContent = "Google sign-in will be available after OAuth setup. Email sign-in is ready.";
}).catch(() => { $("auth-config-note").textContent = "Can't check sign-in availability. Verify the server is running."; });
