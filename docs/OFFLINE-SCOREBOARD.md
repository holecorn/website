# Offline scoreboard

How to run the external scoreboard with **no internet and no third-party broker** —
a travel router carries the MQTT broker and the TLS certificate, the app stays on
`holecorn.com`, and the whole thing works in a field with no signal.

Status: **planned, not built.** The router was ordered 2026-07-29. Nothing in this
file describes shipped behaviour except the `vite.config.js` precache change.

Substitute one value throughout: the router's LAN address, written here as
`192.168.8.1`.

## Why it is shaped like this

The binding constraint is mixed content. `https://holecorn.com` cannot open
`ws://` or `http://` to a LAN address, and iOS Safari has no per-origin override.
So there are only two shapes available, and the choice between them is not about
the broker at all — it is about **which origin serves the page**.

Serving the app from the board over `http://` is far less work: no certificate, no
extra device, and it deletes machinery rather than adding it. It was rejected
because the origin change is not cosmetic:

- A different origin is a different `localStorage`, so the career archive splits
  in two along the line of whether the board happened to be present.
- Service workers need a secure context, so there is no install, and without an
  install there is no exemption from ITP deleting the archive after seven days.
- `navigator.wakeLock` is secure-context-only, so a tablet on `?display=1` sleeps
  mid-game.

Keeping the origin means the board needs a certificate the phone already trusts,
and that is the only reason a Linux box is in the design: an ESP32 terminating TLS
is a lot of firmware, where a router does it with a package and a cron job.

The app is unchanged apart from precaching the MQTT client. It loads from its
service worker cache with no network at all — verified in the built `sw.js`, which
registers a `NavigationRoute` bound to the cached `index.html`, so `?display=1`
and `?panel=1` resolve offline despite the query string.

## What was rejected, so nobody re-derives it

- **An iPhone Personal Hotspot.** It is cellular tethering: Apple document it as
  sharing the cellular connection, there is no supported client-to-client
  routing, and with no signal you cannot rely on it coming up at all. This is why
  the router is an access point rather than a client.
- **A Raspberry Pi 3 or 4.** Roughly doubles the panel's measured ~5 W, and it is
  the fussiest thing on the bus about the power bank's 3 A fold-back — which is
  the board's second safety bound (see `firmware/hub75/README.md`). Also SD-card
  corruption on unclean power-off, which needs an overlay root to fix.
- **A private CA.** Removes the renewal deadline (Apple's 398-day cap does not
  apply to user-installed roots, but the older **825-day** one does, so ~824-day
  leaves). Rejected because it needs a configuration profile installed on every
  device that will ever score or display, including guests'.
- **A wildcard or SAN certificate.** Joker's DNS API replaces TXT records at a
  label rather than appending, so it cannot hold the two values a wildcard needs.
  A single-name cert for `board.holecorn.com` never hits this. Do not be tempted
  into pairing it with the apex later.

## Hardware

- **GL.iNet GL-MT3000 (Beryl AX).** The deciding spec is 256 MiB flash and 512 MiB
  RAM; the Wi-Fi 6 is irrelevant to the board, which is 2.4 GHz-only. 5 V over
  USB-C. Vendor figure is `<8 W`.
- **Its own power bank.** Not shared with the board: a "15 W" bank is 15 W *total*
  across ports, so the router would eat the panel's budget and leave ~0.4 A of
  the 3 A fold-back — and a transmit burst tripping the bank takes the scoreboard
  down mid-game, which reads as a firmware bug. At 8 W a 10,000 mAh bank runs it
  ~3.7 hours; at the ~3 W it will actually draw serving one AP with no WAN,
  nearer 10.

## One-time setup

### 1. Firmware: try stock first

GL.iNet's own MT3000 firmware is OpenWrt 23.05 with the open `mt76` driver and
supports `opkg`, so try `opkg install mosquitto-ssl` on it before flashing
anything. Flash vanilla only if the packages fight — the specific conflict to
watch is `mosquitto-ssl` pulling `libwebsockets-openssl` against the
`libwebsockets-full` that a bundled web terminal may hold.

If you do flash: mainline supports it as `mediatek/filogic` / `glinet_gl-mt3000`,
upload the **sysupgrade** image through GL.iNet's own UI at `192.168.8.1`, and
**do not preserve configuration**. There is a U-Boot web recovery path back to
stock.

