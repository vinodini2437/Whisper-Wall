/* ================= CONFIG ================= */
// API_BASE comes from config.js (loaded before this file).

// Every anonymous poster gets a persistent random id stored in this browser only.
// It is never displayed anywhere — it's just how the server knows which posts,
// communities, polls, reactions, and votes belong to "you", so you can delete
// your own creations and can't vote/react twice.
function getOwnerId() {
  let id = localStorage.getItem('whisperwall_owner_id');
  if (!id) {
    id = 'anon-' + crypto.randomUUID();
    localStorage.setItem('whisperwall_owner_id', id);
  }
  return id;
}
const OWNER_ID = getOwnerId();

const REACTIONS = [
  { key: 'relate', icon: '🤫' },
  { key: 'lol', icon: '😂' },
  { key: 'support', icon: '💜' },
  { key: 'shock', icon: '😮' },
];

const categories = ['All', 'Academics', 'Relationships', 'Roommates', 'Campus Life', 'Rant', 'Wholesome'];

/* ================= STATE ================= */
let confessions = [];
let allTags = [];
let activeCategory = 'All';
let activeTag = null;
let sortMode = 'new';
let searchTerm = '';

// Generic pending-delete state, used by the shared delete confirm modal
let pendingDelete = null; // { kind: 'confession'|'community'|'poll', id }

/* ================= API HELPERS ================= */
async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

/* ================= TABS ================= */
document.querySelectorAll('nav.tabs button').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('nav.tabs button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');

    // Only show the feed's category/tag sidebar on the feed tab
    document.getElementById('feedSidebar').style.display = btn.dataset.tab === 'feed' ? '' : 'none';
  };
});

/* ================= FEED ================= */
function totalReacts(c) {
  return Object.values(c.reactions).reduce((a, b) => a + b, 0);
}

async function loadFeed() {
  const params = new URLSearchParams({ ownerId: OWNER_ID, sort: sortMode });
  if (activeCategory !== 'All') params.set('category', activeCategory);
  if (activeTag) params.set('tag', activeTag);
  if (searchTerm) params.set('search', searchTerm);

  confessions = await api(`/confessions?${params.toString()}`);
  renderFeed();
}

async function loadTags() {
  allTags = await api('/tags');
  renderTagChips();
}

function renderCategoryChips() {
  const el = document.getElementById('categoryChips');
  el.innerHTML = categories.map(c =>
    `<button class="chip ${c === activeCategory ? 'active' : ''}" data-cat="${c}">${c}</button>`
  ).join('');
  el.querySelectorAll('[data-cat]').forEach(btn => {
    btn.onclick = () => { activeCategory = btn.dataset.cat; renderCategoryChips(); loadFeed(); };
  });
}

