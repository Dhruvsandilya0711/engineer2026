/* ==========================================================================
   SIGNAL RANGE LEADERBOARD — client.

   Listens for the game's `e26:range:runend`, submits the run, and renders
   the two boards (score and streak). The game knows nothing about names,
   networks or prizes; this module is the whole bridge.

   The NAME is chosen on the start screen before a run begins, so there is
   no form here — a finished run submits on its own and this panel reports
   what the SERVER scored it and where that placed. That ordering matters:
   a run goes onto a public prize board the moment it ends, so the player
   has to have picked their public name before earning a score with it.

   Nothing here sends a score. It sends the seed the server issued and the
   inputs the player made; the server replays that trace through the same
   simulation to derive the score. See lib/leaderboard.js.
   ========================================================================== */

const NAME_KEY = 'e26.signalRange.name';
const BEST_KEY = 'e26.signalRange.best';

const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };

export function mountLeaderboard() {
  const host = document.querySelector('[data-js="range-board"]');
  if (!host) return;

  const arena   = document.querySelector('[data-js="signal-game-mount"]');
  const panel   = host.querySelector('[data-js="lb-panel"]');
  const summary = host.querySelector('[data-js="lb-summary"]');
  const msg     = host.querySelector('[data-js="lb-msg"]');
  const dismiss = host.querySelector('[data-js="lb-dismiss"]');
  const loadBtn = document.querySelector('[data-js="sg-load"]');
  const tabs    = [...host.querySelectorAll('[data-js="lb-tab"]')];
  const bodies  = {
    score:  host.querySelector('[data-js="lb-body-score"]'),
    streak: host.querySelector('[data-js="lb-body-streak"]'),
  };

  let busy = false;

  const say = (text, tone = '') => {
    msg.textContent = text;
    msg.className = 'lb-msg' + (tone ? ' lb-msg--' + tone : '');
  };

  const open = (summaryText) => {
    panel.hidden = false;
    summary.textContent = summaryText || '';
  };

  // ---- boards ------------------------------------------------------------
  const row = (r, i, metric) => {
    const tr = document.createElement('tr');
    if (r.name.toLowerCase() === (get(NAME_KEY) || '').toLowerCase()) tr.className = 'is-you';
    tr.innerHTML =
      `<td class="lb-rank">${String(i + 1).padStart(2, '0')}</td>` +
      `<td class="lb-name"></td>` +
      `<td class="lb-val">${metric === 'streak' ? '×' + r.streak : r.score}</td>`;
    // Names are player-supplied: set them as TEXT so a name can never inject
    // markup into the board.
    tr.querySelector('.lb-name').textContent = r.name;
    return tr;
  };

  async function refresh() {
    try {
      const res = await fetch('/engineer2026/api/range/leaderboard?limit=10', { headers: { accept: 'application/json' } });
      const data = await res.json();
      if (!data.ok) throw new Error('bad response');
      for (const metric of ['score', 'streak']) {
        const tbody = bodies[metric];
        tbody.replaceChildren();
        const rows = data.boards[metric] || [];
        if (!rows.length) {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td class="lb-empty" colspan="3">No runs yet — be first.</td>`;
          tbody.append(tr);
          continue;
        }
        rows.forEach((r, i) => tbody.append(row(r, i, metric)));
      }
    } catch (_) {
      host.querySelector('[data-js="lb-error"]')?.removeAttribute('hidden');
    }
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const metric = tab.dataset.metric;
      tabs.forEach((t) => {
        const on = t === tab;
        t.classList.toggle('is-active', on);
        t.setAttribute('aria-selected', String(on));
      });
      for (const m of ['score', 'streak']) {
        host.querySelector(`[data-js="lb-table-${m}"]`).hidden = m !== metric;
      }
    });
  });

  // ---- submission --------------------------------------------------------
  async function submit(run) {
    const name = (get(NAME_KEY) || '').trim();
    if (!name) { say('No name set — start a run and enter one first.', 'bad'); return; }
    if (busy) return;
    busy = true;
    say('Saving…');

    try {
      const res = await fetch('/engineer2026/api/range/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, session: run.session, shots: run.shotTrace }),
      });
      const data = await res.json();

      if (!data.ok) {
        const errs = data.errors || {};
        say(errs.name || errs.form || Object.values(errs)[0] || 'Could not save that run.', 'bad');
        busy = false;
        return;
      }

      // Report the SERVER's figure. If it ever differs from what the player
      // watched, the number that went on the board is the honest one to show.
      const v = data.run || {};
      say(`Saved as “${name}”: ${v.score} pts, streak ×${v.streak} — `
        + `#${data.rank.score} on score, #${data.rank.streak} on streak.`, 'good');
      await refresh();
    } catch (_) {
      say('Network error — the run was not saved.', 'bad');
    }
    busy = false;
  }

  arena?.addEventListener('e26:range:runend', (e) => {
    const { run } = e.detail;
    if (run.score <= 0 && run.streak <= 0) return;   // nothing worth saving

    open(`${run.score} pts · best streak ×${run.streak} · ${run.hits}/${run.shots} hits`);

    // A run played without a server-issued seed cannot be verified, so it
    // cannot go on the board. Say why rather than failing silently.
    if (!run.session) {
      say('This run started without a connection, so it can’t be verified. Play another to get on the board.', 'bad');
      return;
    }
    submit(run);
  });

  dismiss?.addEventListener('click', () => { panel.hidden = true; });

  // ---- load --------------------------------------------------------------
  // Shows who this device plays as and its personal best. It does not restore
  // a run in progress: banking a score and resuming would let a player re-save
  // after every lucky shot.
  loadBtn?.addEventListener('click', () => {
    const name = get(NAME_KEY);
    const best = get(BEST_KEY);
    open(best ? `Personal best on this device: ${best} pts` : 'No runs saved on this device yet.');
    say(name ? `Playing as “${name}”. Change it on the start screen.` : 'No name set yet — start a run to choose one.');
  });

  refresh();
}
