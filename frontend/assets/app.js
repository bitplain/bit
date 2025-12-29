const API_BASE = 'http://localhost:8000';

const authPanel = document.getElementById('auth-panel');
const docsShell = document.getElementById('docs-shell');
const authForm = document.getElementById('auth-form');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const statusEl = document.getElementById('status');

const userCardEmail = document.getElementById('user-email');
const userCardNick = document.getElementById('user-nick');
const createNoteBtn = document.getElementById('create-note-btn');

const notesNav = document.getElementById('notes-nav');
const refreshNotesBtn = document.getElementById('refresh-notes');
const noteHeading = document.getElementById('note-heading');

const noteForm = document.getElementById('note-form');
const noteIdInput = document.getElementById('note-id');
const noteTitle = document.getElementById('note-title');
const noteContent = document.getElementById('note-content');
const notePublish = document.getElementById('note-publish');
const noteCancel = document.getElementById('note-cancel');
const previewEl = document.getElementById('preview');

const userForm = document.getElementById('user-form');
const userList = document.getElementById('user-list');
const userNickname = userForm?.querySelector('input[name="user_nickname"]');
const userEmail = userForm?.querySelector('input[name="user_email"]');
const userPassword = userForm?.querySelector('input[name="user_password"]');
const userPasswordConfirm = userForm?.querySelector('input[name="user_password_confirm"]');
const userIsAdmin = userForm?.querySelector('input[name="user_is_admin"]');
const toggleUserFormBtn = document.getElementById('toggle-user-form');

const currentPathInput = document.getElementById('current-path');
const refreshFilesBtn = document.getElementById('refresh-files');
const fileList = document.getElementById('file-list');
const folderForm = document.getElementById('folder-form');
const folderNameInput = document.getElementById('folder-name');
const uploadForm = document.getElementById('upload-form');
const fileInput = document.getElementById('file-input');

const state = {
  user: null,
  editingNoteId: null,
  notes: [],
  currentPath: '/',
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
  docsShell.hidden = false;
  setStatus(`Админ: ${user.email}`);
  userCardEmail.textContent = user.email;
  userCardNick.textContent = user.nickname || 'Админ';
}

function hideDashboard() {
  docsShell.hidden = true;
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
    await Promise.all([loadUsers(), loadNotes(), loadFiles(state.currentPath)]);
  } catch (e) {
    state.user = null;
    hideDashboard();
  }
}

async function loadUsers() {
  try {
    const data = await api('/api/admin/users');
    userList.innerHTML = '';
    data.users.forEach((u) => {
      const pill = document.createElement('div');
      pill.className = 'pill';
      pill.textContent = `${u.nickname} (${u.email})${u.is_admin ? ' · admin' : ''}`;
      userList.appendChild(pill);
    });
  } catch (e) {
    userList.innerHTML = '<p class="empty">Не удалось загрузить пользователей</p>';
  }
}

