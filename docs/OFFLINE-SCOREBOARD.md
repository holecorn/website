# Offline scoreboard

How to run the external scoreboard with **no internet and no third-party broker** —
a travel router carries the MQTT broker and the TLS certificate, the app stays on
`holecorn.com`, and the whole thing works in a field with no signal.

Status: **working end to end with no internet, as of 2026-08-10.** As of 2026-08-04
the board runs against mosquitto on the
router: packages installed on **stock GL.iNet firmware** with no need to flash
vanilla, a plain 1883 listener bound to the LAN address, and the LED board joining
the router's 2.4 GHz AP and rendering a hand-published retained state. Steps 1, 3
and 5's plain listener are therefore proven rather than planned.

**2026-08-10 took it most of the rest of the way.** A production Let's Encrypt
certificate for `board.holecorn.com` was issued on the router over DNS-01, deployed
to `/etc/mosquitto/certs`, and mosquitto now reports `Opening websockets listen
socket on port 8884` alongside the plain 1883 one. Steps 5 and 6 are therefore
proven, and step 6 is written against `acme` 3.0.1 as read off this router rather
than against the newer package generation this file first assumed — the option
names, the credential route and where a certificate lands all differ.

A client with an ordinary trust store then verified the chain end to end —
`openssl s_client -connect board.holecorn.com:8884` returning `Verify return code:
0 (ok)` — which is the result that predicts an iPhone connecting, and the first
thing in this whole design that could not be proven any other way.

The ACLs are proven on 1883 the same day, by refusal rather than by connection:
`viewer` is refused a publish, and `scorer` does not receive a retained message
that `viewer` does. That took two attempts — the listener was open at first, and
then the read test could not fail — so read the verification note in step 5 before
trusting a green run.

**The app then published over it from an iPhone the same night** — resolving the
name locally, completing TLS against the new certificate, authenticating as
`scorer` over WebSockets on 8884, and getting `rc0` on a retained QoS 1 publish to
`holecorn/<code>/state`. That closes every step from 1 to 9 for the scoring phone.

Renew-on-plug (step 7) is in place the same night.

**The whole chain then ran with no WAN on 2026-08-10**, which is the result this
document exists for: the board flashed with the offline credentials, the router
plugged in with nothing upstream, a phone joined to its AP, and the app scoring
onto the panel. Every numbered step is therefore proven rather than planned, and
proven in the configuration it will actually be used in — no internet anywhere in
the path.

**What is left is not this design**: the tablet on `?display=1` has still not
connected to this broker, and the backer and the mount are unbuilt (see
`firmware/hub75/README.md`).

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
- **One supply, shared with the board — and the reason it used to need its own is
  gone.** That reason was real while the supply was a 10,000 mAh bank: a "15 W" bank is
  15 W *total* across ports, so the router would have eaten the panel's budget and left
  ~0.4 A of the 3 A fold-back, and a transmit burst tripping the bank takes the
  scoreboard down mid-game, which reads as a firmware bug. **An Anker SOLIX C300X gives
  5 V/3 A on each port independently**, so nothing competes: board on USB-C1, router on
  USB-C2, measured 2026-08-10 at 2 W each and **48 h for the pair**. Two banks to
  remember to charge was the cost, and it bought nothing once the ports stopped sharing
  a budget.
  - **Power the router from USB-C, not from its own mains plug in the station's AC
    socket.** The plug it ships with is a plain 5 V/3 A USB-C brick, so that route runs
    DC→AC→DC to recreate a supply the station already has: measured against a ~2 W
    router, the inverter's own overhead is the larger load, and the station shuts an AC
    outlet down after 2 h it reads as standby. The C-to-C cable is the whole answer.
  - **If the router won't power up over C-to-C, try A-to-C before suspecting the port.**
    Known GL-MT3000 behaviour with PD sources — a CC-negotiation quirk, not a fault. The
    station's USB-A port runs a 2 W router fine, but it shares a 20 W ceiling with
    USB-C1, so don't hang the phone on that pair as well.
  - **Switch the station on first, then plug the board in.** With the board's cable
    already in at switch-on the port never comes up, on any of the three; the router is
    unaffected and starts from cold on USB-C2. Cause unattributed after five mechanisms
    were ruled out — `firmware/hub75/README.md`'s `Running off a battery` has the list.
  - **Don't swap the two over.** Board on USB-C1 and router on USB-C2 is the better of
    the two arrangements: the router additionally fails to cold-start on USB-C1, which
    is the CC quirk above, so swapping them gets you *neither* device rather than one.

