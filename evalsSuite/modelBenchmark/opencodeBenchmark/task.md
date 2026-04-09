Build a complete CLI tool in src/depgraph.mjs that:
1) Takes a directory path as CLI argument
2) Recursively finds all .mjs/.js files
3) Parses ES module import statements using regex (no AST dependencies)
4) Builds a directed dependency graph
5) Detects circular dependencies using DFS
6) Outputs DOT format to stdout with circular edges colored red
7) Supports --json flag for JSON adjacency list output
8) Supports --cycles-only to show only cycle edges
9) Has error handling for missing paths (exit code 1, message to stderr)

Also create tests/a.mjs through tests/e.mjs with various imports including a circular dependency (a imports b, b imports c, c imports a; d is standalone; e imports a), and tests/run-tests.mjs that uses node:assert/strict and child_process to verify:
- DOT output contains correct edges and cycle coloring
- JSON output parses correctly with right adjacency
- --cycles-only filters non-cycle edges
- Missing directory gives error

Write all files immediately. Do not plan or explain, just write the code.
