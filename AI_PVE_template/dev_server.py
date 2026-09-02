"""Zero-dependency static server with browser auto-reload for local testing."""

from __future__ import annotations

import argparse
import hashlib
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

_RELOAD_SCRIPT = """<script>
(() => {
  let version = null;
  const poll = async () => {
    try {
      const response = await fetch('/__reload?ts=' + Date.now(), { cache: 'no-store' });
      const payload = await response.json();
      if (version === null) version = payload.version;
      else if (payload.version !== version) window.location.reload();
    } catch (_) {
      // The server may be restarting; the next poll will retry.
    }
    window.setTimeout(poll, 700);
  };
  poll();
})();
</script>"""


def _fingerprint(root: Path) -> str:
    digest = hashlib.blake2b(digest_size=16)
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.name == "dev_server.py":
            continue
        if any(part in {".git", "__pycache__"} for part in path.relative_to(root).parts):
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        digest.update(str(path.relative_to(root)).encode("utf-8"))
        digest.update(str(stat.st_mtime_ns).encode("ascii"))
        digest.update(str(stat.st_size).encode("ascii"))
    return digest.hexdigest()


class DevRequestHandler(SimpleHTTPRequestHandler):
    server: "DevHTTPServer"

    def log_message(self, format: str, *args: object) -> None:
        # The browser polls this endpoint by design; keep that heartbeat out
        # of the access log so real asset/API requests remain readable.
        if urlsplit(self.path).path == "/__reload":
            return
        super().log_message(format, *args)

    def end_headers(self) -> None:  # noqa: N802 - stdlib handler hook
        # Avoid keeping an old app.js/ui.js in the browser during local edits.
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self) -> None:  # noqa: N802 - stdlib handler hook
        route = urlsplit(self.path).path
        if route == "/__reload":
            payload = json.dumps(
                {"version": _fingerprint(self.server.root)}, ensure_ascii=False
            ).encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
            return
        if route in {"", "/", "/index.html"}:
            self._serve_index()
            return
        file_path = Path(self.translate_path(self.path))
        if file_path.is_file():
            self._serve_static_file(file_path)
            return
        super().do_GET()

    def _serve_index(self) -> None:
        index_path = self.server.root / "index.html"
        content = index_path.read_text(encoding="utf-8")
        content = content.replace("</body>", f"{_RELOAD_SCRIPT}</body>", 1)
        payload = content.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_static_file(self, file_path: Path) -> None:
        payload = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", self.guess_type(str(file_path)))
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class DevHTTPServer(ThreadingHTTPServer):
    def __init__(self, root: Path, address: tuple[str, int]) -> None:
        self.root = root
        super().__init__(address, lambda *args, **kwargs: DevRequestHandler(*args, directory=str(root), **kwargs))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=18088)
    args = parser.parse_args()

    root = Path(__file__).resolve().parent
    server = DevHTTPServer(root, (args.host, args.port))
    print(f"Serving {root} at http://{args.host}:{args.port}/ (auto-reload enabled)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
