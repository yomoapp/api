# Yomo Agent

بيبعت للـ wall الأغنية اللي شغالة (يوتيوب ميوزك في فايرفوكس) ووقت ما كيبورد/ماوس مش مستخدمين.

## اللابتوب الأول (لابتوب الشغل)

```bash
sudo apt install playerctl     # أو: sudo dnf install playerctl
./agent/install.sh
```

## تسجيل الدخول

```bash
yomo-agent login
systemctl --user restart yomo-agent
```

الباسورد مش بيتخزن، بس الـ refresh token في `~/.config/yomo/agent.json`.

## تشيك على الحالة

```bash
yomo-agent status
journalctl --user -u yomo-agent -f
```

## اللابتوب التاني (الـ wall)

```bash
./agent/wall-autostart.sh
gsettings set org.gnome.desktop.session idle-delay 0
```

سجّل دخول في الداشبورد مرة من فايرفوكس عادي، وبعدها أعد تشغيل اللابتوب وهيفتح الـ wall لوحده.
