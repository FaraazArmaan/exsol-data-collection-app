#!/usr/bin/env python3
"""PreToolUse hook: block unapproved `git push` (iron rule 7 enforcement).

Blocks only when `push` is git's SUBCOMMAND (allowing global flags like
`-C <dir>`, `-c k=v`, `--git-dir=…` in between) — so commit messages or echo
text containing the word "push" never false-positive. Exit 2 = block, with
stderr shown to the agent.

When the human explicitly asks an agent to push, the command must include
EXSOL_ALLOW_AGENT_GIT_PUSH=1 so the hook can distinguish approved pushes from
accidental ones.
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

ALLOW_AGENT_PUSH = "EXSOL_ALLOW_AGENT_GIT_PUSH=1"

if GIT_PUSH.search(cmd) and ALLOW_AGENT_PUSH not in cmd:
    sys.stderr.write(
        "BLOCKED (iron rule 7): never `git push` from an agent session unless "
        "the human explicitly asked the agent to push. If approved, rerun with "
        "EXSOL_ALLOW_AGENT_GIT_PUSH=1 in the command.\n"
    )
    sys.exit(2)

sys.exit(0)
