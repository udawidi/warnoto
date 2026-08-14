---
name: war-mulai
description: Start or verify the WARNOTO Vite development server when the user asks to boot the app, run local development, or use /war-mulai.
---

# Mulai WARNOTO

Use the project working directory and port 3001. First inspect whether a Vite server is already listening; if so, report its URL and do not restart it. Otherwise start `npm run dev` as a background process, wait for its readiness output or verify `http://localhost:3001/`, then report the URL. Do not stop an existing server unless explicitly asked. If startup fails, report the original error and suggest only the relevant remedy (for example, installing dependencies).
