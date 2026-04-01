with open("js/app.js", "r") as f:
    app_js = f.read()

# Fix config is not defined in js/app.js
if "let config = null;" not in app_js:
    app_js = app_js.replace('''let remoteConfig = null;''', '''let remoteConfig = null;
let config = null; // Global config stub for compat''')

with open("js/app.js", "w") as f:
    f.write(app_js)
