# fix-tests-and-code

Loop through test execution, analyse failures, and regenerate specs/code until the suite passes.

## Summary
- Runs the `run-tests` skill.
- When failures occur, appends diagnostic notes to the relevant DS files and reruns `build-code`.
- Stops when the suite succeeds or when no actionable failures remain.

## Instructions
- Limit the number of attempts to avoid infinite loops.
- Surface failing suites and the remediation applied in the final response.
