import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse

DB_PATH = os.environ.get("DB_PATH", "/data/app.db")
APP_SECRET = os.environ.get("APP_SECRET", "dev-secret")
FRONTEND_ORIGIN = os.environ.get("FRONTEND_ORIGIN", "http://localhost:4173")
FILES_ROOT = os.environ.get("FILES_ROOT", "/data/files")
DEFAULT_ADMIN_EMAIL = os.environ.get("DEFAULT_ADMIN_EMAIL", "a.moskalev")
DEFAULT_ADMIN_PASSWORD = os.environ.get("DEFAULT_ADMIN_PASSWORD", "120488")
ADMIN_SEED_MARKER = os.path.join(os.path.dirname(DB_PATH) or ".", ".admin_seeded")


def ensure_column(conn, table: str, column: str, definition: str):
    cols = [row[1] for row in conn.execute(f"PRAGMA table_info({table})")]
    if column not in cols:
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {definition}")


def ensure_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    os.makedirs(FILES_ROOT, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nickname TEXT,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT,
            phone TEXT,
            password_manager_url TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            token TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            title TEXT NOT NULL,
            content_md TEXT NOT NULL,
            published INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )
        """
    )
    ensure_column(conn, "users", "password_manager_url", "TEXT")
    ensure_column(conn, "users", "is_admin", "INTEGER NOT NULL DEFAULT 0")
    ensure_column(conn, "users", "nickname", "TEXT")
    ensure_column(conn, "notes", "published", "INTEGER NOT NULL DEFAULT 0")

    seed_default_admin(conn)
    conn.commit()
    conn.close()


def seed_default_admin(conn):
    if os.path.exists(ADMIN_SEED_MARKER):
        return
    conn.execute("DELETE FROM sessions")
    conn.execute("DELETE FROM notes")
    conn.execute("DELETE FROM users")
    conn.execute(
        "INSERT INTO users (nickname, email, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
        (
            "Администратор",
            DEFAULT_ADMIN_EMAIL.lower(),
            hash_password(DEFAULT_ADMIN_PASSWORD),
            1,
            int(time.time()),
        ),
    )
    conn.commit()
    with open(ADMIN_SEED_MARKER, "w", encoding="utf-8") as marker:
        marker.write(str(int(time.time())))


def get_conn():
    ensure_db()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    hashed = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return base64.b64encode(salt + hashed).decode()


def verify_password(password: str, stored: str) -> bool:
    try:
        data = base64.b64decode(stored.encode())
        salt, hashed = data[:16], data[16:]
        new_hash = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
        return hmac.compare_digest(hashed, new_hash)
    except Exception:
        return False


def simple_encrypt(plaintext: str) -> str:
    # Примитивный XOR-подход для прототипа (заменить на настоящую криптографию в продакшене)
    key = hashlib.sha256(APP_SECRET.encode()).digest()
    data = plaintext.encode()
    xored = bytes(b ^ key[i % len(key)] for i, b in enumerate(data))
    return base64.b64encode(xored).decode()


def simple_decrypt(ciphertext: str) -> str:
    try:
        key = hashlib.sha256(APP_SECRET.encode()).digest()
        data = base64.b64decode(ciphertext.encode())
        plain = bytes(b ^ key[i % len(key)] for i, b in enumerate(data))
        return plain.decode()
    except Exception:
        return ""


def clean_url(value: str) -> str:
    url = (value or "").strip()
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    return url


def resolve_path(rel_path: str) -> str:
    rel = (rel_path or "").strip()
    rel = rel.lstrip("/")
    safe_path = os.path.normpath(os.path.join(FILES_ROOT, rel))
    if not safe_path.startswith(os.path.abspath(FILES_ROOT)):
        raise ValueError("invalid_path")
    return safe_path


def parse_json(handler: BaseHTTPRequestHandler):
    length = int(handler.headers.get("Content-Length", "0"))
    raw = handler.rfile.read(length) if length else b""
    if not raw:
        return {}
    try:
        return json.loads(raw.decode())
    except json.JSONDecodeError:
        return {}


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict, extra_headers=None):
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Access-Control-Allow-Origin", FRONTEND_ORIGIN)
    handler.send_header("Access-Control-Allow-Credentials", "true")
    if extra_headers:
        for k, v in extra_headers.items():
            handler.send_header(k, v)
    handler.end_headers()
    handler.wfile.write(json.dumps(payload).encode())


def set_session_cookie(handler: BaseHTTPRequestHandler, token: str):
    cookie = f"session={token}; Path=/; HttpOnly; SameSite=Lax"
    handler.send_header("Set-Cookie", cookie)


def get_session_token(handler: BaseHTTPRequestHandler):
    cookie_header = handler.headers.get("Cookie")
    if not cookie_header:
        return None
    for part in cookie_header.split(';'):
        if '=' not in part:
            continue
        name, value = part.strip().split('=', 1)
        if name == 'session':
            return value
    return None


def with_session(handler: BaseHTTPRequestHandler):
    token = get_session_token(handler)
    if not token:
        return None
    conn = get_conn()
    now = int(time.time())
    row = conn.execute(
        "SELECT sessions.token, sessions.user_id, users.email, users.nickname, users.full_name, users.phone, users.password_manager_url, users.is_admin "
        "FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ? AND sessions.expires_at > ?",
        (token, now),
    ).fetchone()
    conn.close()
    return row


def is_admin(session) -> bool:
    return bool(session and len(session) > 7 and session[7])


class AppHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):  # noqa: N802
        # Тише в контейнере
        return

    def do_OPTIONS(self):  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", FRONTEND_ORIGIN)
        self.send_header("Access-Control-Allow-Credentials", "true")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS")
        self.end_headers()

    def do_GET(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            json_response(self, 200, {"status": "ok"})
            return

        if parsed.path == "/api/me":
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            user = {
                "nickname": session[3],
                "email": session[2],
                "full_name": simple_decrypt(session[4]) if session[4] else None,
                "phone": simple_decrypt(session[5]) if session[5] else None,
                "password_manager_url": simple_decrypt(session[6]) if session[6] else None,
                "is_admin": bool(session[7]),
            }
            json_response(self, 200, {"user": user})
            return

        if parsed.path == "/api/notes":
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            if not is_admin(session):
                json_response(self, 403, {"error": "admin_only"})
                return
            conn = get_conn()
            rows = conn.execute(
                "SELECT id, title, content_md, published, created_at, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC",
                (session[1],),
            ).fetchall()
            conn.close()
            notes = [dict(row) for row in rows]
            json_response(self, 200, {"notes": notes})
            return

        if parsed.path == "/api/admin/users":
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            if not is_admin(session):
                json_response(self, 403, {"error": "admin_only"})
                return
            conn = get_conn()
            rows = conn.execute(
                "SELECT id, nickname, email, is_admin, created_at FROM users ORDER BY created_at DESC"
            ).fetchall()
            conn.close()
            users = [
                {
                    "id": row["id"],
                    "nickname": row["nickname"],
                    "email": row["email"],
                    "is_admin": bool(row["is_admin"]),
                    "created_at": row["created_at"],
                }
                for row in rows
            ]
            json_response(self, 200, {"users": users})
            return

        if parsed.path == "/api/files":
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            if not is_admin(session):
                json_response(self, 403, {"error": "admin_only"})
                return
            qs = parse_qs(parsed.query)
            rel = qs.get("path", [""])[0]
            try:
                target = resolve_path(rel)
            except ValueError:
                json_response(self, 400, {"error": "invalid_path"})
                return
            entries = []
            if os.path.exists(target):
                for entry in os.scandir(target):
                    info = entry.stat()
                    entries.append(
                        {
                            "name": entry.name,
                            "is_dir": entry.is_dir(),
                            "size": info.st_size,
                            "modified": int(info.st_mtime),
                        }
                    )
            json_response(self, 200, {"path": rel, "entries": entries})
            return

        if parsed.path == "/api/blog":
            conn = get_conn()
            rows = conn.execute(
                "SELECT notes.id, notes.title, notes.content_md, notes.updated_at, users.email AS author_email "
                "FROM notes JOIN users ON users.id = notes.user_id WHERE notes.published = 1 "
                "ORDER BY notes.updated_at DESC LIMIT 100"
            ).fetchall()
            conn.close()
            notes = [
                {
                    "id": row["id"],
                    "title": row["title"],
                    "content_md": row["content_md"],
                    "updated_at": row["updated_at"],
                    "author_email": row["author_email"],
                }
                for row in rows
            ]
            json_response(self, 200, {"notes": notes})
            return

        json_response(self, 404, {"error": "not_found"})

    def do_POST(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/register":
            json_response(self, 403, {"error": "registration_disabled"})
            return

        if parsed.path == "/api/login":
            data = parse_json(self)
            email = (data.get("email") or "").strip().lower()
            password = data.get("password") or ""
            conn = get_conn()
            row = conn.execute(
                "SELECT id, password_hash FROM users WHERE email = ?",
                (email,),
            ).fetchone()
            if not row or not verify_password(password, row[1]):
                conn.close()
                json_response(self, 401, {"error": "invalid_credentials"})
                return
            token = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
            expires = int(time.time()) + 7 * 24 * 3600
            conn.execute(
                "INSERT OR REPLACE INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
                (token, row[0], expires, int(time.time())),
            )
            conn.commit()
            conn.close()
            self.send_response(200)
            set_session_cookie(self, token)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", FRONTEND_ORIGIN)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())
            return

        if parsed.path == "/api/logout":
            token = get_session_token(self)
            if token:
                conn = get_conn()
                conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
                conn.commit()
                conn.close()
            self.send_response(200)
            self.send_header("Set-Cookie", "session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax")
            self.send_header("Access-Control-Allow-Origin", FRONTEND_ORIGIN)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(json.dumps({"ok": True}).encode())
            return

        if parsed.path == "/api/admin/users":
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            if not is_admin(session):
                json_response(self, 403, {"error": "admin_only"})
                return
            data = parse_json(self)
            nickname = (data.get("nickname") or "").strip()
            email = (data.get("email") or "").strip().lower()
            password = data.get("password") or ""
            make_admin = 1 if data.get("is_admin") else 0
            if not email or not password or not nickname:
                json_response(self, 400, {"error": "nickname_email_and_password_required"})
                return
            conn = get_conn()
            try:
                conn.execute(
                    "INSERT INTO users (nickname, email, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
                    (nickname, email, hash_password(password), make_admin, int(time.time())),
                )
                conn.commit()
            except sqlite3.IntegrityError:
                conn.close()
                json_response(self, 409, {"error": "email_exists"})
                return
            conn.close()
            json_response(self, 201, {"ok": True})
            return

        if parsed.path == "/api/files/upload":
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            if not is_admin(session):
                json_response(self, 403, {"error": "admin_only"})
                return
            data = parse_json(self)
            rel_path = data.get("path") or ""
            name = data.get("name") or ""
            content_b64 = data.get("content_base64") or ""
            if not name or not content_b64:
                json_response(self, 400, {"error": "name_and_content_required"})
                return
            try:
                target_dir = resolve_path(rel_path)
                os.makedirs(target_dir, exist_ok=True)
                content = base64.b64decode(content_b64.encode())
                dest = resolve_path(os.path.join(rel_path, name))
                if os.path.isdir(dest):
                    json_response(self, 400, {"error": "path_is_directory"})
                    return
                with open(dest, "wb") as f:
                    f.write(content)
                json_response(self, 201, {"ok": True})
            except ValueError:
                json_response(self, 400, {"error": "invalid_path"})
            except Exception:
                json_response(self, 500, {"error": "write_failed"})
            return

        if parsed.path == "/api/files/folder":
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            if not is_admin(session):
                json_response(self, 403, {"error": "admin_only"})
                return
            data = parse_json(self)
            rel_path = data.get("path") or ""
            name = (data.get("name") or "").strip()
            if not name:
                json_response(self, 400, {"error": "name_required"})
                return
            try:
                target = resolve_path(os.path.join(rel_path, name))
                os.makedirs(target, exist_ok=True)
                json_response(self, 201, {"ok": True})
            except ValueError:
                json_response(self, 400, {"error": "invalid_path"})
            except Exception:
                json_response(self, 500, {"error": "mkdir_failed"})
            return

        if parsed.path == "/api/notes":
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            if not is_admin(session):
                json_response(self, 403, {"error": "admin_only"})
                return
            data = parse_json(self)
            title = (data.get("title") or "").strip()
            content = data.get("content") or ""
            published = 1 if data.get("published") else 0
            if not title:
                json_response(self, 400, {"error": "title_required"})
                return
            now = int(time.time())
            conn = get_conn()
            conn.execute(
                "INSERT INTO notes (user_id, title, content_md, published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
                (session[1], title, content, published, now, now),
            )
            conn.commit()
            conn.close()
            json_response(self, 201, {"ok": True})
            return

        json_response(self, 404, {"error": "not_found"})

    def do_PUT(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/api/me":
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            data = parse_json(self)
            full_name = (data.get("full_name") or "").strip()
            phone = (data.get("phone") or "").strip()
            password_manager_url = clean_url(data.get("password_manager_url"))
            conn = get_conn()
            conn.execute(
                "UPDATE users SET full_name = ?, phone = ?, password_manager_url = ? WHERE id = ?",
                (
                    simple_encrypt(full_name) if full_name else None,
                    simple_encrypt(phone) if phone else None,
                    simple_encrypt(password_manager_url) if password_manager_url else None,
                    session[1],
                ),
            )
            conn.commit()
            conn.close()
            json_response(self, 200, {"ok": True})
            return

        if parsed.path.startswith("/api/notes/"):
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            if not is_admin(session):
                json_response(self, 403, {"error": "admin_only"})
                return
            try:
                note_id = int(parsed.path.split("/")[-1])
            except ValueError:
                json_response(self, 400, {"error": "invalid_id"})
                return
            data = parse_json(self)
            conn = get_conn()
            row = conn.execute(
                "SELECT id, title, content_md, published FROM notes WHERE id = ? AND user_id = ?",
                (note_id, session[1]),
            ).fetchone()
            if not row:
                conn.close()
                json_response(self, 404, {"error": "not_found"})
                return
            title = (data.get("title", row["title"]) or "").strip()
            content = data.get("content")
            if content is None:
                content = row["content_md"]
            published = row["published"]
            if "published" in data:
                published = 1 if data.get("published") else 0
            if not title:
                conn.close()
                json_response(self, 400, {"error": "title_required"})
                return
            conn.execute(
                "UPDATE notes SET title = ?, content_md = ?, published = ?, updated_at = ? WHERE id = ?",
                (title, content, published, int(time.time()), note_id),
            )
            conn.commit()
            conn.close()
            json_response(self, 200, {"ok": True})
            return
        json_response(self, 404, {"error": "not_found"})

    def do_DELETE(self):  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path.startswith("/api/notes/"):
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            if not is_admin(session):
                json_response(self, 403, {"error": "admin_only"})
                return
            try:
                note_id = int(parsed.path.split("/")[-1])
            except ValueError:
                json_response(self, 400, {"error": "invalid_id"})
                return
            conn = get_conn()
            conn.execute(
                "DELETE FROM notes WHERE id = ? AND user_id = ?",
                (note_id, session[1]),
            )
            conn.commit()
            conn.close()
            json_response(self, 200, {"ok": True})
            return
        if parsed.path == "/api/files":
            session = with_session(self)
            if not session:
                json_response(self, 401, {"error": "auth_required"})
                return
            if not is_admin(session):
                json_response(self, 403, {"error": "admin_only"})
                return
            qs = parse_qs(parsed.query)
            rel = qs.get("path", [""])[0]
            try:
                target = resolve_path(rel)
                if os.path.isdir(target):
                    if os.listdir(target):
                        json_response(self, 400, {"error": "dir_not_empty"})
                        return
                    os.rmdir(target)
                elif os.path.isfile(target):
                    os.remove(target)
                json_response(self, 200, {"ok": True})
            except ValueError:
                json_response(self, 400, {"error": "invalid_path"})
            except FileNotFoundError:
                json_response(self, 404, {"error": "not_found"})
            except Exception:
                json_response(self, 500, {"error": "delete_failed"})
            return
        json_response(self, 404, {"error": "not_found"})


def run():
    port = int(os.environ.get("PORT", "8000"))
    ensure_db()
    server = HTTPServer(("0.0.0.0", port), AppHandler)
    print(f"Backend running on port {port}")
    server.serve_forever()


if __name__ == "__main__":
    run()