## One-time setup

### Getting a shell

Deliberately unnumbered: every step below needs it, and the ten numbered steps are
cross-referenced from the status notes above.

```bash
ssh-copy-id root@192.168.8.1
ssh -o PasswordAuthentication=no root@192.168.8.1 'echo ok'
```

Root's password is the GL.iNet admin password — the web UI and the shell are the
same account. **The second line is the point of the pair**: it proves the *key*
authenticated, which the first cannot tell you, because a successful
`ssh-copy-id` says only that the password worked.

**If it prompts, the key is in a file dropbear does not read.** `ssh-copy-id`
writes `~/.ssh/authorized_keys`; OpenWrt's dropbear reads root's keys from
`/etc/dropbear/authorized_keys`. Whether it also falls back to the home directory
varies by build and **is still unknown here** — on this router `/root/.ssh` does not
exist at all, so nothing has tested the fallback. Putting the key where it is
certainly read is one line and settles it:

```bash
ssh root@192.168.8.1 \
  'cat >> /etc/dropbear/authorized_keys && chmod 600 /etc/dropbear/authorized_keys' \
  < ~/.ssh/id_ed25519.pub
```

**Done on 2026-08-10 with a key created for this router**, and confirmed by the
no-password check above. `/etc/dropbear/authorized_keys` is mode 600 and holds the
one key. A `beryl` host alias in `~/.ssh/config` makes every `root@192.168.8.1`
below a plain `ssh beryl`.

**The `chmod` is load-bearing.** Dropbear ignores an `authorized_keys` that is
group- or world-writable and logs nothing about it, so the symptom is identical to
a key it has never seen. LuCI's System → Administration → SSH-Keys writes the same
file if you would rather paste than pipe.

**Leave password authentication on.** SSH is reachable only from the LAN — step 8's
WAN reject policy — and the recovery from a lost key on a device with no console is
the U-Boot path in step 1, which wipes the other nine steps with it.

**A factory reset or a `sysupgrade` without preserving configuration takes the key
too.** That is the same restore as everything else here, so it is worth knowing
rather than worth planning around.

### 1. Firmware: try stock first

GL.iNet's own MT3000 firmware is OpenWrt 23.05 with the open `mt76` driver and
supports `opkg`, so try `opkg install mosquitto-ssl` on it before flashing
anything. Flash vanilla only if the packages fight — the specific conflict to
watch is `mosquitto-ssl` pulling `libwebsockets-openssl` against the
`libwebsockets-full` that a bundled web terminal may hold.

**Answered on 2026-08-04: stock is enough, and the conflict did not happen.**
`opkg status mosquitto-ssl` reports 2.0.15-1 installed with `libwebsockets-openssl`
among its satisfied dependencies, so WebSockets are present and no flash was needed.
That version also matches what step 5 assumes — `per_listener_settings`, explicit
`allow_anonymous`, and listeners that bind only where you say.

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

The public `board.holecorn.com` A record pointing at the same address is worth
adding, but **only for the devices that bypass `dnsmasq` while internet is
available** — a DoH profile or iCloud Private Relay, at home, during setup. It is
not needed for issuance, since DNS-01 validates through a TXT record at
`_acme-challenge.board`, and **it cannot help in the field**: every way of
resolving around `dnsmasq` needs the internet that is missing there, so those
devices fall back to the network's own resolver and the local override answers.
The record is also unreliable by nature — resolvers commonly strip private
addresses from public answers as rebind protection, including possibly the home
router you are standing next to — so treat it as a convenience and never as the
mechanism.

### 5. Broker

**The file below is authoritative here, but confirm it after any reflash.** The
OpenWrt package ships a UCI wrapper — `/etc/config/mosquitto` is one of its
conffiles — and with `use_uci` enabled the init script *generates* the running
config, so edits to `/etc/mosquitto/mosquitto.conf` would be read by nothing while
the broker carried on as before: silent, and indistinguishable from a config that
didn't take for some subtler reason. Measured on 2026-08-04, this router ships
`use_uci '0'`, so hand-writing the file is correct and no UCI translation is needed.
`uci show mosquitto` is the one-line check if the router is ever rebuilt.

