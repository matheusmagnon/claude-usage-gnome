// Claude Usage — shows Claude plan usage limits (5h session / weekly) in the
// GNOME top bar. Reads ~/.cache/claude-usage.json, which is written by
// `claude-usage-statusline` (Claude Code statusline) and `claude-usage-poll`.
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const CACHE = GLib.build_filenamev([GLib.get_user_cache_dir(), 'claude-usage.json']);
const BAR_W = 220;
const REFRESH_TIMEOUT_S = 15;

const STRINGS = {
    en: {
        session: 'Current session (5h)',
        weekly: 'Weekly — all models',
        used: p => `${p}% used`,
        noData: 'no data',
        resetsAt: hm => `Resets at ${hm}`,
        resetsOn: (day, hm) => `Resets ${day}, ${hm}`,
        alreadyReset: 'already reset',
        justNow: 'updated just now',
        minAgo: m => `updated ${m} min ago`,
        hAgo: h => `updated ${h} h ago`,
        daysAgo: d => `updated ${d} days ago`,
        waiting: 'waiting for Claude Code…',
        refresh: 'Refresh now',
        open: 'Open usage on claude.ai',
    },
    pt: {
        session: 'Sessão atual (5h)',
        weekly: 'Semanal — todos os modelos',
        used: p => `${p}% usado`,
        noData: 'sem dados',
        resetsAt: hm => `Redefine às ${hm}`,
        resetsOn: (day, hm) => `Reinicia ${day}, ${hm}`,
        alreadyReset: 'já redefiniu',
        justNow: 'atualizado agora',
        minAgo: m => `atualizado há ${m} min`,
        hAgo: h => `atualizado há ${h} h`,
        daysAgo: d => `atualizado há ${d} dias`,
        waiting: 'aguardando o Claude Code…',
        refresh: 'Atualizar agora',
        open: 'Abrir uso no claude.ai',
    },
};

const T = (() => {
    for (const lang of GLib.get_language_names()) {
        const code = lang.split(/[_.@]/)[0];
        if (STRINGS[code]) return STRINGS[code];
    }
    return STRINGS.en;
})();

function level(pct) {
    if (pct >= 90) return 'claude-usage-crit';
    if (pct >= 70) return 'claude-usage-warn';
    return null;
}

// A window whose reset time has passed counts as 0% until fresh data arrives.
function effective(win, now) {
    if (!win || typeof win.used_percentage !== 'number') return null;
    const expired = win.resets_at && win.resets_at <= now;
    return {pct: expired ? 0 : Math.round(win.used_percentage), resetsAt: win.resets_at};
}

function fmtReset(ts, now, weekly) {
    if (!ts) return '';
    if (ts <= now) return T.alreadyReset;
    const d = GLib.DateTime.new_from_unix_local(ts);
    const hm = d.format('%H:%M');
    if (!weekly && ts - now < 24 * 3600) return T.resetsAt(hm);
    return T.resetsOn(d.format('%a'), hm);
}

function fmtAgo(ts, now) {
    if (!ts) return '';
    const m = Math.floor((now - ts) / 60);
    if (m < 1) return T.justNow;
    if (m < 60) return T.minAgo(m);
    const h = Math.floor(m / 60);
    if (h < 48) return T.hAgo(h);
    return T.daysAgo(Math.floor(h / 24));
}

class UsageRow {
    constructor(menu, title) {
        this.item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const box = new St.BoxLayout({vertical: true, x_expand: true});
        const head = new St.BoxLayout({x_expand: true});
        head.add_child(new St.Label({text: title, x_expand: true}));
        this.pct = new St.Label({text: '—', style_class: 'claude-usage-label claude-usage-pct'});
        head.add_child(this.pct);
        const bg = new St.Widget({style_class: 'claude-usage-bar-bg', x_expand: true});
        this.fill = new St.Widget({style_class: 'claude-usage-bar-fill', width: 0});
        bg.add_child(this.fill);
        this.sub = new St.Label({text: '', style_class: 'claude-usage-sub'});
        box.add_child(head);
        box.add_child(bg);
        box.add_child(this.sub);
        this.item.add_child(box);
        menu.addMenuItem(this.item);
    }

