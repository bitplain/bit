const API_BASE = 'http://localhost:8000';

const authPanel = document.getElementById('auth-panel');
const dashboard = document.getElementById('dashboard');
const authForm = document.getElementById('auth-form');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const statusEl = document.getElementById('status');

const userEmailEl = document.getElementById('user-email');
const userNickEl = document.getElementById('user-nick');

// Knowledge base
const kbList = document.getElementById('kb-list');
const detailTitle = document.getElementById('detail-title');
const detailMeta = document.getElementById('detail-meta');
const detailBody = document.getElementById('detail-body');
const noteForm = document.getElementById('note-form');
const noteIdInput = document.getElementById('note-id');
const noteTitle = document.getElementById('note-title');
const noteContent = document.getElementById('note-content');
const notePublish = document.getElementById('note-publish');
const noteCancel = document.getElementById('note-cancel');
const previewEl = document.getElementById('preview');
const refreshNotesBtn = document.getElementById('refresh-notes');
const newArticleBtn = document.getElementById('new-article-btn');

// Password manager
const passwordForm = document.getElementById('password-form');
const passwordId = document.getElementById('password-id');
const passwordTitle = document.getElementById('password-title');
const passwordLogin = document.getElementById('password-login');
const passwordSecret = document.getElementById('password-secret');
const passwordUrl = document.getElementById('password-url');
const passwordNotes = document.getElementById('password-notes');
const passwordCancel = document.getElementById('password-cancel');
const passwordList = document.getElementById('password-list');
const refreshPasswordsBtn = document.getElementById('refresh-passwords');

const state = {
  user: null,
  notes: [],
  selectedNoteId: null,
  passwords: [],
  editingPasswordId: null,
};

function setStatus(text) {
  statusEl.textContent = text;
}

async function api(path, options = {}) {
  const resp = await fetch(`${API_BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (resp.status === 204) return null;
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data.error || 'error');
  return data;
}

function formatDate(ts) {
  return new Date(ts * 1000).toLocaleString('ru-RU');
}

function showDashboard(user) {
  authPanel.hidden = true;
  dashboard.hidden = false;
  userEmailEl.textContent = user.email;
  userNickEl.textContent = user.nickname || 'Админ';
  setStatus(`Админ: ${user.email}`);
}

function hideDashboard() {
  dashboard.hidden = true;
  authPanel.hidden = false;
  setStatus('Требуется вход');
}

async function loadProfile() {
  try {
    const data = await api('/api/me');
    state.user = data.user;
    if (!data.user.is_admin) {
      hideDashboard();
      setStatus('Нужен аккаунт администратора');
      return;
    }
    showDashboard(data.user);
    await Promise.all([loadNotes(), loadPasswords()]);
  } catch (e) {
    state.user = null;
    hideDashboard();
  }
}

function renderNotes() {
  kbList.innerHTML = '';
  if (!state.notes.length) {
    kbList.innerHTML = '<p class="empty">Пока нет статей</p>';
    detailTitle.textContent = 'Выберите статью';
    detailMeta.textContent = '';
    detailBody.textContent = 'Здесь откроется полная версия записи';
    return;
  }
  state.notes.forEach((note) => {
    const card = document.createElement('div');
    card.className = 'kb-card';
    const title = document.createElement('h4');
    title.textContent = note.title;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${note.published ? 'Опубликовано' : 'Черновик'} · ${formatDate(note.updated_at)}`;
    const snippet = document.createElement('p');
    snippet.className = 'snippet';
    const content = note.content_md || '';
    snippet.textContent = content.length > 180 ? `${content.slice(0, 180)}…` : content || '—';
    card.append(title, meta, snippet);
    card.addEventListener('click', () => {
      state.selectedNoteId = note.id;
      loadNoteIntoForm(note);
      showNoteDetail(note);
    });
    kbList.appendChild(card);
  });
  const current = state.notes.find((n) => n.id === state.selectedNoteId) || state.notes[0];
  if (current) {
    state.selectedNoteId = current.id;
    showNoteDetail(current);
  }
}

function showNoteDetail(note) {
  detailTitle.textContent = note.title;
  detailMeta.textContent = `${note.published ? 'Опубликовано' : 'Черновик'} · ${formatDate(note.updated_at)}`;
  detailBody.textContent = note.content_md || '—';
}

function loadNoteIntoForm(note) {
  state.selectedNoteId = note.id;
  noteIdInput.value = note.id;
  noteTitle.value = note.title;
  noteContent.value = note.content_md;
  notePublish.checked = !!note.published;
  previewEl.textContent = note.content_md;
}

async function loadNotes() {
  try {
    const data = await api('/api/notes');
    state.notes = data.notes;
    renderNotes();
  } catch (e) {
    kbList.innerHTML = '<p class="empty">Не удалось загрузить статьи</p>';
  }
}

