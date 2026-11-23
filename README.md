# Claude Usage for GNOME

See your **Claude plan usage limits** right in the GNOME top bar — the same numbers
as the usage page on claude.ai: the **5-hour session** and the **weekly** limit.

```
✻ 42% · 27%
```

Click it for progress bars, reset times ("Resets at 13:10", "Resets Sun, 22:00"),
when the data was last updated, and a **Refresh now** button.

The label turns yellow at 70% and red at 90% (whichever limit is higher).
Strings are in English, with Portuguese when your system language is `pt`.

> Unofficial community project. Not affiliated with or endorsed by Anthropic.

## Requirements

- GNOME Shell 45–50 (Wayland or X11)
- Python 3 (standard library only)
- [Claude Code](https://claude.com/claude-code) logged in with a Claude subscription
  (Pro / Max / Team). API-key-only setups have no plan limits to show.

## Install

```bash
git clone https://github.com/matheusmagnon/claude-usage-gnome.git
cd claude-usage-gnome
./install.sh --statusline
```

Then **log out and back in** (Wayland can't load new extensions in a running session).

Everything is installed per user, no root:

| What | Where |
|---|---|
| Extension | `~/.local/share/gnome-shell/extensions/claude-usage@matheusmagnon.github.io` |
| Scripts | `~/.local/bin/claude-usage-poll`, `~/.local/bin/claude-usage-statusline` |
| Poller timer | `~/.config/systemd/user/claude-usage-poll.{service,timer}` |
| Data | `~/.cache/claude-usage.json` |

Options:

- `--statusline` — wires the hook into `~/.claude/settings.json`. If you already have a
  statusline, it is **wrapped**, not replaced (your output stays the same). A backup of
  `settings.json` is saved next to it.
- `--no-poll` — don't install the poller; use only the statusline data.

Uninstall with `./uninstall.sh`.

## How it works

Two sources write the same small JSON file; the extension watches it and updates
instantly (no polling inside GNOME Shell).

1. **Claude Code statusline** (`claude-usage-statusline`). Claude Code passes a
   `rate_limits` object to the statusline command on every update. The hook saves it,
   then runs your original statusline. Free and instant, but only while a Claude Code
   session is active.
2. **Poller** (`claude-usage-poll`, systemd user timer, every 60 s). Asks
   `api.anthropic.com/api/oauth/usage` (the endpoint behind claude.ai's usage page) using
   Claude Code's stored OAuth token. This covers usage from claude.ai, the desktop app
   or other machines, and keeps the bar current when Claude Code is closed.
   **Refresh now** runs it on demand.

If a window's reset time passes before fresh data arrives, it is shown as 0%.

### About the token

The poller reads `~/.claude/.credentials.json` **read-only** and never refreshes the token.
Refreshing it outside Claude Code could rotate the refresh token and log Claude Code out.
The access token lasts a few hours. If Claude Code has been closed longer than that, the
poller skips its runs and the bar keeps the last value until you open Claude Code again.
The token is sent only to `api.anthropic.com`.

### Caveats

- `/api/oauth/usage` is **undocumented** and may change or disappear. If it does, the
  statusline source keeps working.
- Don't set the timer much below 60 s. Be nice to the endpoint.
- macOS stores Claude Code credentials in the Keychain, but this is a GNOME extension
  anyway.

## Configuration

- **Poll interval**: edit `OnUnitActiveSec=` in
  `~/.config/systemd/user/claude-usage-poll.timer`, then run `systemctl --user daemon-reload`.
- **Custom Claude config dir**: `CLAUDE_CONFIG_DIR` is respected by the poller.

## Troubleshooting

```bash
gnome-extensions info claude-usage@matheusmagnon.github.io   # should be ACTIVE
cat ~/.cache/claude-usage.json                                # current data
systemctl --user list-timers claude-usage-poll.timer          # poller schedule
journalctl --user -u claude-usage-poll -n 20                  # poller errors
journalctl --user -b | grep -iE "claude-usage|JS ERROR"       # extension errors
```

- Bar shows `✻ —`: no data yet. Open Claude Code once, or run `claude-usage-poll`.
- "updated N h ago" and Refresh does nothing: the token expired. Open Claude Code.

## License

MIT