Two listeners, both bound to the LAN address so the WAN cannot reach them even
before the firewall gets a say.

```
# /etc/mosquitto/mosquitto.conf
per_listener_settings true
log_dest syslog
log_type error
log_type warning
log_type notice
log_type information

# The ESP32 board. Plain MQTT; it has no clock, so no TLS to validate.
listener 1883 192.168.8.1
protocol mqtt
allow_anonymous false
password_file /etc/mosquitto/passwd
acl_file /etc/mosquitto/aclfile

# Browsers. 8884 and not 443 — see below.
listener 8884 192.168.8.1
protocol websockets
certfile /etc/mosquitto/certs/fullchain.cer
keyfile  /etc/mosquitto/certs/board.holecorn.com.key
allow_anonymous false
password_file /etc/mosquitto/passwd
acl_file /etc/mosquitto/aclfile
```

`per_listener_settings true` means the auth settings do not inherit, which is why
they are repeated.

**A listener missing `acl_file` is unrestricted, and nothing says so.** It is not
an error, it logs nothing, and startup looks identical — same for `password_file`
when `allow_anonymous` is true. Both were missing from the 1883 block on
2026-08-10 while 8884 had all three, so the board's listener was open to anyone on
the Wi-Fi and four ACL tests passed against a broker enforcing nothing. **Verify
by refusal, per listener**, never by a successful connection:

```sh
# write side: must report Not authorized
mosquitto_pub -h board.holecorn.com -p 1883 -u viewer -P '<pass>' \
  -t holecorn/test -m hi -q 1 -V mqttv5

# read side: leave a retained message, then compare who receives it
mosquitto_pub -h board.holecorn.com -p 1883 -u scorer -P '<pass>' \
  -t holecorn/test -m hi -r -q 1 -V mqttv5
mosquitto_sub -h board.holecorn.com -p 1883 -u viewer -P '<pass>' \
  -t 'holecorn/#' -v -W 3        # expect: holecorn/test hi
mosquitto_sub -h board.holecorn.com -p 1883 -u scorer -P '<pass>' \
  -t 'holecorn/#' -v -W 3        # expect: nothing
mosquitto_pub -h board.holecorn.com -p 1883 -u scorer -P '<pass>' \
  -t holecorn/test -r -n         # clear it before the board sees it
```

**`-q 1 -V mqttv5` is load-bearing on the write test**: under MQTT 3.1.1 the broker
drops an unauthorised publish silently and the client exits 0, so the refusal is
invisible.

**The read side has to be tested by delivery, because there is no refusal to
observe.** Measured on 2.0.15, 2026-08-10: mosquitto accepts a subscription from a
user with no read access and enforces when the message is delivered instead — on a
wildcard *and* on a concrete topic, so `mosquitto_sub` reports success either way
and `Timed out` is what both a permitted and a forbidden subscriber print when
there is nothing to receive. **A read test with nothing retained on the tree cannot
fail**, which is how an inert ACL passed here once already.

`mosquitto_pub` cannot speak WebSockets, so 8884's copy of the same settings is
only ever proven by the app itself. It also fixes where the two log lines go: **global options must
appear before the first `listener`**, so moving them down the file silently
un-sets them.

**`log_type` takes one type per line, and extra words on a line are dropped
silently.** `log_type error warning notice information` sets *error only*: the
broker starts, serves, and says nothing, because everything worth reading is
`notice` or `information`. Measured 2026-08-10 — it looked exactly like logging
having failed again.

**`log_type all` for bring-up, then back to the four lines above.** Debug logs a
line per published message, and `logread` is a fixed-size ring in RAM — so a game's
traffic rolls out the connection and TLS messages that are the ones worth having
when something fails in a field.

**Without `log_dest` mosquitto logs nowhere, and that costs you the whole
troubleshooting table below.** A hand-written config leaves it at the default and
procd discards the service's stderr, so `logread -e mosquitto` matches nothing —
which reads as "the broker is fine" rather than "you cannot see the broker".
Confirmed on the router on 2026-08-09: added, restarted, and the log appears.
The symptom this matters most for is the one two paragraphs down — a TLS listener
that fails to start does so silently, and the log is the only thing that says
which of the certificate paths, the key permissions or the port was to blame.

