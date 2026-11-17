#!/usr/bin/env bash
# Second laptop: opens the Yomo wall full screen (Firefox kiosk) at login.
set -euo pipefail
url="https://api-zeta-six-76.vercel.app/dashboard/#/wall"
dir="$HOME/.config/autostart"
mkdir -p "$dir"
cat > "$dir/yomo-wall.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=Yomo Wall
Exec=firefox --kiosk $url
X-GNOME-Autostart-enabled=true
DESKTOP
echo "Wrote $dir/yomo-wall.desktop"
echo
echo "Stop the screen from blanking/locking:"
echo "  gsettings set org.gnome.desktop.session idle-delay 0"
echo "  gsettings set org.gnome.desktop.screensaver lock-enabled false"
echo "Log in to the dashboard once in Firefox (normal window) before the first kiosk start."
