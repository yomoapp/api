#!/usr/bin/env python3
"""Yomo desktop agent: reports the song playing (MPRIS via playerctl) and keyboard/mouse idle time to the API."""
import getpass
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "https://api-zeta-six-76.vercel.app"
CONFIG_PATH = os.path.join(os.path.expanduser("~"), ".config", "yomo", "agent.json")
LOOP_SEC = 10
HEARTBEAT_SEC = 30
IDLE_THRESHOLD = 300
MAX_BACKOFF = 120

_warned_playerctl = False


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def save_config(cfg):
    os.makedirs(os.path.dirname(CONFIG_PATH), mode=0o700, exist_ok=True)
    os.chmod(os.path.dirname(CONFIG_PATH), 0o700)
    tmp = CONFIG_PATH + ".tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(cfg, f)
    os.replace(tmp, CONFIG_PATH)


class ApiError(Exception):
    def __init__(self, status, body=""):
        super().__init__("HTTP %s %s" % (status, body[:200]))
        self.status = status


def request(base, method, path, body=None, token=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(base.rstrip("/") + "/api/v1" + path, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    req.add_header("User-Agent", "yomo-agent/1")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        raise ApiError(e.code, e.read().decode("utf-8", "replace"))


def cmd_login():
    base = input("API base URL [%s]: " % DEFAULT_BASE).strip() or DEFAULT_BASE
    email = input("Email: ").strip()
    password = getpass.getpass("Password: ")
    try:
        res = request(base, "POST", "/auth/login", {"email": email, "password": password})
    except ApiError as e:
        print("Login failed: %s" % e)
        return 1
    except (urllib.error.URLError, OSError) as e:
        print("Network error: %s" % e)
        return 1
    save_config({"baseUrl": base.rstrip("/"), "refreshToken": res["refreshToken"]})
    print("Logged in. Saved to %s" % CONFIG_PATH)
    return 0


def read_song():
    """Returns (song dict or None). Prefers a Playing player (firefox first), else a Paused firefox."""
    global _warned_playerctl
    try:
        out = subprocess.run(
            ["playerctl", "-a", "metadata", "--format", "{{playerName}}\t{{status}}\t{{artist}}\t{{title}}"],
            capture_output=True, text=True, timeout=5,
        ).stdout
    except FileNotFoundError:
        if not _warned_playerctl:
            _warned_playerctl = True
            log("playerctl not found: install it (sudo apt install playerctl / sudo dnf install playerctl). Sending song=null.")
        return None
    except (subprocess.TimeoutExpired, OSError):
        return None
    players = []
    for line in out.splitlines():
        parts = line.split("\t")
        if len(parts) < 4 or not parts[3].strip():
            continue
        players.append({"player": parts[0], "status": parts[1], "artist": parts[2], "title": "\t".join(parts[3:])})
    is_ff = lambda p: "firefox" in p["player"].lower()
    playing = [p for p in players if p["status"] == "Playing"]
    pick, flag = None, False
    if playing:
        pick, flag = sorted(playing, key=lambda p: not is_ff(p))[0], True
    else:
        paused = [p for p in players if p["status"] == "Paused" and is_ff(p)]
        if paused:
            pick = paused[0]
    if not pick:
        return None
    return {
        "title": pick["title"].strip()[:200],
        "artist": pick["artist"].strip()[:200],
        "player": pick["player"][:60],
        "playing": flag,
    }


def read_idle():
    try:
        out = subprocess.run(
            ["gdbus", "call", "--session", "--dest", "org.gnome.Mutter.IdleMonitor",
             "--object-path", "/org/gnome/Mutter/IdleMonitor/Core",
             "--method", "org.gnome.Mutter.IdleMonitor.GetIdletime"],
            capture_output=True, text=True, timeout=5,
        ).stdout
        m = re.search(r"uint64\s+(\d+)", out)
        return min(int(m.group(1)) // 1000, 604800) if m else 0
    except (OSError, subprocess.TimeoutExpired):
        return 0


class Client:
    def __init__(self, cfg):
        self.cfg = cfg
        self.access = None

    def refresh(self):
        res = request(self.cfg["baseUrl"], "POST", "/auth/refresh", {"refreshToken": self.cfg["refreshToken"]})
        self.access = res["accessToken"]
        if res.get("refreshToken") and res["refreshToken"] != self.cfg["refreshToken"]:
            self.cfg["refreshToken"] = res["refreshToken"]
            save_config(self.cfg)

    def put_live(self, payload):
        if not self.access:
            self.refresh()
        try:
            request(self.cfg["baseUrl"], "PUT", "/work/live", payload, self.access)
        except ApiError as e:
            if e.status != 401:
                raise
            self.refresh()
            request(self.cfg["baseUrl"], "PUT", "/work/live", payload, self.access)


def cmd_run():
    cfg = load_config()
    if not cfg:
        print("Not logged in. Run: yomo-agent login")
        return 1
    client = Client(cfg)
    device = socket.gethostname()[:40] or "linux"
    last = None  # (song key, idle-over-threshold) of the last successful send
    last_sent = 0.0
    backoff = 0
    log("yomo-agent started (%s)" % cfg["baseUrl"])
    while True:
        song, idle = read_song(), read_idle()
        key = (json.dumps(song, sort_keys=True), idle >= IDLE_THRESHOLD)
        if last is None or key != last[0] or time.time() - last_sent >= HEARTBEAT_SEC:
            try:
                client.put_live({"device": device, "song": song, "idleSec": idle})
                last, last_sent, backoff = (key,), time.time(), 0
                log("sent: %s idle=%ss" % ((song["artist"] + " - " + song["title"]) if song else "no song", idle))
            except ApiError as e:
                if e.status in (401, 403):
                    log("Auth rejected (%s). Run: yomo-agent login" % e)
                backoff = min(MAX_BACKOFF, max(LOOP_SEC, backoff * 2))
                log("send failed: %s (retry in %ss)" % (e, backoff))
            except (urllib.error.URLError, OSError, ValueError, KeyError) as e:
                backoff = min(MAX_BACKOFF, max(LOOP_SEC, backoff * 2))
                log("network error: %s (retry in %ss)" % (e, backoff))
        time.sleep(max(LOOP_SEC, backoff))


def cmd_status():
    cfg = load_config()
    print("config:  %s (%s)" % (CONFIG_PATH, "found" if cfg else "missing, run: yomo-agent login"))
    if cfg:
        print("base:    %s" % cfg.get("baseUrl"))
    print("song:    %s" % json.dumps(read_song(), ensure_ascii=False))
    print("idle:    %ss" % read_idle())
    return 0


def main():
    cmds = {"login": cmd_login, "run": cmd_run, "status": cmd_status}
    if len(sys.argv) != 2 or sys.argv[1] not in cmds:
        print("usage: yomo-agent {login|run|status}")
        return 2
    try:
        return cmds[sys.argv[1]]() or 0
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
