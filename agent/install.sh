#!/usr/bin/env bash
# Installs the Yomo agent for the current user and starts it as a systemd user service.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
bin="$HOME/.local/bin/yomo-agent"
unit_dir="$HOME/.config/systemd/user"

mkdir -p "$HOME/.local/bin" "$unit_dir"
cp "$here/yomo-agent.py" "$bin"
chmod +x "$bin"

cat > "$unit_dir/yomo-agent.service" <<UNIT
[Unit]
Description=Yomo desktop agent (song + idle time)
After=graphical-session.target

[Service]
ExecStart=$bin run
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
UNIT

if ! command -v playerctl >/dev/null 2>&1; then
  echo "playerctl is missing. Install it:"
  echo "  sudo apt install playerctl   # Debian/Ubuntu"
  echo "  sudo dnf install playerctl   # Fedora"
fi

systemctl --user daemon-reload
systemctl --user enable --now yomo-agent

if [ ! -f "$HOME/.config/yomo/agent.json" ]; then
  echo
  echo "Not logged in yet. Run:  yomo-agent login"
  echo "then:                    systemctl --user restart yomo-agent"
fi
echo "Installed. Logs: journalctl --user -u yomo-agent -f"