**443 was the plan and it is not available.** This file used to claim nothing else
could want it, "because the router serves no web content". Measured on 2026-08-04:
stock GL.iNet firmware runs **nginx on 443**, serving its own admin console with a
self-signed `console.gl-inet.com` certificate. So mosquitto would not have bound,
and the symptom would have been a TLS listener silently failing to start — which
this file already tells you to blame on key permissions, so the wrong cause was
written down and waiting.

**8884 costs a port in one URL, entered once.** The claimed benefit of 443 was that
the broker URL needs no port, and the URL is typed into the app's settings a single
time and shared to the tablet by QR — so this is cosmetic, and the path may need
varying anyway. Three alternatives were considered and are worse:

- **Move nginx off 443.** Fighting the vendor's web server for a cosmetic win, and
  a firmware update puts it back.
- **Reverse-proxy `/mqtt` through nginx** to a plain websockets listener on
  localhost. Genuinely tempting — nginx already terminates TLS, so mosquitto would
  need no certificate and the key-permissions trap disappears — but it moves the
  certificate into a vendor-managed config that firmware updates overwrite.
- **Flash vanilla OpenWrt**, which has no nginx on 443. A large change to reclaim a
  port number, and the packages install fine on stock.

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

**The app has fields for both pairs, and it needs them or this split buys
nothing.** `scorer` goes in **Scorer username**/**Scorer password** and `viewer`
in **Display username**/**Display password**; the display link then carries
`viewer` and the writable pair never leaves the phone. Left blank the link falls
back to the scorer's, which is the shape that made these ACLs decorative — the
aclfile was written before the app could tell the two apart.
`.claude/rules/scoreboard.md` holds the app side.

**The LED panel was already on `viewer`** — `MQTT_USER` in its gitignored
`secrets.h` — so it was only the browser board, `?display=1` and `?panel=1`, that
still connected as the scorer, because the link is where it gets its credentials
from. That is the gap these fields close, and it is why the firmware needs no
change.

**The certificate is copied here rather than read where `acme` leaves it.**
mosquitto drops privileges to the `mosquitto` user, and acme.sh creates its
domain directories mode 0700 — so `/etc/acme` cannot even be traversed, and
loosening it lasts exactly until the next renewal writes fresh files with fresh
modes. Step 6's renew hook is what puts a readable copy in `/etc/mosquitto/certs`.
A TLS listener that silently fails to start is almost always this.

### 6. Certificate

DNS-01 is not a preference — HTTP-01 needs Let's Encrypt to reach the router
inbound on port 80, which will not happen behind a home router.

**The schema below is `acme` 3.0.1's, read out of `/usr/lib/acme/run-acme` on the
router on 2026-08-09 rather than from documentation.** That matters because the
newer `acme-acmesh` split renames enough of it to break every one of these steps,
and this file previously carried that newer shape — which would have failed in
three separate places, all of them quietly. Check `opkg list-installed | grep acme`
after any reflash before trusting this. `dns_joker` ships in `acme-dnsapi` at
`/usr/lib/acme/dnsapi/dns_joker.sh`; nothing had to be added.

```
# /etc/config/acme
config acme
    option account_email '<address>'
    option state_dir '/etc/acme'

config cert 'board'
    option enabled '1'
    option use_staging '1'
    option dns 'dns_joker'
    option keylength 'ec-256'
    list domains 'board.holecorn.com'
```

`account_email` is **mandatory, not advisory** — `run-acme` exits when it is
empty, which reads as the package being broken rather than as one missing option.
It has to be a real address at a domain that can receive mail, because Boulder
rejects contact domains with no MX or A record, but **it does not need an inbox
anyone reads**: Let's Encrypt stopped sending expiration notifications on
2025-06-04 and no longer stores addresses given over ACME. Don't set it expecting
a warning — see **Keeping it alive**.

Three things this version does not have, each of which is accepted as UCI and
then read by nothing:

