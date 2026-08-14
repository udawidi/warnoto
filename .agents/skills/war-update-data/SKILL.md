---
name: war-update-data
description: Review finished WARNOTO changes for a deliberate local commit and, only after separate explicit confirmation, Supabase schema application or git push.
---

# Update & sinkronisasi WARNOTO

Inspect `git status` and staged/unstaged diffs. Show untracked files individually and check for secrets; never use blanket staging. Propose a concise commit message based on project history and ask which files should be included before committing. If `App.jsx` changed, require build/browser verification. If `supabase/schema.sql` changed, summarize the diff and ask separately whether the user wants manual/approved production application; never apply it automatically. After a local commit, show its summary and ask explicitly whether to push the current branch; never auto-push, force-push, or push another branch.

Do not process pending-review data (TUG Surabaya, Material Cadang, SAP/Non-SAP imports). Respect the project rule that commit, push/deploy, and schema execution are separate approvals. Do not edit `HANDOFF.md` unless the user explicitly approves that update.
