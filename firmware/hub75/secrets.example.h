// Copy this file to secrets.h, in this same directory, and fill it in.
//
// secrets.h is gitignored and must stay that way: this is a public repo, and a WiFi
// password committed once is in the history forever, whatever the next commit does.
// This example file is the tracked one, so it holds placeholders only — if you find
// yourself typing a real password into *this* file, you are in the wrong one.
//
// It has to live beside hub75.ino rather than in host/, because the sketch folder is
// what Arduino puts on the include path.
#pragma once

// The sketch includes Arduino.h long before this, so this is for editors and language
// servers opening the file on its own rather than for the build.
#include <stdint.h>

static const char* WIFI_SSID = "your-network";
static const char* WIFI_PASS = "";

// Must match the game code in the app's External scoreboard settings.
static const char* GAME_CODE = "changeme";

// 0 for a plain broker on 1883, 1 for TLS on 8883. The offline plan in
// docs/OFFLINE-SCOREBOARD.md leaves this at 0 and keeps the broker on the LAN.
#define USE_TLS 0

#if USE_TLS
static const char* MQTT_HOST = "your-cluster.hivemq.cloud";
static const uint16_t MQTT_PORT = 8883;
static const char* MQTT_USER = "board";
static const char* MQTT_PASS = "";
static const char* MQTT_CA_CERT = R"EOF(
-----BEGIN CERTIFICATE-----
-----END CERTIFICATE-----
)EOF";
#else
// A public test broker, so anyone who guesses the game code can watch or spoof the
// score. Fine for bring-up on the bench; see docs/OFFLINE-SCOREBOARD.md before a game.
static const char* MQTT_HOST = "broker.emqx.io";
static const uint16_t MQTT_PORT = 1883;
static const char* MQTT_USER = nullptr;
static const char* MQTT_PASS = nullptr;
#endif
