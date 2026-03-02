# DS: log-buffer skill

## Vision and Problem Statement
Provide an in-memory log buffer that can accept log entries, return stats, and flush on demand. This avoids ad-hoc logging behavior and keeps log handling consistent.

## Intended Users and Context of Use
Used by any component that needs buffered logging from a single input string. The request is a single string containing one `key: value` pair per line.

## Scope and Boundaries
In scope: buffering log messages, tracking stats, flushing logs, and configuring buffer size. Out of scope: persistent storage, external log pipelines, and complex log formatting.

## Success Criteria
Given the same input, logging produces the same buffer counts and stats. Flush returns buffered messages in order of arrival. Invalid input returns a clear error message.

## Affected Files
./specs/index.mjs.md - Implements log buffering operations and stats. Exports - action entry point that accepts a single string request payload and returns buffer stats or flushed logs.
