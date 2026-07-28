import { useEffect, useRef, useState } from 'react';
import { renderSVG } from 'uqr';
import {
  LAYOUT_LABELS,
  configComplete,
  displayUrl,
  newCode,
  normalizeCode,
  normalizeLayout,
} from './scoreboard.js';
import { PANEL_LAYOUTS } from './panelRender.js';

const STATUS_LABEL = {
  idle: 'off',
  connecting: 'connecting…',
  connected: 'connected',
  offline: 'offline',
  error: 'error',
};

export default function ScoreboardSettings({ config, onChange, status, error }) {
  const [copied, setCopied] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const dialogRef = useRef(null);
  const linkInputRef = useRef(null);
  const ready = configComplete(config);
  const link = ready ? displayUrl(window.location.origin, config) : '';

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  // select() alone often no-ops on iOS Safari for readonly inputs;
  // setSelectionRange is the reliable form there.
  const selectLink = () => {
    const el = linkInputRef.current;
    if (!el) return;
    el.select();
    el.setSelectionRange(0, el.value.length);
  };

  useEffect(() => {
    if (!showLink) return;
    dialogRef.current?.showModal();
    selectLink();
  }, [showLink]);

  const set = (field) => (e) => onChange({ ...config, [field]: e.target.value });

  const copyLink = async () => {
    try {
      // Throws when the write is refused, and also when the API is absent
      // altogether — Safari and Chrome both drop navigator.clipboard entirely
      // on plain http, e.g. a dev server reached by LAN IP.
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setShowLink(true);
    }
  };

  return (
    <details className="scoreboard-settings">
      <summary>
        External scoreboard
        <span className={`link-status is-${status}`}>{STATUS_LABEL[status] ?? status}</span>
      </summary>

      <label className="sb-toggle">
        <input
          type="checkbox"
          checked={Boolean(config.enabled)}
          onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
        />
        Publish the score
      </label>

      <label className="sb-field">
        Game code
        <span className="sb-inline">
          <input
            value={config.code}
            placeholder="e.g. k3pqm"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            onChange={(e) => onChange({ ...config, code: normalizeCode(e.target.value) })}
          />
          <button type="button" onClick={() => onChange({ ...config, code: newCode() })}>
            New
          </button>
        </span>
      </label>

      <label className="sb-field">
        Broker URL
        <input
          value={config.broker}
          placeholder="wss://xxxx.hivemq.cloud:8884/mqtt"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck="false"
          onChange={set('broker')}
        />
      </label>

      <div className="sb-pair">
        <label className="sb-field">
          Username
          <input
            value={config.username}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck="false"
            onChange={set('username')}
          />
        </label>
        <label className="sb-field">
          Password
          <input type="password" value={config.password} onChange={set('password')} />
        </label>
      </div>

      <fieldset className="sb-layout">
        <legend>Panel layout</legend>
        {PANEL_LAYOUTS.map((id) => (
          <label key={id}>
            <input
              type="radio"
              name="panel-layout"
              value={id}
              checked={normalizeLayout(config.layout) === id}
              onChange={() => onChange({ ...config, layout: id })}
            />
            {LAYOUT_LABELS[id] ?? id}
          </label>
        ))}
        <p className="sb-hint">
          Changes reach the board straight away, mid-game included. Watch it in the
          emulator by adding <code>&amp;panel=1</code> to the display link.
        </p>
      </fieldset>

      <div className="sb-actions">
        <button type="button" disabled={!ready} onClick={copyLink}>
          {copied ? 'Copied' : 'Copy display link'}
        </button>
        <button type="button" disabled={!ready} onClick={() => setShowLink(true)}>
          QR code
        </button>
        {ready && (
          <a href={link} target="_blank" rel="noreferrer">
            Open display
          </a>
        )}
      </div>

      {showLink && (
        <dialog
          ref={dialogRef}
          className="sb-link-dialog"
          aria-label="Display link"
          onClose={() => setShowLink(false)}
        >
          <p>Scan this on the display device, or copy the link.</p>
          <div
            className="sb-qr"
            role="img"
            aria-label="QR code for the display link"
            dangerouslySetInnerHTML={{ __html: renderSVG(link, { border: 4 }) }}
          />
          <input
            ref={linkInputRef}
            readOnly
            value={link}
            aria-label="Display link"
            onFocus={selectLink}
          />
          <button type="button" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </dialog>
      )}

      {status === 'error' && error && <p className="sb-error">{error}</p>}
      <p className="sb-hint">
        The display connects to the same broker and game code. Anyone with these
        details can post to your scoreboard, so keep the code to yourself.
      </p>
    </details>
  );
}
