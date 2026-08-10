// Holecorn external scoreboard — HUB75 build. Hardware and layout in README.md.
//
// The panel refreshes from DMA in hardware, so loop() is free to block. The
// millis() timers below are kept only because a blocking reconnect would still
// stall MQTT, not because the digits would flicker.
#include <ArduinoJson.h>
#include <ESP32-HUB75-MatrixPanel-I2S-DMA.h>
#include <PubSubClient.h>
#include <WiFi.h>
#include <esp_random.h>

#include "render.h"

// ---------------------------------------------------------------- config ----

// The network, the broker and the game code live in secrets.h, which is gitignored.
// This is a public repo, so a WIFI_PASS filled in here would be in the history
// forever. Copy secrets.example.h to secrets.h and fill that in instead; it also
// owns USE_TLS, because which broker fields exist depends on it.
#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "No secrets.h. Copy firmware/hub75/secrets.example.h to secrets.h and fill it in."
#endif

#if USE_TLS
#include <WiFiClientSecure.h>
WiFiClientSecure net;
#else
WiFiClient net;
#endif

// See board_logic.h and test_board_logic.cpp: a doubles game with non-ASCII
// names reaches ~379 bytes including topic and headers.
const uint16_t MQTT_BUFFER = 512;

const uint32_t RECONNECT_INTERVAL = 5000;
const uint32_t WIFI_RETRY_INTERVAL = 10000;
const uint32_t RENDER_INTERVAL = 100;
const uint32_t WINNER_BLINK = 500;

// The wordmark at power-on. Nothing waits for it — WiFi and MQTT connect underneath —
// so it costs only the seconds the board would otherwise spend on the no-state dashes.
// Long enough for the eight letters to be thrown in one at a time (SPLASH_ANIM_MS in
// render.h, 3.58 s of this) and the finished mark then to be read for a beat. Mirrored in
// src/panelRender.js for the emulator.
const uint32_t SPLASH_MS = 5000;

// Redraw rate while the splash is up. RENDER_INTERVAL is sized for a score that
// changes once a round; the throws need frames, and they can have them because
// rendering does not block and there is no traffic to keep up with yet.
const uint32_t SPLASH_RENDER_INTERVAL = 25;

// The board's own UP and DOWN buttons, which step panel brightness through
// BRIGHTNESS_LEVELS. Neither has a pull-up fitted, so they read low when pressed,
// and both are clear of the HUB75 pinmap in setup().
const uint8_t BUTTON_UP_PIN = 6;
const uint8_t BUTTON_DOWN_PIN = 7;
const uint32_t BUTTON_LOCKOUT = 30;

// ----------------------------------------------------------------- state ----

MatrixPanel_I2S_DMA* panel = nullptr;
bool panelBegan = false;
PubSubClient client(net);

char stateTopic[64];
char onlineTopic[64];
char layoutTopic[64];
char lineupTopic[64];
char tieTopic[64];
char drawTopic[64];

BoardState state;
// Retained, and cleared by the phone when the first bag is thrown. A non-zero
// count is what puts the board on the pre-game form screen.
LineupState lineup;
TieState tie;
DrawState draw;
PanelLayout layout = PANEL_FULL;
long long lastV = 0;
bool haveState = false;
bool scorerOnline = false;
uint32_t lastReconnectAttempt = 0;
uint32_t lastWifiAttempt = 0;
uint32_t lastRender = 0;
uint32_t lastLive = 0;
bool wifiWasUp = false;
uint32_t splashStart = 0;
Rgb splashA, splashB;
uint8_t splashOrder[SPLASH_BOARDS][LOGO_LETTERS];
int brightnessStep = BRIGHTNESS_DEFAULT_STEP;

// --------------------------------------------------------------- buttons ----

struct Button {
  uint8_t pin;
  bool down;
  uint32_t settled;
};

Button buttonUp = {BUTTON_UP_PIN, false, 0};
Button buttonDown = {BUTTON_DOWN_PIN, false, 0};

// True once per press. A lockout rather than a sampling filter: loop() runs far
// more often than a contact bounces, so all that needs ignoring is a second edge
// arriving straight after an accepted one.
bool pressed(Button& b) {
  const bool down = digitalRead(b.pin) == LOW;
  if (down == b.down || millis() - b.settled < BUTTON_LOCKOUT) return false;
  b.down = down;
  b.settled = millis();
  return down;
}