function resetNoteForm() {
  state.selectedNoteId = null;
  noteIdInput.value = '';
  noteForm.reset();
  previewEl.textContent = '';
  detailTitle.textContent = 'Новая статья';
  detailMeta.textContent = '';
  detailBody.textContent = 'Впишите текст и сохраните, чтобы увидеть полную версию';
}

noteForm.addEventListener('input', (e) => {
  if (e.target.name === 'content') {
    previewEl.textContent = e.target.value;
  }
});

noteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title: noteTitle.value,
    content: noteContent.value,
    published: notePublish.checked,
  };
  try {
    if (state.selectedNoteId) {
      await api(`/api/notes/${state.selectedNoteId}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/notes', { method: 'POST', body: JSON.stringify(body) });
    }
    resetNoteForm();
    await loadNotes();
  } catch (err) {
    alert('Не удалось сохранить статью');
  }
});

noteCancel.addEventListener('click', () => resetNoteForm());
newArticleBtn.addEventListener('click', () => {
  resetNoteForm();
  noteTitle.focus();
});
refreshNotesBtn.addEventListener('click', () => loadNotes());

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(authForm);
  const email = formData.get('email');
  const password = formData.get('password');
  loginBtn.disabled = true;
  setStatus('Вход...');
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    await loadProfile();
  } catch (err) {
    setStatus('Ошибка входа');
    alert('Неверные данные');
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  hideDashboard();
});

function renderPasswords() {
  passwordList.innerHTML = '';
  if (!state.passwords.length) {
    passwordList.innerHTML = '<p class="empty">Паролей пока нет</p>';
    return;
  }
  state.passwords.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'note-card';
    const title = document.createElement('h3');
    title.textContent = item.title;
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `Обновлено ${formatDate(item.updated_at)}`;
    const loginLine = document.createElement('p');
    loginLine.className = 'meta';
    loginLine.textContent = item.login ? `Логин: ${item.login}` : 'Логин: —';
    const url = document.createElement('p');
    url.className = 'meta';
    url.textContent = item.url ? `Ссылка: ${item.url}` : 'Ссылка: —';
    const secretRow = document.createElement('div');
    secretRow.className = 'card-actions';
    const secretText = document.createElement('span');
    secretText.textContent = 'Пароль: *****';
    const revealBtn = document.createElement('button');
    revealBtn.className = 'btn ghost';
    revealBtn.textContent = 'Показать';
    let revealed = false;
    revealBtn.addEventListener('click', () => {
      revealed = !revealed;
      secretText.textContent = revealed ? `Пароль: ${item.password}` : 'Пароль: *****';
      revealBtn.textContent = revealed ? 'Скрыть' : 'Показать';
    });
    secretRow.append(secretText, revealBtn);

    const notes = document.createElement('pre');
    notes.textContent = item.notes || '—';

    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'btn secondary';
    editBtn.textContent = 'Редактировать';
    editBtn.addEventListener('click', () => loadPasswordIntoForm(item));
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn danger';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', async () => {
      await api(`/api/passwords/${item.id}`, { method: 'DELETE' });
      await loadPasswords();
    });
    actions.append(editBtn, deleteBtn);

    card.append(title, meta, loginLine, url, secretRow, notes, actions);
    passwordList.appendChild(card);
  });
}

function resetPasswordForm() {
  state.editingPasswordId = null;
  passwordId.value = '';
  passwordForm.reset();
}

function loadPasswordIntoForm(item) {
  state.editingPasswordId = item.id;
  passwordId.value = item.id;
  passwordTitle.value = item.title;
  passwordLogin.value = item.login || '';
  passwordSecret.value = item.password || '';
  passwordUrl.value = item.url || '';
  passwordNotes.value = item.notes || '';
}

passwordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title: passwordTitle.value,
    login: passwordLogin.value,
    password: passwordSecret.value,
    url: passwordUrl.value,
    notes: passwordNotes.value,
  };
  if (!body.title || !body.password) {
    alert('Название и пароль обязательны');
    return;
  }
  try {
    if (state.editingPasswordId) {
      await api(`/api/passwords/${state.editingPasswordId}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/passwords', { method: 'POST', body: JSON.stringify(body) });
    }
    resetPasswordForm();
    await loadPasswords();
  } catch (err) {
    alert('Не удалось сохранить запись');
  }
});

passwordCancel.addEventListener('click', () => resetPasswordForm());
refreshPasswordsBtn.addEventListener('click', () => loadPasswords());

async function loadPasswords() {
  try {
    const data = await api('/api/passwords');
    state.passwords = data.items;
    renderPasswords();
  } catch (e) {
    passwordList.innerHTML = '<p class="empty">Не удалось загрузить пароли</p>';
  }
}

loadProfile();