`mosquitto-ssl` is the package you need, not `mosquitto-nossl` — WebSockets are
compiled in only for the SSL variant, and the browser can only speak MQTT over
WebSocket, never raw TCP. `MOSQUITTO_LWS` defaults to enabled, so the official
prebuilt `.ipk` has it.

### 2. LAN address

Only the LAN section needs changing — OpenWrt's default `wan` is already a DHCP
client on the right port, so leave it alone rather than hand-writing a device
name.

```
# /etc/config/network
config interface 'lan'
    option proto 'static'
    option ipaddr '192.168.8.1'
    option netmask '255.255.255.0'
```

This must not match the subnet on the other side of the WAN port, or plugging it
into the home LAN breaks routing in a way that looks like a dead router.

### 3. Wireless: WPA2 only

```
# /etc/config/wireless — the 2.4 GHz radio (check `option band '2g'`;
# whether that is radio0 or radio1 varies)
config wifi-iface
    option device 'radio0'
    option network 'lan'
    option mode 'ap'
    option ssid 'holecorn'
    option encryption 'psk2'
    option ieee80211w '0'
    option key '<passphrase>'
    option disabled '0'
```

`psk2` and `ieee80211w '0'` are load-bearing. WPA3 — and `psk-mixed` in
practice — implies required management frame protection, which Arduino-core
ESP32s fail to associate with **and report as a generic failure that looks
exactly like a wrong password**. This is the likeliest first-boot symptom.

### 4. Make the name resolve without upstream

```
# /etc/config/dhcp, in the dnsmasq section
list address '/board.holecorn.com/192.168.8.1'
```

`dnsmasq` then answers authoritatively whether or not there is internet. This
also sidesteps a trap: OpenWrt enables DNS rebind protection by default, which
filters *upstream* answers containing private addresses — exactly what the public
A record is. With a local override upstream is never consulted, so it is never
filtered. Relying on the public record through this router instead would need
`rebind_domain` to whitelist it.

The public `board.holecorn.com` A record pointing at the same address is
belt-and-braces for devices that resolve *around* `dnsmasq`: iCloud Private
Relay, an encrypted-DNS profile, or iOS asking over cellular. It is not needed
for issuance — DNS-01 validates through a TXT record.

### 5. Broker

Two listeners, both bound to the LAN address so the WAN cannot reach them even
before the firewall gets a say.

```
# /etc/mosquitto/mosquitto.conf
per_listener_settings true

# The ESP32 board. Plain MQTT; it has no clock, so no TLS to validate.
listener 1883 192.168.8.1
protocol mqtt
allow_anonymous false
password_file /etc/mosquitto/passwd
acl_file /etc/mosquitto/aclfile

# Browsers. 443 so the URL needs no port.
listener 443 192.168.8.1
protocol websockets
certfile /etc/ssl/acme/board.holecorn.com.fullchain.crt
keyfile  /etc/ssl/acme/board.holecorn.com.key
allow_anonymous false
password_file /etc/mosquitto/passwd
acl_file /etc/mosquitto/aclfile
```

`per_listener_settings true` means the auth settings do not inherit, which is why
they are repeated. Putting the WSS listener on 443 means nothing else can have
it — that is fine, because the router serves no web content: the app comes from
the phone's own service worker cache.

The ACLs are tighter than the public broker could ever be. The publisher never
subscribes, so it needs write only:

```
# /etc/mosquitto/aclfile
user scorer
topic write holecorn/#

user viewer
topic read holecorn/#
```

`mosquitto_passwd -c /etc/mosquitto/passwd scorer`, then without `-c` for
`viewer`. The board and any tablet display both use `viewer`, so a leaked display
link cannot inject a score — worth having, since that link carries the password
in its query string.

**Check mosquitto can read the key.** It drops privileges to the `mosquitto`
user and `/etc/ssl/acme` is root-only. A TLS listener that silently fails to
start is almost always this.

### 6. Certificate

DNS-01 is not a preference — HTTP-01 needs Let's Encrypt to reach the router
inbound on port 80, which will not happen behind a home router.

```
# /etc/config/acme
config cert 'board'
    option enabled '1'
    option validation_method 'dns'
    option dns 'dns_joker'
    option keylength 'ec-256'
    list domains 'board.holecorn.com'
    list credentials 'JOKER_USERNAME=<dyndns user>'
    list credentials 'JOKER_PASSWORD=<dyndns pass>'
```