// Both buttons are read every pass, whatever the first one says, or an edge on the
// other is missed rather than deferred.
void pollBrightness() {
  const bool up = pressed(buttonUp);
  const bool down = pressed(buttonDown);
  const int dir = up ? 1 : (down ? -1 : 0);
  if (dir == 0) return;

  const int next = stepBrightness(brightnessStep, dir);
  if (next == brightnessStep) return;
  brightnessStep = next;
  // Applied to the scan, not to the framebuffer, so it lands without a re-render.
  panel->setBrightness8(BRIGHTNESS_LEVELS[next]);
  Serial.printf("brightness %d\n", BRIGHTNESS_LEVELS[next]);
}

// --------------------------------------------------------------- display ----

// render.h draws through this, so the host preview and the panel run the same
// code path rather than two implementations that drift.
struct PanelCanvas {
  void px(int x, int y, uint8_t r, uint8_t g, uint8_t b) {
    panel->drawPixelRGB888(x, y, r, g, b);
  }
};

// The app's four team colours (PALETTE in src/scoring.js), which the splash draws two of.
// tools/test-firmware.mjs holds the two equal: this is in the sketch rather than render.h,
// so the pixel check never reaches it and a colour changed on the phone would leave the
// board booting into the old one. This cited App.jsx until the palette moved.
const Rgb SPLASH_PALETTE[] = {
    {0x44, 0x8d, 0xef}, {0xeb, 0x57, 0x57}, {0x27, 0xae, 0x60}, {0xf2, 0xc9, 0x4c}};
const uint8_t SPLASH_PALETTE_N = sizeof SPLASH_PALETTE / sizeof SPLASH_PALETTE[0];

// esp_random() rather than random(), which is seeded identically every boot and would
// show the same pair every time. The second index steps past the first over the
// remaining colours, so it cannot repeat it and needs no retry.
void pickSplashColors() {
  const uint8_t i = esp_random() % SPLASH_PALETTE_N;
  const uint8_t j = (i + 1 + esp_random() % (SPLASH_PALETTE_N - 1)) % SPLASH_PALETTE_N;
  splashA = SPLASH_PALETTE[i];
  splashB = SPLASH_PALETTE[j];
}

// And the order the letters land in, a shuffle per board. Here rather than in render.h for
// the same reason the colours are: that file has to give the same frame for the same
// inputs or the pixel check cannot hold it. It varies the animation and only that — the
// mark it settles into is the same one every boot.
void pickSplashOrder() {
  for (int board = 0; board < SPLASH_BOARDS; board++) {
    for (int slot = 0; slot < LOGO_LETTERS; slot++) splashOrder[board][slot] = slot;
    for (int i = LOGO_LETTERS - 1; i > 0; i--) {
      const int j = esp_random() % (i + 1);
      const uint8_t swap = splashOrder[board][i];
      splashOrder[board][i] = splashOrder[board][j];
      splashOrder[board][j] = swap;
    }
  }
}

// Indexes LINK_TEXT and LINK_COLORS: no wifi, wifi but no broker, subscribed. The
// splash draws it as a corner dot and the no-state screen writes it out in words;
// every other screen has something published on it, and there the whole panel dimming
// already says the link went.
//
// The third state is "subscribed", which on the no-state screen means the phone: with
// the link up and nothing retained on the state topic, the scorer is what is missing.
// `scorerOnline` is deliberately not consulted — it is false at that point too, so it
// would only say the same thing twice.
int connectState() {
  if (WiFi.status() != WL_CONNECTED) return LINK_NO_WIFI;
  return client.connected() ? LINK_NO_SCORER : LINK_NO_BROKER;
}

bool splashing() { return millis() - splashStart < SPLASH_MS; }

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

  // After the liveness bookkeeping above, not before it: a link that came up during
  // the splash and dropped straight after would otherwise have no stamp to run its
  // grace period from, and the board would dim the instant the splash cleared.
  if (splashing()) {
    drawSplash(canvas, splashA, splashB, connectState(), millis() - splashStart, splashOrder);
    return;
  }

  renderBoard(canvas, state, haveState, live, blinkOn, layout, &lineup, &tie, &draw,
              connectState());
}

// ------------------------------------------------------------------- mqtt ----

