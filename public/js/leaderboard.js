/* ==========================================================================
   SIGNAL RANGE LEADERBOARD — client.

   Listens for the game's `e26:range:runend` event, offers to submit the run,
   and renders the two boards (score and streak). The game itself knows
   nothing about names, networks or prizes; this module is the whole bridge.

   PHASE 1: the score is computed in the browser, so what gets posted is a
   CLAIM. The board says so on its face — see lib/leaderboard.js for why that
   label matters while two ₹2,500 prizes are attached to it.

   SAVE ends the run (the game enforces that, not this module): banking a
   score and playing on would let a player re-save after every lucky shot.
   LOAD restores the handle and personal best held on this device — it does
   NOT restore a run in progress, for the same reason.
   ========================================================================== */

const NAME_KEY = 'e26.signalRange.name';
const BEST_KEY = 'e26.signalRange.best';

const get = (k) => { try { return localStorage.getItem(k); } catch (_) { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} };

export function mountLeaderboard() {
  const host = document.querySelector('[data-js="range-board"]');
  if (!host) return;

  const arena     = document.querySelector('[data-js="signal-game-mount"]');
  const panel     = host.querySelector('[data-js="lb-panel"]');
  const form      = host.querySelector('[data-js="lb-form"]');
  const nameInput = host.querySelector('[data-js="lb-name"]');
  const summary   = host.querySelector('[data-js="lb-summary"]');
  const msg       = host.querySelector('[data-js="lb-msg"]');
  const dismiss   = host.querySelector('[data-js="lb-dismiss"]');
  const loadBtn   = document.querySelector('[data-js="sg-load"]');
  const tabs      = [...host.querySelectorAll('[data-js="lb-tab"]')];
  const bodies    = {
    score:  host.querySelector('[data-js="lb-body-score"]'),
    streak: host.querySelector('[data-js="lb-body-streak"]'),
  };

  const submitBtn = host.querySelector('[data-js="lb-go"]');

  let pending = null;          // the run awaiting submission
  let busy = false;

  const say = (text, tone = '') => {
    msg.textContent = text;
    msg.className = 'lb-msg' + (tone ? ' lb-msg--' + tone : '');
  };

  // The panel is opened by two different things — a finished run, and Load —
  // and only one of them has something to submit. Without this the Load view
  // shows a live Save button that silently does nothing.
  const setPending = (run) => {
    pending = run;
    if (submitBtn) submitBtn.disabled = !run;
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
      const res = await fetch('/api/range/leaderboard?limit=10', { headers: { accept: 'application/json' } });
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
  function offer(run, reason) {
    setPending(run);
    summary.textContent = `${run.score} pts · best streak ×${run.streak} · ${run.hits}/${run.shots} hits`;
    panel.hidden = false;
    panel.dataset.reason = reason;
    say(reason === 'lost' ? 'Run over. Save it to the board?' : 'Run banked. Save it to the board?');
    const saved = get(NAME_KEY);
    if (saved) nameInput.value = saved;
    // Don't yank focus on a lost run — the player may just want to replay.
    if (reason !== 'lost') nameInput.focus();
  }

  arena?.addEventListener('e26:range:runend', (e) => {
    const { run, reason } = e.detail;
    if (run.score <= 0 && run.streak <= 0) return;   // nothing worth saving
    // A run played without a server-issued seed cannot be verified, so it
    // cannot go on the board. Say why rather than failing at submit time.
    if (!run.session) {
      panel.hidden = false;
      setPending(null);
      summary.textContent = `${run.score} pts · best streak ×${run.streak}`;
      say('This run started without a connection, so it can’t be verified. Play another to get on the board.', 'bad');
      return;
    }
    offer(run, reason);
  });

  dismiss?.addEventListener('click', () => { panel.hidden = true; setPending(null); });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!pending || busy) return;
    busy = true;
    say('Saving…');

    try {
      // Only the NAME and the run's inputs go up. The score is not sent at
      // all — the server derives it by replaying these shots against the seed
      // it issued, so there is nothing here worth tampering with.
      const res = await fetch('/api/range/score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: nameInput.value.trim(),
          session: pending.session,
          shots: pending.shotTrace,
        }),
      });
      const data = await res.json();

      if (!data.ok) {
        const errs = data.errors || {};
        say(errs.name || errs.form || Object.values(errs)[0] || 'Could not save that run.', 'bad');
        busy = false;
        return;
      }

      set(NAME_KEY, nameInput.value.trim());
      setPending(null);
      // Show the SERVER's figure. If it differs from what the player watched,
      // the honest thing is to show the one that actually went on the board.
      const verified = data.run || {};
      say(`Saved: ${verified.score} pts, streak ×${verified.streak} — `
        + `#${data.rank.score} on score, #${data.rank.streak} on streak.`, 'good');
      await refresh();
      setTimeout(() => { panel.hidden = true; }, 2600);
    } catch (_) {
      say('Network error — the run was not saved.', 'bad');
    }
    busy = false;
  });

  // ---- load --------------------------------------------------------------
  // Restores who you are on this device, not a run in progress.
  loadBtn?.addEventListener('click', () => {
    const name = get(NAME_KEY);
    const best = get(BEST_KEY);
    panel.hidden = false;
    setPending(null);
    summary.textContent = best ? `Personal best on this device: ${best} pts` : 'No saved runs on this device yet.';
    nameInput.value = name || '';
    say(name ? `Loaded handle “${name}”. Play a run to add to the board.` : 'No handle saved here yet — finish a run and save one.');
  });

  refresh();
}
