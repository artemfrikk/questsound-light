# QuestSound Light

[Русский](README.ru.md)

A bridge between [QuestSound](https://questsound.ru) and your smart lights: the tavern scene turns warm, a fight turns the room red, a night forest goes deep blue. The site sends a generic command ("this lamp: color, brightness, fade") and the bridge speaks your lamps' language.

> **Beta.** Expect delays, bugs and lamps doing unexpected things.

## Supported

| Connection | Lamps | Lightning flashes |
|---|---|---|
| **Home Assistant** | anything in HA: Zigbee, Wi-Fi, Hue, IKEA… | yes |
| **Yeelight** | Yeelight bulbs and strips over the local network | yes |
| **Yandex** | lamps in Yandex Smart Home ("Дом с Алисой"), official API | no (cloud, ~1 s delay; the bridge fades in steps) |
| **MQTT** | Zigbee2MQTT and anything listening on MQTT | yes |
| **WLED** | strips and lamps running WLED | yes |
| **Web request** | Node-RED and anything that takes HTTP | no |

Smooth fades and the calm "Breath" and "Fire" effects work on every connection.

## Install

You need a computer or a Raspberry Pi on the same network as the lamps, switched on during the game.

- **Windows:** download `questsound-light-win-x64.zip` from [Releases](../../releases/latest), unzip, run `start.cmd`. Node.js is inside. Windows may warn that the program is unsigned: "More info" → "Run anyway". The source is right here; archive checksums are in `SHA256SUMS`.
- **Raspberry Pi (64-bit) / Linux:** `tar xzf questsound-light-linux-arm64.tar.gz && cd questsound-light && ./node/bin/node questsound-light.mjs`. To start it with the Pi, see `questsound-light.service`.
- **With Node.js 18+ installed:** `git clone https://github.com/artemfrikk/questsound-light && cd questsound-light && node questsound-light.mjs`.

## Pairing

1. On every start the bridge prints a 6-character code.
2. On questsound.ru open the **Lighting** tab and enter the code.
3. Done: the bridge connects by itself. After “Unlink” on the site it shows a new code right away. To pair again: `node questsound-light.mjs --pair`.

## Connections

Set them up on the site (Lighting → Connections). Settings are stored in the bridge (`~/.questsound-light.json`); the site never sees saved tokens.

- **Home Assistant:** address (e.g. `http://homeassistant.local:8123`) and a long-lived access token (your HA profile → Security → Long-lived access tokens).
- **Yeelight:** turn on **LAN Control** for each lamp in the Yeelight app. The bridge finds lamps by itself; list IPs if it doesn't.
- **Yandex:** create an app at [oauth.yandex.ru](https://oauth.yandex.ru) (Web services, redirect URI `https://oauth.yandex.ru/verification_code`, scopes `iot:view` and `iot:control`), then open `https://oauth.yandex.ru/authorize?response_type=token&client_id=YOUR_CLIENT_ID` and paste the token on the site.
- **MQTT:** broker address and port (1883), login if any, and lamps as `name=topic` lines. The bridge publishes Zigbee2MQTT-style JSON to `topic/set`.
- **WLED:** device addresses, comma-separated.
- **Web request:** method, URL and body with `{{lamp}} {{r}} {{g}} {{b}} {{hex}} {{bri}}` (0–100) `{{bri255}} {{on}} {{fade}}` (seconds).

## Security

See [SECURITY.md](SECURITY.md): the bridge talks only to questsound.ru and the addresses you give it, keeps tokens in a local file, and has no dependencies, telemetry or auto-update.

## Writing a module

A module is a file in `modules/` exporting `{ id, name, rate, settings, start(settings), discover(), set(id, target), stop() }`, where `target` is `{ color: '#rrggbb', bri: 0..1, fade: seconds }` or `'off'`. Cloud APIs with one shared limit may define `setMany({ id: target })` instead of `set`. If the lamps can't fade, set `fade: false` and the bridge fades in steps. Add it to `modules/index.mjs`.

## License

MIT
