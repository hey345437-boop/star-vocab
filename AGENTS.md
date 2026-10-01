# Project handoff

- Read `README.md`, `docs/MIGRATION.md`, and `docs/PROJECT-STATUS.md` before continuing development.
- The three performance phases under `docs/superpowers/` are plans, not completed features. Check the current source and validation evidence before claiming a task is finished.
- Use the Node.js version in `.nvmrc`, `npm ci`, and `npm run build`. Keep scripts compatible with macOS and Windows; use Node.js for filesystem tasks rather than OS-specific shell commands.
- Preserve the browser progress storage key `star-vocab-progress-v1`. Validate a complete import before saving, and retain records that are not present in an imported file.
- The main repository is public. Keep original chats, personal progress, backup snapshots, local-only settings, and credentials out of it. Complete project backups belong in the separate private backup repository.
- Before switching computers, update the project status, push the code, export browser progress, and run the private backup command documented in `docs/MIGRATION.md`.
- Do not call any fal key without the user's explicit authorization to use that key for generation in the current task. Never write key values to notes, logs, or documentation.
- Explain completed work, verification, and remaining limits in simple language.