Those are the **Dynamic DNS** credentials from Joker's per-domain DNS panel, not
the account login. A staging issuance was proven working from a laptop on
2026-07-29, so the hook and the credentials are known good.

Confirm where the certificate lands and whether your `acme` version can reload
mosquitto for you (`list update_services` exists in newer versions); if not, add
an `acme.sh --reloadcmd` or a post-renew hook that restarts it. A renewed
certificate that nothing reloads is a listener serving the old one until the next
reboot.

If `acme-dnsapi` turns out not to bundle `dns_joker`, it is one shell script to
drop into its `dnsapi` directory.

### 7. Renew on plug-in, not on cron alone

The `acme` cron job runs daily, so a twenty-minute visit to the home LAN has a
good chance of missing it.

```sh
# /etc/hotplug.d/iface/99-acme
[ "$ACTION" = ifup ] && [ "$INTERFACE" = wan ] && /etc/init.d/acme start
```

### 8. Firewall

Leave the WAN zone's default reject policy alone — with the listeners bound to
the LAN address, that is two independent reasons the home network cannot reach
the broker. Do not add port forwards.

### 9. Devices, at home, with internet

- Load `holecorn.com` on every device that will ever score or display, so each
  has a populated service worker cache.
- **Add to Home Screen** on the scoring phone, and on the tablet add the
  `?display=1` URL. That second one matters: a plain Safari tab is subject to
  ITP's seven-day eviction, and an evicted cache means the tablet cannot load the
  app in a field with no signal. Installed web apps are exempt.
- Set the broker to `wss://board.holecorn.com` with the `scorer` credentials. If
  it will not connect, try `wss://board.holecorn.com/mqtt` — mosquitto serves the
  WebSocket at the root, but the path is the first thing to vary.
- Set the display link up by QR rather than typing; `uqr` generates it on-device,
  so that works offline too.

### 10. Firmware

In `firmware/hub75/secrets.h` — **not** in `hub75.ino`, which no longer holds these;
`secrets.h` is gitignored precisely so a passphrase like the one below cannot reach a
public repo. With `USE_TLS` left at `0`:

```c
static const char* WIFI_SSID = "holecorn";
static const char* WIFI_PASS = "<passphrase>";
static const char* MQTT_HOST = "192.168.8.1";   // the IP, not the name
static const uint16_t MQTT_PORT = 1883;
static const char* MQTT_USER = "viewer";
static const char* MQTT_PASS = "<viewer pass>";
```

Bring the board up against the public broker on home Wi-Fi **first**, then change
these. Debugging HUB75 wiring and a new network stack at the same time gives
every symptom two candidate causes.

## Every time you play

1. Switch on the router and the board.
2. Join the router's SSID on the phone and the tablet. **Expect iOS to say "no
   internet connection"** — that is correct, and it keeps routing local traffic.
3. Tap the Holecorn icon.

Nothing new is typed. The app is the installed PWA on `holecorn.com`, served from
cache; the only thing pointing at the router is the broker URL in its settings,
which lives under its own `localStorage` key and survives `New game`.

After deploying an app change, launch it once with internet so the service worker
updates — otherwise you play on whatever build was cached last.

## Keeping it alive

**The certificate is the one thing that still needs internet, and it fails
closed.** `acme` renews at 60 days of a ~90-day life, so the habit required is
plugging the router into the home LAN by ethernet most months, not a precise
schedule. If that habit does not stick, switch to a private CA at ~824 days and
accept the profile install.

An optional upgrade removes the remembering: the router is dual-band, so the
5 GHz radio can join home Wi-Fi as a client whenever it is in range while the AP
stays on 2.4 GHz. Get the ethernet version working first — one interface, one
failure mode.

## When it does not work

| Symptom | First thing to check |
| --- | --- |
| Board shows four dashes and stays dim | It never subscribed: `viewer` credentials, or the ACL |
| Board never joins the Wi-Fi | `psk2` and `ieee80211w '0'`; a WPA3/PMF refusal looks like a wrong password |
| App reports a broker error, no detail | Certificate expiry first, then whether mosquitto's TLS listener started at all (key permissions) |
| App says the subscription was refused | The ACL file — that message exists for exactly this |
| Name will not resolve on the phone | iCloud Private Relay, then the `dnsmasq` local address entry |
| Everything works at home, nothing in the field | The service worker cache was never populated on that device, or ITP evicted it because it is not installed |
