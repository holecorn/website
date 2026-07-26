// Holecorn external scoreboard — HUB75 build. Hardware and layout in README.md.
//
// Unlike the SevSeg build in ../wokwi, the panel refreshes from DMA in
// hardware, so loop() is free to block. The millis() timers below are kept only
// because a blocking reconnect would still stall MQTT, not because the digits
// would flicker.
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <PubSubClient.h>
#include <WiFi.h>

#include "render.h"

// ---------------------------------------------------------------- config ----

const char* WIFI_SSID = "your-network";
const char* WIFI_PASS = "";

// Must match the game code in the app's External scoreboard settings.
const char* GAME_CODE = "changeme";

#define USE_TLS 0

#if USE_TLS
#include <WiFiClientSecure.h>
const char* MQTT_HOST = "your-cluster.hivemq.cloud";
const uint16_t MQTT_PORT = 8883;
const char* MQTT_USER = "board";
const char* MQTT_PASS = "";
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

// See ../wokwi/board_logic.h and test_board_logic.cpp: a doubles game with
// non-ASCII names reaches ~379 bytes including topic and headers.
const uint16_t MQTT_BUFFER = 512;

const uint32_t RECONNECT_INTERVAL = 5000;
const uint32_t WIFI_RETRY_INTERVAL = 10000;
const uint32_t RENDER_INTERVAL = 100;
const uint32_t WINNER_BLINK = 500;

// Evening play, so this is deliberately low. Raise it for daylight; measured
// duty is ~12% (see README), so the headroom is in the supply, not here.
const uint8_t PANEL_BRIGHTNESS = 40;

// ----------------------------------------------------------------- state ----

MatrixPanel_I2S_DMA* panel = nullptr;
PubSubClient client(net);

char stateTopic[64];
char onlineTopic[64];

BoardState state;
long long lastV = 0;
bool haveState = false;
bool scorerOnline = false;
uint32_t lastReconnectAttempt = 0;
uint32_t lastWifiAttempt = 0;
uint32_t lastRender = 0;
uint32_t lastLive = 0;
bool wifiWasUp = false;

// --------------------------------------------------------------- display ----

// render.h draws through this, so the host preview and the panel run the same
// code path rather than two implementations that drift.
struct PanelCanvas {
  void px(int x, int y, uint8_t r, uint8_t g, uint8_t b) {
    panel->drawPixelRGB888(x, y, r, g, b);
  }
};

void render() {
  // The grace period covers a dropped socket, not a phone that said goodbye:
  // an explicit will or "0" is authoritative, so dim at once and match what
  // Display.jsx does with the same message.
  const bool linked = client.connected();
  if (linked && scorerOnline) lastLive = millis();
  const bool live = scorerOnline && liveWithGrace(linked, millis(), lastLive);
  const bool blinkOn = (millis() / WINNER_BLINK) % 2 == 1;

  panel->fillScreen(0);
  PanelCanvas canvas;
  renderBoard(canvas, state, haveState, live, blinkOn);
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

// A phone hotspot switches itself off when nothing is connected, so the whole
// network vanishes and returns, not just the broker.
bool ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiWasUp) {
      wifiWasUp = true;
      Serial.printf("wifi ok, ip %s\n", WiFi.localIP().toString().c_str());
    }
    return true;
  }

  if (wifiWasUp) {
    wifiWasUp = false;
    scorerOnline = false;
    Serial.println("wifi lost");
  }
  if (millis() - lastWifiAttempt > WIFI_RETRY_INTERVAL) {
    lastWifiAttempt = millis();
    WiFi.begin(WIFI_SSID, WIFI_PASS);
  }
  return false;
}

bool connectMqtt() {
  char clientId[40];
  snprintf(clientId, sizeof clientId, "holecorn-board-%06X",
           (unsigned)(ESP.getEfuseMac() & 0xFFFFFF));

  if (!client.connect(clientId, MQTT_USER, MQTT_PASS)) {
    Serial.printf("mqtt connect failed, rc=%d\n", client.state());
    return false;
  }

  // A broker with per-topic permissions refuses the subscription rather than
  // the connection. Without this the board stays connected, never receives
  // anything, and never retries — it just dims. scoreboardLink.test.js covers
  // the same failure on the browser side.
  if (!client.subscribe(stateTopic, 1) || !client.subscribe(onlineTopic, 1)) {
    Serial.println("mqtt subscribe refused — check topic permissions");
    client.disconnect();
    return false;
  }
  Serial.printf("subscribed to %s\n", stateTopic);
  return true;
}

// ------------------------------------------------------------------- main ----

void setup() {
  Serial.begin(115200);

  // Pins must be given explicitly. The library has no MatrixPortal preset —
  // platform_detect.hpp falls through to generic ESP32-S3 defaults, and not one
  // of those pins matches this board, so the panel would stay dark with no
  // error. Values are Adafruit's own Protomatter mapping for the MatrixPortal
  // S3. E is unused at 32 rows; it is GPIO 21 if you move to 64-row panels.
  HUB75_I2S_CFG::i2s_pins pins = {
      42, 41, 40,  // R1, G1, B1
      38, 39, 37,  // R2, G2, B2
      45, 36, 48, 35, -1,  // A, B, C, D, E
      47, 14, 2,  // LAT, OE, CLK
  };
  HUB75_I2S_CFG mxconfig(64, 32, 2, pins);
  // Waveshare do not publish the driver IC. If the panel shows nothing or
  // garbage on first power-up, uncomment this before assuming a wiring fault.
  // mxconfig.driver = HUB75_I2S_CFG::FM6126A;
  panel = new MatrixPanel_I2S_DMA(mxconfig);
  panel->begin();
  panel->setBrightness8(PANEL_BRIGHTNESS);
  panel->clearScreen();
  render();

  snprintf(stateTopic, sizeof stateTopic, "holecorn/%s/state", GAME_CODE);
  snprintf(onlineTopic, sizeof onlineTopic, "holecorn/%s/online", GAME_CODE);

  // Deliberately not waiting for a connection here. loop() owns reconnection,
  // so blocking would only mean the board hangs on dashes if the hotspot is not
  // up yet — which, at a beach, it often will not be.
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

#if USE_TLS
  net.setCACert(MQTT_CA_CERT);
#endif

  client.setBufferSize(MQTT_BUFFER);
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(onMessage);
}

void loop() {
  if (ensureWifi()) {
    if (client.connected()) {
      client.loop();
    } else if (millis() - lastReconnectAttempt > RECONNECT_INTERVAL) {
      lastReconnectAttempt = millis();
      scorerOnline = false;
      connectMqtt();
    }
  }

  if (millis() - lastRender > RENDER_INTERVAL) {
    lastRender = millis();
    render();
  }
}