    set(win, now, weekly) {
        for (const c of ['claude-usage-warn', 'claude-usage-crit'])
            this.fill.remove_style_class_name(c);
        if (!win) {
            this.pct.text = '—';
            this.fill.width = 0;
            this.sub.text = T.noData;
            return;
        }
        this.pct.text = T.used(win.pct);
        this.fill.width = Math.round(BAR_W * Math.min(win.pct, 100) / 100);
        const lv = level(win.pct);
        if (lv) this.fill.add_style_class_name(lv);
        this.sub.text = fmtReset(win.resetsAt, now, weekly);
    }
}

const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init() {
        super._init(0.0, 'Claude Usage');
        this._label = new St.Label({
            text: '✻ …',
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'claude-usage-label',
        });
        this.add_child(this._label);

        this._session = new UsageRow(this.menu, T.session);
        this._weekly = new UsageRow(this.menu, T.weekly);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._ago = new PopupMenu.PopupMenuItem('', {reactive: false});
        this.menu.addMenuItem(this._ago);
        const refresh = new PopupMenu.PopupMenuItem(T.refresh);
        refresh.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refresh);
        const open = new PopupMenu.PopupMenuItem(T.open);
        open.connect('activate', () =>
            Gio.AppInfo.launch_default_for_uri('https://claude.ai/settings/usage', null));
        this.menu.addMenuItem(open);

        this._data = null;
        this._refreshing = false;
        this._refreshTimeout = 0;
        this._file = Gio.File.new_for_path(CACHE);
        this._monitor = this._file.monitor_file(Gio.FileMonitorFlags.WATCH_MOVES, null);
        this._monitorId = this._monitor.connect('changed', () => this._load());
        // 1-minute tick: re-render only (expired windows, "N min ago"); no disk I/O.
        this._tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._render();
            return GLib.SOURCE_CONTINUE;
        });
        this.menu.connect('open-state-changed', (_m, isOpen) => isOpen && this._render());
        this._load();
    }

    // Run the poller now; the FileMonitor picks up the result.
    _refresh() {
        this._refreshing = true;
        this._render();
        try {
            Gio.Subprocess.new(['systemctl', '--user', 'start', 'claude-usage-poll.service'],
                Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            console.warn(`claude-usage: ${e}`);
        }
        if (this._refreshTimeout) GLib.source_remove(this._refreshTimeout);
        this._refreshTimeout = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_TIMEOUT_S, () => {
            this._refreshTimeout = 0;
            this._refreshing = false;
            this._render();
            return GLib.SOURCE_REMOVE;
        });
    }

    _load() {
        try {
            const [ok, bytes] = this._file.load_contents(null);
            if (ok) {
                this._data = JSON.parse(new TextDecoder().decode(bytes));
                this._refreshing = false;
            }
        } catch (_e) {
            // missing file or mid-write: keep the last value
        }
        this._render();
    }

    _render() {
        const now = Math.floor(Date.now() / 1000);
        const d = this._data;
        const s = effective(d?.five_hour, now);
        const w = effective(d?.seven_day, now);

        for (const c of ['claude-usage-warn', 'claude-usage-crit', 'claude-usage-stale'])
            this._label.remove_style_class_name(c);

        let text;
        if (!s && !w) {
            text = '✻ —';
            this._label.add_style_class_name('claude-usage-stale');
        } else {
            text = `✻ ${s ? s.pct : '—'}% · ${w ? w.pct : '—'}%`;
            const lv = level(Math.max(s?.pct ?? 0, w?.pct ?? 0));
            if (lv) this._label.add_style_class_name(lv);
        }
        this._label.text = (this._refreshing ? '⟳ ' : '') + text;

        this._session.set(s, now, false);
        this._weekly.set(w, now, true);
        this._ago.label.text = d ? fmtAgo(d.updated_at, now) : T.waiting;
    }

    destroy() {
        if (this._tick) GLib.source_remove(this._tick);
        this._tick = 0;
        if (this._refreshTimeout) GLib.source_remove(this._refreshTimeout);
        this._refreshTimeout = 0;
        if (this._monitor) {
            this._monitor.disconnect(this._monitorId);
            this._monitor.cancel();
            this._monitor = null;
        }
        super.destroy();
    }
});

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._indicator = new Indicator();
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