function renderNotesNav() {
  notesNav.innerHTML = '';
  if (!state.notes.length) {
    notesNav.innerHTML = '<p class="empty">Пока нет инструкций</p>';
    return;
  }
  state.notes.forEach((note) => {
    const item = document.createElement('div');
    item.className = 'nav-item';
    if (state.editingNoteId === note.id) item.classList.add('active');
    const title = document.createElement('div');
    title.textContent = note.title;
    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${note.published ? 'Опубликовано' : 'Черновик'} · ${formatDate(note.updated_at)}`;
    const actions = document.createElement('div');
    actions.className = 'card-actions';
    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'btn ghost small';
    toggleBtn.textContent = note.published ? 'Снять' : 'Опубликовать';
    toggleBtn.addEventListener('click', async (evt) => {
      evt.stopPropagation();
      await api(`/api/notes/${note.id}`, { method: 'PUT', body: JSON.stringify({ published: !note.published }) });
      await loadNotes();
    });
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn danger small';
    deleteBtn.textContent = 'Удалить';
    deleteBtn.addEventListener('click', async (evt) => {
      evt.stopPropagation();
      await api(`/api/notes/${note.id}`, { method: 'DELETE' });
      await loadNotes();
    });
    actions.append(toggleBtn, deleteBtn);
    item.append(title, meta, actions);
    item.addEventListener('click', () => loadNoteIntoForm(note));
    notesNav.appendChild(item);
  });
}

function loadNoteIntoForm(note) {
  state.editingNoteId = note.id;
  noteHeading.textContent = 'Редактирование инструкции';
  noteIdInput.value = note.id;
  noteTitle.value = note.title;
  noteContent.value = note.content_md;
  notePublish.checked = !!note.published;
  previewEl.textContent = note.content_md;
  renderNotesNav();
  noteTitle.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function loadNotes() {
  try {
    const data = await api('/api/notes');
    state.notes = data.notes;
    renderNotesNav();
  } catch (e) {
    notesNav.innerHTML = '<p class="empty">Не удалось загрузить инструкции</p>';
  }
}

function resetNoteForm() {
  state.editingNoteId = null;
  noteHeading.textContent = 'Новая инструкция';
  noteIdInput.value = '';
  noteForm.reset();
  previewEl.textContent = '';
  renderNotesNav();
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
    if (state.editingNoteId) {
      await api(`/api/notes/${state.editingNoteId}`, { method: 'PUT', body: JSON.stringify(body) });
    } else {
      await api('/api/notes', { method: 'POST', body: JSON.stringify(body) });
    }
    resetNoteForm();
    await loadNotes();
  } catch (err) {
    alert('Не удалось сохранить инструкцию');
  }
});

noteCancel.addEventListener('click', () => {
  resetNoteForm();
});

createNoteBtn.addEventListener('click', () => {
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

toggleUserFormBtn.addEventListener('click', () => {
  const isHidden = userForm.hidden;
  userForm.hidden = !isHidden;
  toggleUserFormBtn.textContent = isHidden ? 'Скрыть' : 'Создать';
});

userForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nickname = userNickname.value.trim();
  const email = userEmail.value.trim();
  const password = userPassword.value;
  const passwordConfirm = userPasswordConfirm.value;
  const isAdmin = userIsAdmin.checked;
  if (!nickname || !email || !password) {
    alert('Заполните ник, email и пароль');
    return;
  }
  if (password !== passwordConfirm) {
    alert('Пароли не совпадают');
    return;
  }
  try {
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({ nickname, email, password, is_admin: isAdmin }),
    });
    userForm.reset();
    await loadUsers();
  } catch (err) {
    alert('Не удалось создать пользователя');
  }
});

function joinPath(base, name) {
  const cleanedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  return `${cleanedBase}/${name}`.replace(/\/+/g, '/');
}

async function loadFiles(path) {
  state.currentPath = path || '/';
  currentPathInput.value = state.currentPath;
  try {
    const encoded = encodeURIComponent(state.currentPath);
    const data = await api(`/api/files?path=${encoded}`);
    fileList.innerHTML = '';
    const entries = data.entries || [];
    if (state.currentPath !== '/') {
      const upRow = document.createElement('div');
      upRow.className = 'file-row';
      upRow.innerHTML = '<strong>..</strong><span class="file-meta">Назад</span>';
      upRow.addEventListener('click', () => {
        const parts = state.currentPath.split('/').filter(Boolean);
        parts.pop();
        const newPath = '/' + parts.join('/');
        loadFiles(newPath || '/');
      });
      fileList.appendChild(upRow);
    }
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'Пусто';
      fileList.appendChild(empty);
      return;
    }
    entries.forEach((entry) => {
      const row = document.createElement('div');
      row.className = 'file-row';
      const title = document.createElement('div');
      title.innerHTML = `<strong>${entry.name}</strong><div class="file-meta">${entry.is_dir ? 'папка' : 'файл'} · ${entry.size}b</div>`;
      row.appendChild(title);
      const actions = document.createElement('div');
      actions.className = 'card-actions';
      if (entry.is_dir) {
        const openBtn = document.createElement('button');
        openBtn.className = 'btn secondary';
        openBtn.textContent = 'Открыть';
        openBtn.addEventListener('click', () => loadFiles(joinPath(state.currentPath, entry.name)));
        actions.appendChild(openBtn);
      }
      const delBtn = document.createElement('button');
      delBtn.className = 'btn danger';
      delBtn.textContent = 'Удалить';
      delBtn.addEventListener('click', async () => {
        const rel = joinPath(state.currentPath, entry.name);
        await api(`/api/files?path=${encodeURIComponent(rel)}`, { method: 'DELETE' });
        await loadFiles(state.currentPath);
      });
      actions.appendChild(delBtn);
      row.appendChild(actions);
      fileList.appendChild(row);
    });
  } catch (err) {
    fileList.innerHTML = '<p class="empty">Не удалось загрузить файлы</p>';
  }
}

refreshFilesBtn.addEventListener('click', () => loadFiles(currentPathInput.value || '/'));

folderForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = folderNameInput.value.trim();
  if (!name) return;
  try {
    await api('/api/files/folder', {
      method: 'POST',
      body: JSON.stringify({ path: state.currentPath, name }),
    });
    folderNameInput.value = '';
    await loadFiles(state.currentPath);
  } catch (err) {
    alert('Не удалось создать папку');
  }
});

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    const contentBase64 = reader.result.split(',')[1];
    try {
      await api('/api/files/upload', {
        method: 'POST',
        body: JSON.stringify({
          path: state.currentPath,
          name: file.name,
          content_base64: contentBase64,
        }),
      });
      fileInput.value = '';
      await loadFiles(state.currentPath);
    } catch (err) {
      alert('Не удалось загрузить файл');
    }
  };
  reader.readAsDataURL(file);
});

loadProfile();