- **No `validation_method`.** DNS-01 is chosen by `dns` being set and `webroot`
  being unset. A config carrying the option instead attempts HTTP-01 and times
  out waiting for an inbound connection that a home router will never allow —
  a network symptom for a configuration cause.
- **No `credentials` list.** The credentials go in acme.sh's own
  `/etc/acme/account.conf` instead, seeded once by hand (below). `user_setup` is
  not an alternative route: `run-acme` executes it as a subprocess, so anything
  it exports dies with it.
- **No copy to `/etc/ssl/acme`.** 3.0.1 leaves the certificate in acme.sh's
  domain directory and points consumers at it in place. With an EC key that
  directory takes an `_ecc` suffix — `/etc/acme/board.holecorn.com_ecc/` — and
  holds `fullchain.cer` beside `board.holecorn.com.key`.

Seed the credentials with one manual staging issuance. `dns_joker.sh` reads the
variables from the environment and writes them back to `account.conf`, so every
later cron or hotplug run picks them up with nothing in UCI:

```sh
export JOKER_USERNAME='<dyndns user>' JOKER_PASSWORD='<dyndns pass>'
/usr/lib/acme/acme.sh --home /etc/acme --issue --staging --dns dns_joker \
  -d board.holecorn.com --keylength ec-256 \
  --renew-hook /etc/mosquitto/deploy-cert.sh
grep -i joker /etc/acme/account.conf     # expect SAVED_JOKER_* written back
```

Those are the **Dynamic DNS** credentials from Joker's per-domain DNS panel, not
the account login. A staging issuance was proven working from a laptop on
2026-07-29, so the hook and the credentials are known good.

**Switching to production needs two flags, and dropping `--staging` is neither of
them.** Both were hit on 2026-08-10:

```sh
/usr/lib/acme/acme.sh --home /etc/acme --issue --force --server letsencrypt \
  --dns dns_joker -d board.holecorn.com --keylength ec-256 \
  --renew-hook /etc/mosquitto/deploy-cert.sh
/usr/lib/acme/acme.sh --home /etc/acme --set-default-ca --server letsencrypt
```

- **`--force`.** Staging and production write to the same `_ecc` directory, so
  acme.sh finds the staging certificate, sees it is not due for 59 days and skips
  — reporting `Domains not changed` and exiting 0. Nothing is wrong on screen and
  the file on disk is still the untrusted one.
- **`--server letsencrypt`.** acme.sh 3.0.0 changed its default CA to **ZeroSSL**,
  which needs EAB credentials, so without this the run aims somewhere you have no
  account. `--staging` is unaffected — it names Let's Encrypt's staging endpoint
  specifically rather than the default CA's, which is why the staging run worked
  and made the default look harmless. `--set-default-ca` and `option acme_server
  'letsencrypt'` in the cert section both pin it, for the two ways an issuance can
  be triggered later.

**Check the issuer rather than the exit code**, since both CAs write to the same
path:

```sh
openssl x509 -in /etc/acme/board.holecorn.com_ecc/fullchain.cer -noout -issuer -dates
```

Staging carries `O = (STAGING) Let's Encrypt`; production does not. Do not key on
the intermediate's name — production issued `YE2` here, from the Generation Y
hierarchy live since 2026-05-13, and the older `R10`/`E5` names are already wrong.
`notBefore` an hour in the past is normal: Boulder backdates it for clock skew, so
a fresh certificate can look as though it predates the command that made it.

**`fullchain.cer` is four certificates deep and needs to stay that way** —
measured 2026-08-10, leaf and three above it, so a device that trusts only
`ISRG Root X1` still validates the Generation Y chain. That is what makes a guest's
older iPad a non-problem, and it is why `certfile` is the full chain rather than
the leaf.

**The renew hook does not fire on the first issue.** It is a *renew* hook, so run
`/etc/mosquitto/deploy-cert.sh` by hand once after issuing, or the listener has no
certificate to bind and fails silently — the symptom step 5 warns about.

**Production allows 5 duplicate certificates per name per week.** One forced issue
is fine; a loop of them locks the name until the window rolls, and there is no
staging fallback that helps, because a trusted certificate is the entire point.

