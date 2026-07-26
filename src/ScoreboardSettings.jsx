import { useEffect, useState } from 'react';
import { configComplete, displayUrl, newCode, normalizeCode } from './scoreboard.js';

const STATUS_LABEL = {
  idle: 'off',
  connecting: 'connecting…',
  connected: 'connected',
  offline: 'offline',
  error: 'error',
};

export default function ScoreboardSettings({ config, onChange, status, error }) {
  const [copied, setCopied] = useState(false);
  const ready = configComplete(config);
  const link = ready ? displayUrl(window.location.origin, config) : '';

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  const set = (field) => (e) => onChange({ ...config, [field]: e.target.value });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
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

      <div className="sb-actions">
        <button type="button" disabled={!ready} onClick={copyLink}>
          {copied ? 'Copied' : 'Copy display link'}
        </button>
        {ready && (
          <a href={link} target="_blank" rel="noreferrer">
            Open display
          </a>
        )}
      </div>

      {status === 'error' && error && <p className="sb-error">{error}</p>}
      <p className="sb-hint">
        The display connects to the same broker and game code. Anyone with these
        details can post to your scoreboard, so keep the code to yourself.
      </p>
    </details>
  );
}
