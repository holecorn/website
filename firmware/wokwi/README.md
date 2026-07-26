# Holecorn scoreboard firmware (Wokwi)

> **Status: reference, not a shipped build.** This targets a two-digit
> seven-segment board. The project settled on a tablet running the browser
> display instead, and if hardware ever happens the current recommendation is a
> HUB75 RGB panel — which this sketch does **not** target (see `tools/panel-preview/`).
> **`sketch.ino` has never been compiled or run**, on hardware or in Wokwi; only
> the pure logic in `board_logic.h` is tested. It is kept because that half — the
> parsing, the stale-`v` guard and the buffer sizing — carries over to any
> firmware. Treat the instructions below as untried.

ESP32 firmware for the external scoreboard. It subscribes to a game's state
topic and mirrors the **logged** score onto two two-digit seven-segment
displays. It holds no game rules: every message carries the whole state, so
there is nothing to reconcile and no resync after a reconnect.

Runs unchanged in the [Wokwi](https://wokwi.com/) simulator, so the whole chain —
phone → broker → board → digits — can be exercised before buying any hardware.

## Files

| File | |
| --- | --- |
| `sketch.ino` | WiFi, MQTT, reconnect and display refresh |
| `board_logic.h` | Message parsing and digit formatting; pure, no Arduino deps |
| `diagram.json` | Wokwi wiring (generated — see below) |
| `generate-diagram.mjs` | Regenerates `diagram.json` from the sketch's pin arrays |
| `test_board_logic.cpp` | Host test for `board_logic.h` |
| `libraries.txt` | Arduino libraries for Wokwi's library manager |

## Running it in Wokwi

1. Start a new ESP32 project at [wokwi.com](https://wokwi.com/).
2. Paste `sketch.ino`, and add `board_logic.h` as a second file.
3. Paste `diagram.json` into the diagram tab and `libraries.txt` into the
   library manager tab.
4. Set `GAME_CODE` to the code from the app's **External scoreboard** settings.
5. Start the simulation, then tick **Publish the score** in the app and commit a
   round. The digits follow.

Wokwi's simulated network is the open AP `Wokwi-GUEST`, and the free plan's
shared gateway allows **outbound** connections only — which is all this needs,
since the board subscribes and nothing ever connects to it.

**Free Wokwi projects are public.** Don't paste real broker credentials into
one. Use the public test broker (the default here) with an obscure game code, or
a broker user you can revoke.

## Display behaviour

- No message received yet: `----`, dimmed.
- Score known: `17 8`, blank-padded rather than zero-padded.
- Dimmed whenever the score might be stale — MQTT down, or the scorer's presence
  topic reporting `0`. This mirrors the browser display: a board nobody is
  feeding should never look authoritative.
- On a win, the winner's two digits flash.

## Regenerating the diagram

```bash
node firmware/wokwi/generate-diagram.mjs
```

The two displays share seven segment lines, so the wiring silently disagreeing
with the firmware is the likely failure. The generator reads `segmentPins[]` and
`digitPins[]` straight out of `sketch.ino` — change the pins there and re-run it,
rather than editing the JSON. It refuses to write a diagram where a GPIO is
wired twice, the pin count is wrong, or a display pin is left unconnected.

## Testing the logic on a host

`board_logic.h` has no Arduino dependencies, so it compiles against desktop
ArduinoJson:

```bash
cd firmware/wokwi
curl -sLo ArduinoJson.h https://github.com/bblanchon/ArduinoJson/releases/download/v7.4.3/ArduinoJson-v7.4.3.h
clang++ -std=c++17 -Wall -Wextra -I. -o /tmp/board_test test_board_logic.cpp && /tmp/board_test
```

It checks parsing against payloads captured from the app's publisher, the stale-`v`
guard, junk input, and that a non-null-terminated buffer is read by length.

This is worth doing for any change to parsing or digit formatting — it's how the
`MQTT_BUFFER` size was derived rather than guessed.

## Real hardware

Set `USE_TLS` to 1 and fill in the broker host, credentials and CA certificate.
The device connects over MQTTS on 8883 while the browser uses WSS on 8884 — same
broker, same topic, different ports.

Two things that will bite before the code does:

- **ESP32 is 2.4GHz-only** and recent iPhones default Personal Hotspot to 5GHz.
  Turn on **Maximize Compatibility** or the board never sees the network.
- **iOS hotspots sleep** with no clients attached, so the reconnect loop matters;
  it's deliberately non-blocking because the digits are software-multiplexed and
  any blocking wait shows up as visible flicker.
