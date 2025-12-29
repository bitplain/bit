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

async function loadProfile() {
  try {
    const data = await api('/api/me');
    authPanel.hidden = true;
    profilePanel.hidden = false;
    notesPanel.hidden = false;
    setStatus(`Привет, ${data.user.email}`);
    profileData.innerHTML = '';
    const entries = [
      ['Email', data.user.email],
      ['Имя', data.user.full_name || '—'],
      ['Телефон', data.user.phone || '—'],
    ];
    entries.forEach(([label, value]) => {
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.textContent = `${label}: ${value}`;
      profileData.appendChild(pill);
    });
    await loadNotes();
  } catch (e) {
    profilePanel.hidden = true;
    notesPanel.hidden = true;
    authPanel.hidden = false;
    setStatus('Требуется вход');
  }
}

async function loadNotes() {
  try {
    const data = await api('/api/notes');
    notesList.innerHTML = '';
    data.notes.forEach((note) => {
      const card = document.createElement('div');
      card.className = 'note-card';
      const title = document.createElement('h3');
      title.textContent = note.title;
      const meta = document.createElement('p');
      const date = new Date(note.updated_at * 1000).toLocaleString('ru-RU');
      meta.textContent = `Обновлено ${date}`;
      const body = document.createElement('pre');
      body.textContent = note.content_md;
      card.append(title, meta, body);
      notesList.appendChild(card);
    });
  } catch (e) {
    notesList.innerHTML = '<p>Не удалось загрузить заметки</p>';
  }
}

authForm.addEventListener('input', (e) => {
  if (e.target.name === 'content') return;
});

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
});

noteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(noteForm);
  const title = formData.get('title');
  const content = formData.get('content');
  try {
    await api('/api/notes', { method: 'POST', body: JSON.stringify({ title, content }) });
    noteForm.reset();
    previewEl.textContent = '';
    await loadNotes();
  } catch (err) {
    alert('Не удалось сохранить заметку');
  }
});

loadProfile();