void onMessage(char* topic, byte* payload, unsigned int length) {
  if (strcmp(topic, onlineTopic) == 0) {
    // Retained, and set as the publisher's will, so this also fires when the
    // scoring phone disappears without saying goodbye.
    scorerOnline = length > 0 && payload[0] == '1';
    return;
  }

  if (strcmp(topic, layoutTopic) == 0) {
    // Retained, so this also arrives on connect. parseLayout leaves `layout`
    // alone for an id this build doesn't know, which keeps a board fed by a newer
    // app drawing what it already was.
    PanelLayout next;
    if (parseLayout((const char*)payload, length, next)) {
      layout = next;
      Serial.printf("layout %s\n", PANEL_LAYOUT_IDS[layout]);
    } else {
      Serial.println("unknown layout id, keeping the current one");
    }
    return;
  }

  if (strcmp(topic, drawTopic) == 0) {
    // Cleared when the draw finishes or is skipped, and nothing about starting a game
    // takes it down — so an empty payload, which parseDraw reports as `set` false, is
    // the only route off this card.
    if (parseDraw((const char*)payload, length, draw)) {
      Serial.printf("draw %s\n", draw.set ? draw.round : "cleared");
    } else {
      Serial.println("unusable draw card, keeping the current one");
    }
    return;
  }

  if (strcmp(topic, tieTopic) == 0) {
    // Retained and cleared at the first bag, exactly as the lineup is. An empty
    // payload is that clear, which parseTie reports as `set` false.
    if (parseTie((const char*)payload, length, tie)) {
      Serial.printf("tie %s\n", tie.set ? tie.round : "cleared");
    } else {
      Serial.println("unusable tie, keeping the current one");
    }
    return;
  }

  if (strcmp(topic, lineupTopic) == 0) {
    // An empty payload is the phone clearing the topic at the first bag, which
    // parseLineup reports as a count of 0 — that is the route back to the score.
    if (parseLineup((const char*)payload, length, lineup)) {
      Serial.printf("lineup %d rows\n", lineup.count);
    } else {
      Serial.println("unusable lineup, keeping the current one");
    }
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
  if (!client.subscribe(stateTopic, 1) || !client.subscribe(onlineTopic, 1) ||
      !client.subscribe(layoutTopic, 1) || !client.subscribe(lineupTopic, 1) ||
      !client.subscribe(tieTopic, 1) || !client.subscribe(drawTopic, 1)) {
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

  pinMode(BUTTON_UP_PIN, INPUT_PULLUP);
  pinMode(BUTTON_DOWN_PIN, INPUT_PULLUP);

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
  // Waveshare do not publish the driver IC, and this panel needs the FM6126A
  // register init: without it, first power-up drew one green square in a corner
  // and nothing else — no splash, no layout.
  mxconfig.driver = HUB75_I2S_CFG::FM6126A;
  // The library's default (true) garbles the right-most column, where ?panel=1
  // shows it blank: the edge pixel samples a clock edge early and picks up the
  // next word in the stream, which at chain 2 belongs to the other panel.
  mxconfig.clkphase = false;
  panel = new MatrixPanel_I2S_DMA(mxconfig);
  panelBegan = panel->begin();
  panel->setBrightness8(PANEL_BRIGHTNESS);
  panel->clearScreen();

  pickSplashColors();
  pickSplashOrder();
  splashStart = millis();
  render();

  snprintf(stateTopic, sizeof stateTopic, "holecorn/%s/state", GAME_CODE);
  snprintf(onlineTopic, sizeof onlineTopic, "holecorn/%s/online", GAME_CODE);
  snprintf(layoutTopic, sizeof layoutTopic, "holecorn/%s/layout", GAME_CODE);
  snprintf(lineupTopic, sizeof lineupTopic, "holecorn/%s/lineup", GAME_CODE);
  snprintf(tieTopic, sizeof tieTopic, "holecorn/%s/tie", GAME_CODE);
  snprintf(drawTopic, sizeof drawTopic, "holecorn/%s/draw", GAME_CODE);

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
  // Reported here rather than from setup(): begin() allocates the DMA buffers and
  // returns false rather than complaining, which on a panel is indistinguishable
  // from a wiring fault — and native USB CDC drops everything printed before a
  // host attaches, so saying it in setup() says it to nobody. Gated on time and
  // not on `Serial`, because macOS /dev/cu.* deliberately does not assert DTR, so
  // that test never becomes true for the way this board is actually read.
  static bool panelReported = false;
  if (!panelReported && millis() > 3000) {
    panelReported = true;
    if (panelBegan) Serial.printf("panel begin() ok, free heap %u\n", ESP.getFreeHeap());
    else Serial.println("panel begin() FAILED, DMA not allocated");
  }

  pollBrightness();

  if (ensureWifi()) {
    if (client.connected()) {
      client.loop();
    } else if (millis() - lastReconnectAttempt > RECONNECT_INTERVAL) {
      lastReconnectAttempt = millis();
      scorerOnline = false;
      connectMqtt();
    }
  }

  if (millis() - lastRender > (splashing() ? SPLASH_RENDER_INTERVAL : RENDER_INTERVAL)) {
    lastRender = millis();
    render();
  }
}