**Spend one of those five rehearsing the renewal, because nothing else tests it.**
The hook does not fire on an issue, so after the initial setup the unattended path
— renew, copy, restart, serve — has never run, and it next runs on its own in a
field months later. Done 2026-08-10 with
`acme.sh --home /etc/acme --renew --force --ecc -d board.holecorn.com`, and it
worked end to end. `--ecc` is required or acme.sh looks in the wrong directory.
**Check the dates over the wire, not the exit code**: both certificates are valid,
so `Verify return code: 0` is returned by a broker still holding the old one in
memory. Only

```sh
openssl s_client -connect board.holecorn.com:8884 </dev/null 2>/dev/null \
  | openssl x509 -noout -dates
```

distinguishes a deployed certificate from a *served* one.

**The reload is `--renew-hook` and not a UCI option, because this version has
none that fit.** `update_uhttpd` and `update_nginx` are the only reload paths in
the schema. `user_cleanup` runs from `run-acme`'s own cleanup path, tied to the
issuance *attempt* rather than to a successful renewal, so it would bounce the
broker on every failed daily cron run — which is the normal state, since the
router usually has no WAN. A renew hook fires only on a real renewal and lives in
the domain's own conf, so it survives a package upgrade that renames options.
**It is rewritten by a re-issue**, so pass the flag again on every `--issue`,
including the switch from staging to production.

```sh
# /etc/mosquitto/deploy-cert.sh, chmod +x
#!/bin/sh
umask 077
d=/etc/acme/board.holecorn.com_ecc
c=/etc/mosquitto/certs

mkdir -p "$c"
cp "$d/fullchain.cer" "$c/fullchain.cer"
cp "$d/board.holecorn.com.key" "$c/board.holecorn.com.key"

chown -R mosquitto:mosquitto "$c"
chmod 750 "$c"
chmod 644 "$c/fullchain.cer"
chmod 600 "$c/board.holecorn.com.key"

/etc/init.d/mosquitto restart
```

**No `install` — BusyBox has not got it**, and it is not worth pulling
`coreutils-install` in for four lines. `umask 077` replaces the mode arguments
that command would have taken: BusyBox `cp` does not preserve modes without `-p`,
so without it the key exists world-readable between the copy and the `chmod`.

**A restart, not a SIGHUP, and that is a deletion rather than a compromise.** The
hook reloaded with `kill -HUP` first, on the reasoning that a restart drops every
client and takes the retained messages with it. But **the hook only ever fires
while the router is plugged into the home LAN**, which is by definition not during
a game — so there is nothing to disturb, and the property HUP was buying is one
this deployment does not need. What it cost was an open question: mosquitto 2.0
handles SIGHUP and logs `Reloading config`, but whether that re-reads `certfile`
and `keyfile` was never established, and a hook that reloads everything *except*
the certificate serves the expired one until the next reboot — failing in
November, in a field, having logged success in August. Restarting removes the
question. Don't add `persistence` to make HUP unnecessary either; it buys nothing
here and writes to the router's flash on a timer.

Two things the reload attempts turned up that outlive the decision, both from
2026-08-10:

- **A SIGHUP reload runs as the unprivileged `mosquitto` user, where startup ran
  as root.** So every file the config names — and the config itself — has to be
  readable by that user, not merely by root. A `root:root 0600` `mosquitto.conf`
  loads once at boot and fails every reload after it. This is the same root cause
  as the `/etc/acme` note in step 5, and the general form is: *anything mosquitto
  touches after startup must be readable post-drop.*
- **Listeners cannot be added or removed by a reload.** Mosquitto logs
  `It is not currently possible to add/remove listeners when reloading the config
  file` and carries on with the set it already has, so adding the 8884 listener to
  a running broker needs `/etc/init.d/mosquitto restart`. The config on disk and
  the config in memory disagree in the meantime, and nothing on screen says so.

### 7. Renew on plug-in, not on cron alone

The `acme` cron job runs daily, so a twenty-minute visit to the home LAN has a
good chance of missing it.

```sh
# /etc/hotplug.d/iface/99-acme
[ "$ACTION" = ifup ] && [ "$INTERFACE" = wan ] && /etc/init.d/acme start
```

This is also what fires step 6's renew hook, so the copy into
`/etc/mosquitto/certs` and the restart happen on the same visit as the renewal.

