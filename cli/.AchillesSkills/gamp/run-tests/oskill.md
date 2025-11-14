# run-tests

Execute the project test harness (`runAlltests.js`) and summarise failures per suite.

## Summary
- Supports optional suite selection (`FS-001`, `NFS-002`, etc.).
- Streams stdout/stderr from the Node.js test runner.
- Reports exit codes and failing suites for follow-up orchestrations.

## Instructions
- Assume `runAlltests.js` lives at the workspace root.
- Default to running every suite when the prompt does not mention a specific one.
- Fail loudly when the script exits with a non-zero status.
