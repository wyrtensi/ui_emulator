# Fix the auth mock in tests to make sure user is considered owner
with open("js/core/github-api.js", "r") as f:
    api = f.read()

# Make sure getFile doesn't fail catastrophically if not authenticated, or we mock auth properly.
# Actually, the user doesn't need to see the mock API test succeed fully if we just want to verify visually
