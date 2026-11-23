#!/usr/bin/env bash
# Installs Claude Usage for the current user (no root needed).
#   ./install.sh                 extension + poller + statusline hook script
#   ./install.sh --statusline    also wires the hook into ~/.claude/settings.json
#                                (wrapping your existing statusline, if any)
#   ./install.sh --no-poll       skip the 1-minute poller (statusline data only)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

UUID="claude-usage@matheusmagnon.github.io"
EXT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
BIN_DIR="$HOME/.local/bin"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"

WIRE_STATUSLINE=0; POLL=1
for a in "$@"; do
  case "$a" in
    --statusline) WIRE_STATUSLINE=1 ;;
    --no-poll) POLL=0 ;;
    -h|--help) sed -n 2,6p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 1 ;;
  esac
done

command -v python3 >/dev/null || { echo "python3 is required" >&2; exit 1; }

echo ":: extension → $EXT_DIR"
mkdir -p "$EXT_DIR"
cp extension/$UUID/* "$EXT_DIR/"

echo ":: scripts → $BIN_DIR"
install -Dm755 bin/claude-usage-statusline "$BIN_DIR/claude-usage-statusline"
install -Dm755 bin/claude-usage-poll "$BIN_DIR/claude-usage-poll"

if [ "$POLL" = 1 ]; then
  echo ":: poller timer (every 60 s)"
  install -Dm644 systemd/claude-usage-poll.service "$UNIT_DIR/claude-usage-poll.service"
  install -Dm644 systemd/claude-usage-poll.timer "$UNIT_DIR/claude-usage-poll.timer"
  systemctl --user daemon-reload
  systemctl --user enable --now claude-usage-poll.timer
  systemctl --user start claude-usage-poll.service || true
fi

if [ "$WIRE_STATUSLINE" = 1 ]; then
  echo ":: wiring statusline in $CLAUDE_DIR/settings.json"
  python3 - "$CLAUDE_DIR/settings.json" "$BIN_DIR/claude-usage-statusline" <<'PY'
import json, os, shutil, sys, time
path, hook = sys.argv[1], sys.argv[2]
s = {}
if os.path.exists(path):
    shutil.copy2(path, f"{path}.bak.{int(time.time())}")
    with open(path) as f:
        s = json.load(f)
cur = (s.get("statusLine") or {}).get("command", "")
if "claude-usage-statusline" in cur:
    print("   already wired"); sys.exit(0)
cmd = f"{hook} {cur}".strip()
s["statusLine"] = {**(s.get("statusLine") or {}), "type": "command", "command": cmd}
with open(path, "w") as f:
    json.dump(s, f, indent=2); f.write("\n")
print(f"   statusLine.command = {cmd}")
PY
fi

# The running Shell may not know the new extension yet (Wayland), so add it to
# enabled-extensions directly; it loads on next login.
python3 - "$UUID" <<'PY'
import ast, subprocess, sys
uuid = sys.argv[1]
raw = subprocess.run(["gsettings", "get", "org.gnome.shell", "enabled-extensions"],
                     capture_output=True, text=True).stdout.strip()
cur = ast.literal_eval(raw.removeprefix("@as ")) if raw else []
if uuid not in cur:
    subprocess.run(["gsettings", "set", "org.gnome.shell", "enabled-extensions", str(cur + [uuid])], check=True)
PY
echo ":: extension enabled"

cat <<MSG

Done. Log out and back in (Wayland) — or press Alt+F2, r on X11 — to load it.
$( [ "$WIRE_STATUSLINE" = 0 ] && echo "Optional: run ./install.sh --statusline for instant updates while Claude Code is running." )
MSG
