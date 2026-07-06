#!/usr/bin/env python3
"""PreToolUse hook: block `git push` (iron rule 7 as enforcement, not memory).

Blocks only when `push` is git's SUBCOMMAND (allowing global flags like
`-C <dir>`, `-c k=v`, `--git-dir=…` in between) — so commit messages or echo
text containing the word "push" never false-positive. Exit 2 = block, with
stderr shown to the agent.
"""
import json
import re
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)

cmd = (data.get("tool_input") or {}).get("command") or ""

# git, then any run of flag tokens (each optionally with one value token), then push.
GIT_PUSH = re.compile(r"\bgit(?:\s+-{1,2}\S+(?:\s+(?!push\b)[^-\s]\S*)?)*\s+push\b")

if GIT_PUSH.search(cmd):
    sys.stderr.write(
        "BLOCKED (iron rule 7): never `git push` from an agent session — Netlify "
        "auto-deploys cost credits and pushes are the human's call. Commit locally; "
        "the human pushes via the Main integration chat.\n"
    )
    sys.exit(2)

sys.exit(0)
