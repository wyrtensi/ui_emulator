with open("js/app.js", "r") as f:
    app_js = f.read()

# Fix config not defined globally for github logic. The original updateLastEditTime just needs its own fetch, since we don't use config anywhere else globally in app.js
app_js = app_js.replace('''let remoteConfig = null;
let config = null; // Global config stub for compat''', '''let remoteConfig = null;''')

# Wait, `config.github.repo` is what it crashed on inside `updateLastEditTime`.
app_js = app_js.replace('''async function updateLastEditTime() {
  if (!config.github.repo) return;
  try {
    // We can fetch the latest commit on the repo
    const res = await fetch(`https://api.github.com/repos/${repo}/commits?per_page=1`);''', '''async function updateLastEditTime() {
  try {
    const configResp = await fetch('./config.json');
    if (!configResp.ok) return;
    const localConfig = await configResp.json();
    if (!localConfig.github || !localConfig.github.repo) return;

    // We can fetch the latest commit on the repo
    const res = await fetch(`https://api.github.com/repos/${localConfig.github.repo}/commits?per_page=1`);''')

with open("js/app.js", "w") as f:
    f.write(app_js)