function renderTagChips() {
  const el = document.getElementById('tagChips');
  if (allTags.length === 0) {
    el.innerHTML = '<span class="dim-note">No tags yet</span>';
    return;
  }
  el.innerHTML = allTags.map(t =>
    `<button class="chip ${t === activeTag ? 'active' : ''}" data-tag="${t}">#${t}</button>`
  ).join('');
  el.querySelectorAll('[data-tag]').forEach(btn => {
    btn.onclick = () => { activeTag = (activeTag === btn.dataset.tag) ? null : btn.dataset.tag; renderTagChips(); loadFeed(); };
  });
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function renderFeed() {
  const feedEl = document.getElementById('feedList');
  if (confessions.length === 0) {
    feedEl.innerHTML = `<div class="empty-state">No confessions here yet.<br>Be the first to share something.</div>`;
    return;
  }

  feedEl.innerHTML = confessions.map(c => `
    <div class="card" data-id="${c.id}">
      <div class="card-top">
        <div class="card-meta"><b>Anonymous #${c.id}</b> · ${timeAgo(c.createdAt)}</div>
        <div class="card-top-right">
          ${c.isOwner ? '<span class="own-tag">yours</span>' : ''}
          <div class="cat-stamp">${c.category}</div>
        </div>
      </div>
      <p class="card-text">${escapeHtml(c.text)}</p>
      <div class="card-tags">${c.tags.map(t => `<span>#${escapeHtml(t)}</span>`).join('')}</div>
      <div class="card-actions">
        ${REACTIONS.map(r => `
          <button class="react-btn ${c.mine === r.key ? 'picked' : ''}" data-react="${r.key}">
            ${r.icon} <span class="react-count">${c.reactions[r.key]}</span>
          </button>
        `).join('')}
        <button class="comment-toggle" data-toggle="comments">💬 ${c.comments.length} comments</button>
        ${c.isOwner
          ? `<button class="delete-link" data-delete>Delete</button>`
          : `<button class="report-link" data-toggle="report">Report</button>`}
      </div>
      <div class="comments">
        ${c.comments.map(cm => `<div class="comment-row"><b>${escapeHtml(cm.who)}</b>${escapeHtml(cm.text)}</div>`).join('') || `<div class="comment-row dim-note">No comments yet — start the thread.</div>`}
        <div class="comment-add">
          <input type="text" placeholder="add an anonymous comment…" data-comment-input>
          <button data-comment-submit>Post</button>
        </div>
      </div>
    </div>
  `).join('');

  attachCardHandlers();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function attachCardHandlers() {
  document.querySelectorAll('.card').forEach(cardEl => {
    const id = Number(cardEl.dataset.id);

    cardEl.querySelectorAll('[data-react]').forEach(btn => {
      btn.onclick = async () => {
        const type = btn.dataset.react;
        try {
          await api(`/confessions/${id}/react`, {
            method: 'POST',
            body: JSON.stringify({ ownerId: OWNER_ID, type }),
          });
          await loadFeed();
        } catch (e) {
          showToast(e.message);
        }
      };
    });

    cardEl.querySelector('[data-toggle="comments"]').onclick = () => {
      cardEl.querySelector('.comments').classList.toggle('open');
    };

    const reportBtn = cardEl.querySelector('[data-toggle="report"]');
    if (reportBtn) {
      reportBtn.onclick = async () => {
        try {
          await api(`/confessions/${id}/report`, { method: 'POST' });
          showToast('Reported — thanks, our moderators will review this confession.');
        } catch (e) {
          showToast(e.message);
        }
      };
    }

    const deleteBtn = cardEl.querySelector('[data-delete]');
    if (deleteBtn) {
      deleteBtn.onclick = () => openDeleteModal('confession', id, 'Delete confession?');
    }

    const submitC = cardEl.querySelector('[data-comment-submit]');
    const inputC = cardEl.querySelector('[data-comment-input]');
    const submit = async () => {
      const val = inputC.value.trim();
      if (!val) return;
      try {
        await api(`/confessions/${id}/comments`, {
          method: 'POST',
          body: JSON.stringify({ text: val, ownerId: OWNER_ID }),
        });
        await loadFeed();
        const reopened = document.querySelector(`.card[data-id="${id}"] .comments`);
        if (reopened) reopened.classList.add('open');
      } catch (e) {
        showToast(e.message);
      }
    };
    submitC.onclick = submit;
    inputC.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
  });
}

/* ================= SHARED DELETE CONFIRM MODAL ================= */
const deleteOverlay = document.getElementById('deleteOverlay');
const deleteTitleEl = document.getElementById('deleteTitle');

function openDeleteModal(kind, id, title) {
  pendingDelete = { kind, id };
  deleteTitleEl.textContent = title;
  deleteOverlay.classList.add('open');
}

document.getElementById('cancelDelete').onclick = () => {
  pendingDelete = null;
  deleteOverlay.classList.remove('open');
};
deleteOverlay.onclick = (e) => { if (e.target === deleteOverlay) { pendingDelete = null; deleteOverlay.classList.remove('open'); } };

document.getElementById('confirmDelete').onclick = async () => {
  if (!pendingDelete) return;
  const { kind, id } = pendingDelete;
  try {
    if (kind === 'confession') {
      await api(`/confessions/${id}?ownerId=${encodeURIComponent(OWNER_ID)}`, { method: 'DELETE' });
      showToast('Confession deleted.');
      await loadFeed();
      await loadTags();
    } else if (kind === 'community') {
      await api(`/communities/${id}?ownerId=${encodeURIComponent(OWNER_ID)}`, { method: 'DELETE' });
      showToast('Community deleted.');
      await loadCommunities();
    } else if (kind === 'poll') {
      await api(`/polls/${id}?ownerId=${encodeURIComponent(OWNER_ID)}`, { method: 'DELETE' });
      showToast('Poll deleted.');
      await loadPolls();
    }
  } catch (e) {
    showToast(e.message);
  } finally {
    pendingDelete = null;
    deleteOverlay.classList.remove('open');
  }
};

/* ================= TRENDING ================= */
async function loadTrending() {
  const top = await api('/trending');
  const el = document.getElementById('trendingFullList');
  if (top.length === 0) {
    el.innerHTML = '<div class="empty-state">Nothing trending yet — react to a confession to get it started.</div>';
    return;
  }
  el.innerHTML = top.map((c, i) => `
    <div class="trend-item">
      <span class="trend-rank mono">#${i + 1}</span>
      <div>
        <div>${escapeHtml(c.text.slice(0, 140))}${c.text.length > 140 ? '…' : ''}</div>
        <div class="trend-sub">${totalReacts(c)} reactions · ${escapeHtml(c.category)}</div>
      </div>
    </div>
  `).join('');
}

/* ================= COMMUNITIES ================= */
async function loadCommunities() {
  const communities = await api(`/communities?ownerId=${encodeURIComponent(OWNER_ID)}`);
  const el = document.getElementById('communityList');

  if (communities.length === 0) {
    el.innerHTML = '<p class="empty-state">No communities yet. Be the first to create one.</p>';
    return;
  }

  el.innerHTML = communities.map(c => `
    <div class="item-card">
      <h3>${escapeHtml(c.name)}</h3>
      <div class="item-meta">Created ${timeAgo(c.createdAt)}</div>
      <div class="item-actions">
        <button class="join-btn ${c.joined ? 'joined' : ''}" data-comm-id="${c.id}">${c.joined ? 'Joined' : 'Join'}</button>
        ${c.isOwner ? `<button class="delete-link" data-delete-community="${c.id}">Delete</button>` : ''}
      </div>
    </div>
  `).join('');

  el.querySelectorAll('[data-comm-id]').forEach(btn => {
    btn.onclick = async () => {
      try {
        await api(`/communities/${btn.dataset.commId}/toggle`, {
          method: 'POST',
          body: JSON.stringify({ ownerId: OWNER_ID }),
        });
        await loadCommunities();
      } catch (e) {
        showToast(e.message);
      }
    };
  });

  el.querySelectorAll('[data-delete-community]').forEach(btn => {
    btn.onclick = () => openDeleteModal('community', btn.dataset.deleteCommunity, 'Delete this community?');
  });
}

const communityForm = document.getElementById('communityForm');
const communityError = document.getElementById('communityError');

communityForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  communityError.textContent = '';
  const name = document.getElementById('communityName').value.trim();

  try {
    await api('/communities', {
      method: 'POST',
      body: JSON.stringify({ ownerId: OWNER_ID, name }),
    });
    communityForm.reset();
    showToast('Community created.');
    await loadCommunities();
  } catch (e) {
    communityError.textContent = e.message;
  }
});

/* ================= POLLS ================= */
async function loadPolls() {
  const polls = await api(`/polls?ownerId=${encodeURIComponent(OWNER_ID)}`);
  const el = document.getElementById('pollFullList');

  if (polls.length === 0) {
    el.innerHTML = '<p class="empty-state">No polls yet. Create the first one.</p>';
    return;
  }

  el.innerHTML = polls.map(poll => {
    const total = poll.options.reduce((a, o) => a + o.votes, 0);
    return `
    <div class="item-card">
      <h3>${escapeHtml(poll.question)}</h3>
      <div class="item-meta">Created ${timeAgo(poll.createdAt)} · ${total} vote${total === 1 ? '' : 's'}</div>
      <div class="poll-options" data-poll-id="${poll.id}">
        ${poll.options.map(o => {
          const pct = total ? Math.round(o.votes / total * 100) : 0;
          return `<button class="poll-opt" data-opt="${o.id}" ${poll.voted ? 'disabled' : ''}>
            <div class="poll-fill" style="width:${poll.voted ? pct : 0}%"></div>
            <span class="poll-opt-label"><span>${escapeHtml(o.label)}</span>${poll.voted ? `<span>${pct}%</span>` : ''}</span>
          </button>`;
        }).join('')}
      </div>
      <div class="item-actions">
        ${poll.isOwner ? `<button class="delete-link" data-delete-poll="${poll.id}">Delete</button>` : ''}
      </div>
    </div>
  `;
  }).join('');

  el.querySelectorAll('.poll-opt:not(:disabled)').forEach(btn => {
    btn.onclick = async () => {
      const pollId = btn.closest('.poll-options').dataset.pollId;
      try {
        await api(`/polls/${pollId}/vote`, {
          method: 'POST',
          body: JSON.stringify({ ownerId: OWNER_ID, optionId: Number(btn.dataset.opt) }),
        });
        showToast('Vote counted — thanks!');
        await loadPolls();
      } catch (e) {
        showToast(e.message);
      }
    };
  });

  el.querySelectorAll('[data-delete-poll]').forEach(btn => {
    btn.onclick = () => openDeleteModal('poll', btn.dataset.deletePoll, 'Delete this poll?');
  });
}

const addOptionBtn = document.getElementById('addOptionBtn');
const pollOptionsContainer = document.getElementById('pollOptionsContainer');

addOptionBtn.addEventListener('click', () => {
  const count = pollOptionsContainer.querySelectorAll('.poll-option-input').length;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'poll-option-input';
  input.placeholder = `Option ${count + 1}`;
  pollOptionsContainer.appendChild(input);
});

const pollForm = document.getElementById('pollForm');
const pollError = document.getElementById('pollError');

pollForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  pollError.textContent = '';
  const question = document.getElementById('pollQuestion').value.trim();
  const options = Array.from(document.querySelectorAll('.poll-option-input'))
    .map(input => input.value.trim())
    .filter(Boolean);

  if (options.length < 2) {
    pollError.textContent = 'Please provide at least 2 options.';
    return;
  }

  try {
    await api('/polls', {
      method: 'POST',
      body: JSON.stringify({ ownerId: OWNER_ID, question, options }),
    });
    pollForm.reset();
    pollOptionsContainer.innerHTML = `
      <input type="text" class="poll-option-input" placeholder="Option 1" required>
      <input type="text" class="poll-option-input" placeholder="Option 2" required>
    `;
    showToast('Poll created.');
    await loadPolls();
  } catch (e) {
    pollError.textContent = e.message;
  }
});

/* ================= COMPOSE MODAL (new confession) ================= */
const overlay = document.getElementById('composeOverlay');
document.getElementById('openCompose').onclick = () => overlay.classList.add('open');
document.getElementById('cancelCompose').onclick = () => overlay.classList.remove('open');
overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.remove('open'); };

document.getElementById('submitCompose').onclick = async () => {
  const text = document.getElementById('composeText').value.trim();
  if (!text) { showToast('Write something before posting.'); return; }
  const category = document.getElementById('composeCategory').value;
  const tags = document.getElementById('composeTags').value.split(',').map(t => t.trim()).filter(Boolean);

  try {
    await api('/confessions', {
      method: 'POST',
      body: JSON.stringify({ ownerId: OWNER_ID, category, tags, text }),
    });
    document.getElementById('composeText').value = '';
    document.getElementById('composeTags').value = '';
    overlay.classList.remove('open');
    await loadTags();
    await loadFeed();
    showToast('Posted anonymously — no name attached, ever.');
  } catch (e) {
    showToast(e.message);
  }
};

/* ================= FEED TOOLBAR ================= */
document.querySelectorAll('[data-sort]').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('[data-sort]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    sortMode = btn.dataset.sort;
    loadFeed();
  };
});
document.getElementById('searchBox').addEventListener('input', e => {
  searchTerm = e.target.value;
  loadFeed();
});

/* ================= TOAST ================= */
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

/* ================= INIT ================= */
(async function init() {
  renderCategoryChips();
  try {
    await Promise.all([loadTags(), loadFeed(), loadTrending(), loadCommunities(), loadPolls()]);
  } catch (e) {
    showToast('Could not reach the server. Is the backend running?');
    console.error(e);
  }
})();
