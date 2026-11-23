#!/usr/bin/env bash
# Removes Claude Usage. Does not touch ~/.claude/settings.json — if you wired the
# statusline, remove "claude-usage-statusline" from statusLine.command yourself.
set -uo pipefail
UUID="claude-usage@matheusmagnon.github.io"
gnome-extensions disable "$UUID" 2>/dev/null
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
systemctl --user disable --now claude-usage-poll.timer 2>/dev/null
rm -f "${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/claude-usage-poll."{service,timer}
systemctl --user daemon-reload
rm -f "$HOME/.local/bin/claude-usage-poll" "$HOME/.local/bin/claude-usage-statusline"
rm -f "${XDG_CACHE_HOME:-$HOME/.cache}/claude-usage.json"
echo "Claude Usage removed. Log out and back in to drop it from the top bar."
grep -qs claude-usage-statusline "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json" \
  && echo "Note: settings.json still references claude-usage-statusline — remove it from statusLine.command."