**Prove it fires, by replugging the WAN and reading `logread -e acme`** — expect
acme to run, find the previous cert config and report the next renewal date. A
hotplug script that never triggers is completely silent, and the first symptom
would be an expired certificate in a field months later. The usual cause is the
interface not being called `wan` on this firmware; `ubus call
network.interface.wan status` settles it.

**`sh: out of range` appears four times in that output and is expected.** It comes
from the port-80 pre-check `run-acme` performs whatever the validation method — the
block that stops nginx for standalone mode, which DNS-01 never uses. Verified
2026-08-10: the script has no `shift` at all and one arithmetic expansion, a retry
counter inside that same unused block. A successful renew-on-plug looks like four
errors and is not one.

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
- Set the broker to `wss://board.holecorn.com:8884` with the `scorer` credentials.
  If it will not connect, try `wss://board.holecorn.com:8884/mqtt` — mosquitto serves
  the WebSocket at the root, but the path is the first thing to vary. The port is not
  optional; 443 is nginx's, see step 5.
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

**`secrets.example.h` ships `MQTT_USER` and `MQTT_PASS` as `nullptr`** in the
non-TLS branch, from when the board talked to a public broker anonymously. Both
must be filled in now that 1883 refuses anonymous connections, and the symptom of
forgetting is four dashes — which the table at the end of this file sends you to
the ACL for, not to `secrets.h`. Reflash after editing: the credentials are baked
into the binary, so a power cycle changes nothing.

**Leave `USE_TLS` at 0, and it is not merely unnecessary.** The TLS branch targets
**8883 with raw MQTT**, which this broker does not listen on — 8884 is
`protocol websockets` and PubSubClient cannot speak it — so turning it on needs a
third listener before anything else. Beyond that: `MQTT_CA_CERT` would pin a root,
and Let's Encrypt's Generation Y transition shows those move, which on a device
whose certificate is baked into its binary means a field failure fixable only by
reflashing; and validity checking needs a clock the board has no way to set with no
internet. What it would protect is a read-only subscriber on a WPA2 AP receiving a
cornhole score.

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

**Nothing will warn you, and nothing can.** Let's Encrypt ended expiration
notification emails on 2025-06-04, so `account_email` buys no alert; and the
third-party monitors they suggest instead cannot help here, because
`board.holecorn.com` resolves to a private address that nothing outside the AP
can reach to inspect. The first symptom is therefore the app failing to connect
in a field, which is the worst place to learn it. That is the whole argument for
the habit above — it is not belt-and-braces, it is the only mechanism.

An optional upgrade removes the remembering: the router is dual-band, so the
5 GHz radio can join home Wi-Fi as a client whenever it is in range while the AP
stays on 2.4 GHz. Get the ethernet version working first — one interface, one
failure mode.

## When it does not work

| Symptom | First thing to check |
| --- | --- |
| Board shows four dashes and stays dim | It never subscribed: `viewer` credentials, or the ACL |
| Board never joins the Wi-Fi | `psk2` and `ieee80211w '0'`; a WPA3/PMF refusal looks like a wrong password |
| Key is on the router and it still asks for a password | `/etc/dropbear/authorized_keys` versus `~/.ssh/authorized_keys`, then the file's mode — dropbear ignores a group-writable one silently, which looks the same as a key it has never seen |
| App reports a broker error, no detail | `logread -e mosquitto` — certificate expiry first, then whether the TLS listener started at all (key permissions). No output at all means `log_dest` is missing, not that nothing is wrong |
| App says the subscription was refused | The ACL file — that message exists for exactly this |
| Name will not resolve on the phone | A manually configured DNS server on the device — it outranks DHCP and is unreachable with no WAN, and on macOS it is set per *service*, not per network. Then iCloud Private Relay or a DoH profile, then the `dnsmasq` local address entry. Tell them apart with `dig board.holecorn.com @192.168.8.1`: an answer there means the router is fine and the device is asking somewhere else |
| One device trusts the broker and an older one does not | The chain, not the certificate. `ISRG Root YE` is new enough to be missing from an older iOS trust store, so the cross-sign has to be served — `certfile` is `fullchain.cer` for this reason |
| Everything works at home, nothing in the field | The service worker cache was never populated on that device, or ITP evicted it because it is not installed |
