# DS003 - Logging and Supervision

## Unified Logger

MainAgent uses a single logger instance. There is no separate debug logger.

**Logger methods:**
- info — always writes to console
- warn — always writes to console
- debug — writes to console AND to debug log file only when ACHILLES_DEBUG is enabled

**Default behavior:**
- If no logger is provided, a default logger is created via createLogger()
- The default logger writes info and warn to console always
- Debug output is gated by the ACHILLES_DEBUG environment variable

## Debug Mode Control

Controlled by the ACHILLES_DEBUG environment variable.

| ACHILLES_DEBUG value | debug() output |
|---------------------|----------------|
| not set | nothing |
| false | nothing |
| true | console + debug file |
| 1 | console + debug file |

When debug is enabled, debug output is written to debuglogs/debug-{pid}.log in addition to the console.

## Debug Events

The following events are logged at debug level:
- Skill discovery: roots found, total skills discovered
- Duplicate skill detection: canonical name conflict with both directory paths

## Warning Events

The following events are logged at warn level (always visible):
- Skill descriptor parse failure
- Skill preparation failure
- Skill directory read failure

## SecuritySupervisor

Controls tool approval during loop session execution and provides output writing capability.

**Default behavior:**
- If no supervisor is provided, a default SecuritySupervisor is created
- The default supervisor always approves tool calls
- The default output writer is a no-op

**Supervisor interface:**
- approve — receives tool choice information, returns approval decision
- getOutputWriter — returns an object with a write method for real-time output

**Approval decisions:**
- approve — execute the tool normally
- alwaysApprove — execute the tool and cache the approval for future identical calls
- deny — mark as denied, do not execute, return error to LLM

## Logger Propagation

The logger is passed to:
- discoverSkills function
- SecuritySupervisor constructor

The supervisor receives the same logger instance as MainAgent.

## What Logging Does NOT Do

- Does NOT have a separate debugLogger parameter
- Does NOT write debug output to console when ACHILLES_DEBUG is false
- Does NOT expose processing callbacks (onProcessingBegin, onProcessingProgress, onProcessingEnd)
- Does NOT use ActionReporter

## Testable Functionality

Test files should be created in tests/mainAgent/

**Logger tests should cover:**
- Default logger is created when none provided
- Custom logger is used when provided
- info method always outputs
- warn method always outputs
- debug method is silent when ACHILLES_DEBUG is false
- debug method outputs to console and file when ACHILLES_DEBUG is true
- Debug log file is created in debuglogs directory

**Supervisor tests should cover:**
- Default supervisor is created when none provided
- Custom supervisor is used when provided
- Default approve returns approve
- getOutputWriter returns object with write method
- Default output writer write is no-op
- Supervisor is passed to loop session creation
