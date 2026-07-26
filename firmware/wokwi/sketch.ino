// Holecorn external scoreboard — ESP32 firmware.
//
// Subscribes to the game's state topic and mirrors the logged score onto two
// two-digit seven-segment displays. Deliberately dumb: every message carries
// the whole state, so there is nothing to reconcile and no resync on reconnect.
//
// Runs in the Wokwi simulator as-is (see README.md) and on real hardware with
// the broker settings changed.

#include <ArduinoJson.h>
#include <PubSubClient.h>
#include <SevSeg.h>
#include <WiFi.h>

#include "board_logic.h"

// ---------------------------------------------------------------- config ----

// Wokwi's simulated access point. Swap for your own network on real hardware.
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

// Must match the game code in the app's External scoreboard settings.
const char* GAME_CODE = "changeme";

// Wokwi projects on the free plan are public, so don't paste real credentials
// here — use the public test broker, or a broker user you can revoke.
#define USE_TLS 0

#if USE_TLS
#include <WiFiClientSecure.h>
const char* MQTT_HOST = "your-cluster.hivemq.cloud";
const uint16_t MQTT_PORT = 8883;
const char* MQTT_USER = "board";
const char* MQTT_PASS = "";
// Paste your broker's CA certificate. setInsecure() would connect without
// checking who answered, which defeats the point of using TLS at all.
const char* MQTT_CA_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
-----END CERTIFICATE-----
)EOF";
WiFiClientSecure net;
#else
const char* MQTT_HOST = "broker.emqx.io";
const uint16_t MQTT_PORT = 1883;
const char* MQTT_USER = nullptr;
const char* MQTT_PASS = nullptr;
WiFiClient net;
#endif

// PubSubClient's 256-byte default applies to the whole packet and drops
// oversized messages silently rather than erroring. A doubles game with 16-char
// ASCII names measures ~239 bytes with the topic and headers — under the limit,
// but with little enough headroom that one added field would not be. And the
// app caps names at 16 UTF-16 code units, not 16 bytes, so non-ASCII names
// reach ~367. 512 covers the worst case. See test_board_logic.cpp.
const uint16_t MQTT_BUFFER = 512;

const uint32_t RECONNECT_INTERVAL = 3000;
const uint32_t RENDER_INTERVAL = 100;
const uint32_t WINNER_BLINK = 500;

const uint8_t BRIGHT = 90;
const uint8_t DIM = 12;

// Segments A-G. The decimal point is unused, so SevSeg is told to skip it.
byte segmentPins[] = {13, 12, 14, 27, 26, 25, 33};
// Team A's two digits, then team B's.
byte digitPins[] = {18, 19, 21, 22};

// ----------------------------------------------------------------- state ----

SevSeg sevseg;
PubSubClient client(net);

char stateTopic[64];
char onlineTopic[64];

BoardState state;
long long lastV = 0;
bool haveState = false;
bool scorerOnline = false;
uint32_t lastReconnectAttempt = 0;
uint32_t lastRender = 0;

// --------------------------------------------------------------- display ----

// Dim instead of blanking when the score might be stale: the same choice the
// browser display makes, so a board nobody is feeding never looks authoritative.
void render() {
  const bool live = client.connected() && scorerOnline;

  if (!haveState) {
    sevseg.setChars("----");
    sevseg.setBrightness(DIM);
    return;
  }

  char digits[5];
  formatDigits(state.a, state.b, digits);

  // Flash the winner's pair by blanking it on alternate beats. The browser
  // display hollows the digits instead, keeping the score readable — not an
  // option here, because a seven-segment module can only switch whole segments.
  if (state.winner && (millis() / WINNER_BLINK) % 2 == 0) {
    const int offset = state.winner == 'a' ? 0 : 2;
    digits[offset] = ' ';
    digits[offset + 1] = ' ';
  }

  sevseg.setChars(digits);
  sevseg.setBrightness(live ? BRIGHT : DIM);
}

// ------------------------------------------------------------------- mqtt ----

void onMessage(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, onlineTopic) == 0) {
    // Retained, and set as the publisher's will, so this also fires when the
    // scoring phone disappears without saying goodbye.
    scorerOnline = length > 0 && payload[0] == '1';
    return;
  }

  BoardState next;
  if (!parseBoardState((const char*)payload, length, lastV, next)) return;

  state = next;
  if (next.v != 0) lastV = next.v;
  haveState = true;

  Serial.printf("score %d-%d (round %d, to %d)\n", state.a, state.b, state.round,
                state.target);
}

bool connectMqtt() {
  char clientId[40];
  snprintf(clientId, sizeof clientId, "holecorn-board-%06X",
           (unsigned)(ESP.getEfuseMac() & 0xFFFFFF));

  if (!client.connect(clientId, MQTT_USER, MQTT_PASS)) {
    Serial.printf("mqtt connect failed, rc=%d\n", client.state());
    return false;
  }

  client.subscribe(stateTopic, 1);
  client.subscribe(onlineTopic, 1);
  Serial.printf("subscribed to %s\n", stateTopic);
  return true;
}

// ------------------------------------------------------------------- main ----

void setup() {
  Serial.begin(115200);

  sevseg.begin(COMMON_CATHODE, sizeof digitPins, digitPins, segmentPins,
               /* resistorsOnSegments */ true, /* updateWithDelays */ false,
               /* leadingZeros */ false, /* disableDecPoint */ true);
  sevseg.setBrightness(DIM);
  sevseg.setChars("----");

  snprintf(stateTopic, sizeof stateTopic, "holecorn/%s/state", GAME_CODE);
  snprintf(onlineTopic, sizeof onlineTopic, "holecorn/%s/online", GAME_CODE);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  // Keep multiplexing while we wait, or the dashes won't be visible.
  while (WiFi.status() != WL_CONNECTED) sevseg.refreshDisplay();
  Serial.printf("wifi ok, ip %s\n", WiFi.localIP().toString().c_str());

#if USE_TLS
  net.setCACert(MQTT_CA_CERT);
#endif

  client.setBufferSize(MQTT_BUFFER);
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(onMessage);
}

void loop() {
  // Multiplexing the digits has to happen constantly, so nothing below may
  // block — that includes the reconnect backoff, hence the millis() timers.
  sevseg.refreshDisplay();

  if (client.connected()) {
    client.loop();
  } else if (millis() - lastReconnectAttempt > RECONNECT_INTERVAL) {
    lastReconnectAttempt = millis();
    scorerOnline = false;
    connectMqtt();
  }

  if (millis() - lastRender > RENDER_INTERVAL) {
    lastRender = millis();
    render();
  }
}
