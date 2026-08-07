// `.claude/rules/*.md` only reach a reader through their `paths:` frontmatter, and
// nothing else checks that a rule file's globs and its prose agree. Both directions rot
// silently: `App.jsx` was named 32 times across the six files and matched by none of
// them, so the one file a quarter of every subsystem's constraints are about loaded no
// rules at all; and a path list left behind by a rename would match nothing, so the file
// it named would open with the rules that describe it still on disk and unread.
//
// Neither has a symptom — the rules simply don't arrive, and the next change breaks
// something the project had already written down.
//
// Only `src/` is swept for the first check. `tools/*.mjs` and `firmware/hub75/` are
// covered wholesale — by `testing.md` and by that directory's own `CLAUDE.md` — so a new
// file there is already reachable and has nothing to slip through.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../', import.meta.url);
const rulesDir = new URL('.claude/rules/', root);

const rules = readdirSync(rulesDir)
  .filter((name) => name.endsWith('.md'))
  .map((file) => {
    const text = readFileSync(new URL(file, rulesDir), 'utf8');
    const front = /^---\n(.*?)\n---\n/s.exec(text);
    expect(front, `${file} has no frontmatter`).not.toBeNull();
    return {
      file,
      globs: [...front[1].matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)].map((m) => m[1]),
      body: text.slice(front[0].length),
    };
  });

// The globs use `*` and never `**`, so a star stops at a separator.
const matches = (glob, path) =>
  new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`).test(path);

const covered = (path) => rules.filter((rule) => rule.globs.some((glob) => matches(glob, path)));

const listing = (dir) => readdirSync(new URL(dir, root), { recursive: true }).map((p) => dir + p);

const dirs = [...new Set(rules.flatMap((rule) => rule.globs.map((glob) => glob.split('/')[0])))];
const files = dirs.flatMap((dir) => listing(`${dir}/`));

// Matches `src/App.jsx` and a bare `App.jsx` alike, and neither inside a longer name.
const named = (path) => {
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\./g, '\\.');
  const mention = new RegExp(`(?<![\\w-])${base}(?![\\w-])`);
  return rules.some((rule) => mention.test(rule.body));
};

describe('rule files', () => {
  it('load for every src file they talk about', () => {
    const orphans = files
      .filter((path) => path.startsWith('src/') && /\.\w+$/.test(path))
      .filter((path) => named(path) && covered(path).length === 0);
    expect(orphans).toEqual([]);
  });

  it('list no path that matches nothing', () => {
    const dead = rules.flatMap((rule) =>
      rule.globs
        .filter((glob) => !files.some((path) => matches(glob, path)))
        .map((glob) => `${rule.file}: ${glob}`),
    );
    expect(dead).toEqual([]);
  });
});
