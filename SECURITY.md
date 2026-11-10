# Security / Безопасность

## What the bridge does / Что делает мост

**Network.** The bridge opens no ports and accepts no incoming connections. It connects out to:
- the QuestSound server, `https://questsound.ru` by default (`--server` changes it), to receive light commands and report the lamp list;
- the addresses you enter for your modules: Home Assistant, WLED, an MQTT broker, your web request URL, Yeelight lamps (found by an SSDP request on the local network, multicast 239.255.255.250:1982);
- `https://api.iot.yandex.net` (Yandex Smart Home API), only if you set up the Yandex module.

**What is sent to QuestSound:** the list of lamps (name, module, whether it has color), each module's status and error text, and which settings are filled in. Tokens and passwords are **never** sent back: for a secret field the site only learns "saved" / "not saved".

**When you save a module on the site,** its settings travel once from your browser through the QuestSound server to the bridge over HTTPS. The server passes them through and does not store or log them.

**Storage.** Settings and tokens are kept in `~/.questsound-light.json` on your computer, readable by your user only (mode 600 on Linux/macOS). Delete the file to forget everything.

**No extras.** No npm dependencies (only Node.js built-ins), no telemetry, no analytics, no auto-update, no code downloaded at run time. Everything the bridge runs is in this repository.

**Who can control your lamps:** whoever holds the bridge key, which is stored in your browser after pairing. The key is 128 random bits; the pairing code works once and expires after 10 minutes. To revoke: Lighting → Unlink on the site, or start the bridge with `--pair`.

---

**Сеть.** Мост не открывает порты и не принимает входящие подключения. Он сам обращается только к:
- серверу QuestSound (`https://questsound.ru`), чтобы получать команды света и сообщать список ламп;
- адресам, которые вы указали в подключениях (Home Assistant, WLED, MQTT, веб-запрос, лампы Yeelight в локальной сети);
- `https://api.iot.yandex.net`, только если настроен модуль «Яндекс».

**На QuestSound уходит** только список ламп, состояние подключений и то, какие поля заполнены. Токены и пароли обратно не отправляются никогда.

**Хранение:** `~/.questsound-light.json` на вашем компьютере, доступен только вашему пользователю.

**Ничего лишнего:** нет зависимостей npm, телеметрии, аналитики, автообновления и загрузки кода во время работы.

## Verifying a release / Проверка выпуска

Release archives are built by GitHub Actions ([release.yml](.github/workflows/release.yml)) from the tagged source, with Node.js downloaded from nodejs.org and checked against its official SHA256 sums. Each release has `SHA256SUMS` and a VirusTotal report link.

```bash
sha256sum -c SHA256SUMS          # Linux / macOS
certutil -hashfile questsound-light-win-x64.zip SHA256   # Windows
```

## Reporting a vulnerability / Сообщить об уязвимости

Email **questsound.help@gmail.com** or open a private security advisory on GitHub. Please don't post exploitable details in public issues.
