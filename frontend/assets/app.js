const API_BASE = 'http://localhost:8000';

const authForm = document.getElementById('auth-form');
const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const logoutBtn = document.getElementById('logout-btn');
const profilePanel = document.getElementById('profile-panel');
const notesPanel = document.getElementById('notes-panel');
const authPanel = document.getElementById('auth-panel');
const profileData = document.getElementById('profile-data');
const statusEl = document.getElementById('status');
const notesList = document.getElementById('notes-list');
const noteForm = document.getElementById('note-form');
const previewEl = document.getElementById('preview');
const blogList = document.getElementById('blog-list');
const managerLink = document.getElementById('password-manager-link');
const profileForm = document.getElementById('profile-form');
const fullNameInput = document.getElementById('full-name');
const phoneInput = document.getElementById('phone');
const managerUrlInput = document.getElementById('manager-url');

const state = { user: null };

function setStatus(text) {
  statusEl.textContent = text;
}

function updatePasswordManagerLink(url) {
  if (url) {
    managerLink.href = url;
    managerLink.textContent = 'Менеджер паролей';
    managerLink.target = '_blank';
    managerLink.rel = 'noreferrer';
    managerLink.classList.remove('inactive');
  } else {
    managerLink.href = '#';
    managerLink.textContent = 'Добавьте ссылку на менеджер паролей';
    managerLink.removeAttribute('target');
    managerLink.classList.add('inactive');
  }
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

function renderProfile(user) {
  profileData.innerHTML = '';
  const entries = [
    ['Email', user.email],
    ['Имя', user.full_name || '—'],
    ['Телефон', user.phone || '—'],
    ['Менеджер паролей', user.password_manager_url ? 'привязан' : 'нет ссылки'],
  ];
  entries.forEach(([label, value]) => {
    const pill = document.createElement('div');
    pill.className = 'pill';
    pill.textContent = `${label}: ${value}`;
    profileData.appendChild(pill);
  });
  fullNameInput.value = user.full_name || '';
  phoneInput.value = user.phone || '';
  managerUrlInput.value = user.password_manager_url || '';
  updatePasswordManagerLink(user.password_manager_url);
}

async function loadProfile() {
  try {
    const data = await api('/api/me');
    state.user = data.user;
    authPanel.hidden = true;
    profilePanel.hidden = false;
    notesPanel.hidden = false;
    setStatus(`Привет, ${data.user.email}`);
    renderProfile(data.user);
    await loadNotes();
    await loadBlog();
  } catch (e) {
    state.user = null;
    profilePanel.hidden = true;
    notesPanel.hidden = true;
    authPanel.hidden = false;
    setStatus('Требуется вход');
    updatePasswordManagerLink('');
  }
}

function formatDate(ts) {
  return new Date(ts * 1000).toLocaleString('ru-RU');
}

async function loadNotes() {
  try {
    const data = await api('/api/notes');
    notesList.innerHTML = '';
    if (!data.notes.length) {
      notesList.innerHTML = '<p class="empty">Пока нет записей. Добавьте черновик или опубликуйте сразу.</p>';
      return;
    }
    data.notes.forEach((note) => {
      const card = document.createElement('div');
      card.className = 'note-card';

      const title = document.createElement('h3');
      title.textContent = note.title;

      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = `Обновлено ${formatDate(note.updated_at)}`;

      const badge = document.createElement('span');
      badge.className = `badge ${note.published ? 'published' : 'draft'}`;
      badge.textContent = note.published ? 'Опубликовано' : 'Черновик';

      const body = document.createElement('pre');
      body.textContent = note.content_md || '—';

      const actions = document.createElement('div');
      actions.className = 'card-actions';

      const toggleBtn = document.createElement('button');
      toggleBtn.className = note.published ? 'btn ghost' : 'btn secondary';
      toggleBtn.textContent = note.published ? 'Снять с публикации' : 'Опубликовать';
      toggleBtn.addEventListener('click', async () => {
        await api(`/api/notes/${note.id}`, {
          method: 'PUT',
          body: JSON.stringify({ published: !note.published }),
        });
        await loadNotes();
        await loadBlog();
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn danger';
      deleteBtn.textContent = 'Удалить';
      deleteBtn.addEventListener('click', async () => {
        await api(`/api/notes/${note.id}`, { method: 'DELETE' });
        await loadNotes();
        await loadBlog();
      });

      actions.append(toggleBtn, deleteBtn);
      card.append(title, badge, meta, body, actions);
      notesList.appendChild(card);
    });
  } catch (e) {
    notesList.innerHTML = '<p class="empty">Не удалось загрузить заметки</p>';
  }
}

async function loadBlog() {
  try {
    const data = await api('/api/blog');
    blogList.innerHTML = '';
    if (!data.notes.length) {
      blogList.innerHTML = '<p class="empty">Здесь появятся опубликованные карточки блога.</p>';
      return;
    }
    data.notes.forEach((note) => {
      const card = document.createElement('div');
      card.className = 'note-card';
      const title = document.createElement('h3');
      title.textContent = note.title;
      const meta = document.createElement('p');
      meta.className = 'meta';
      meta.textContent = `Обновлено ${formatDate(note.updated_at)} · Автор: ${note.author_email}`;
      const body = document.createElement('pre');
      const excerpt = note.content_md.length > 320 ? `${note.content_md.slice(0, 320)}…` : note.content_md;
      body.textContent = excerpt;
      card.append(title, meta, body);
      blogList.appendChild(card);
    });
  } catch (e) {
    blogList.innerHTML = '<p class="empty">Не удалось загрузить блог</p>';
  }
}

noteForm.addEventListener('input', (e) => {
  if (e.target.name === 'content') {
    previewEl.textContent = e.target.value;
  }
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(authForm);
  const email = formData.get('email');
  const password = formData.get('password');
  loginBtn.disabled = true;
  setStatus('Выполняем вход...');
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

registerBtn.addEventListener('click', async () => {
  const formData = new FormData(authForm);
  const email = formData.get('email');
  const password = formData.get('password');
  try {
    await api('/api/register', { method: 'POST', body: JSON.stringify({ email, password }) });
    setStatus('Аккаунт создан. Войдите.');
  } catch (err) {
    alert('Не удалось зарегистрировать, возможно, почта уже существует.');
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  authPanel.hidden = false;
  profilePanel.hidden = true;
  notesPanel.hidden = true;
  setStatus('Вышли из аккаунта');
  updatePasswordManagerLink('');
  await loadBlog();
});

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    full_name: fullNameInput.value,
    phone: phoneInput.value,
    password_manager_url: managerUrlInput.value,
  };
  try {
    await api('/api/me', { method: 'PUT', body: JSON.stringify(body) });
    setStatus('Профиль обновлён');
    await loadProfile();
  } catch (err) {
    alert('Не удалось сохранить профиль');
  }
});

noteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(noteForm);
  const title = formData.get('title');
  const content = formData.get('content');
  const publish = formData.get('publish') === 'on';
  try {
    await api('/api/notes', { method: 'POST', body: JSON.stringify({ title, content, published: publish }) });
    noteForm.reset();
    previewEl.textContent = '';
    await loadNotes();
    await loadBlog();
  } catch (err) {
    alert('Не удалось сохранить заметку');
  }
});

loadProfile();
loadBlog();
