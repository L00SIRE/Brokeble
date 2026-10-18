"""Tests for the tab CLI (B plan T3). Run: python -I -m unittest discover -s skills/tab

The CLI has no .py extension, so it runs as a subprocess against an http.server stub on 127.0.0.1.
"""
import json
import os
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

TAB = os.path.join(os.path.dirname(os.path.realpath(__file__)), "tab")
TOKEN = "tok-SECRET-123"


class Stub(BaseHTTPRequestHandler):
    """Class-level script: `replies` is a list of (status, body|None) popped per request; `seen` records requests."""
    replies = []
    seen = []

    def _handle(self):
        n = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(n) or b"null") if n else None
        Stub.seen.append((self.command, self.path, self.headers.get("Authorization"), body))
        status, out = Stub.replies.pop(0) if Stub.replies else (200, {"ok": True})
        raw = b"" if out is None else json.dumps(out).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    do_GET = do_POST = _handle

    def log_message(self, *a):
        pass


class CliCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.srv = HTTPServer(("127.0.0.1", 0), Stub)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_port

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.srv.server_close()

    def setUp(self):
        Stub.replies, Stub.seen = [], []

    def run_tab(self, *args, env=True, base=None):
        e = {k: v for k, v in os.environ.items() if not k.startswith("TAB_")}
        if env:
            e.update(TAB_API_BASE=base or self.base, TAB_AGENT_TOKEN=TOKEN)
        p = subprocess.run([sys.executable, "-I", TAB, *args], capture_output=True, text=True, env=e, timeout=60)
        self.assertNotIn(TOKEN, p.stdout + p.stderr)
        return p

    def write_json(self, obj):
        f = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        self.addCleanup(os.unlink, f.name)
        f.write(obj if isinstance(obj, str) else json.dumps(obj))
        f.close()
        return f.name


class UsageTests(CliCase):
    def test_help_exits_0(self):
        self.assertEqual(self.run_tab("--help", env=False).returncode, 0)

    def test_no_command_is_usage_error(self):
        self.assertEqual(self.run_tab(env=False).returncode, 2)

    def test_bad_choice_is_usage_error(self):
        self.assertEqual(self.run_tab("progress", "--plan", "x", "--kind", "nope", "step").returncode, 2)
        self.assertEqual(self.run_tab("schema", "unknown").returncode, 2)

    def test_missing_file_is_usage_error(self):
        self.assertEqual(self.run_tab("options", "validate", "/nonexistent/x.json").returncode, 2)


class EnvTests(CliCase):
    def test_missing_env_exits_3(self):
        self.assertEqual(self.run_tab("ping", env=False).returncode, 3)

    def test_non_http_base_exits_3(self):
        self.assertEqual(self.run_tab("ping", base="file:///etc").returncode, 3)

    def test_network_error_exits_4(self):
        self.assertEqual(self.run_tab("ping", base="http://127.0.0.1:1").returncode, 4)


class RequestTests(CliCase):
    def test_ping_ok_sends_bearer(self):
        p = self.run_tab("ping")
        self.assertEqual((p.returncode, p.stdout.strip()), (0, "ok"))
        self.assertEqual(Stub.seen[0][:3], ("GET", "/agent/ping", "Bearer " + TOKEN))

    def test_unauthorized_exits_5(self):
        Stub.replies = [(403, {"error": "forbidden"})]
        self.assertEqual(self.run_tab("ping").returncode, 5)

    def test_progress_body_and_truncation(self):
        Stub.replies = [(202, {"ok": True})]
        p = self.run_tab("progress", "--plan", "ref-1", "--kind", "scout", "--category", "dinner", "x" * 200)
        self.assertEqual(p.returncode, 0)
        _, path, _, body = Stub.seen[0]
        self.assertEqual(path, "/agent/progress")
        self.assertEqual(body, {"plan_ref": "ref-1", "run_kind": "scout", "category": "dinner", "step": "x" * 140})

    def test_progress_category_null_for_concierge(self):
        self.run_tab("progress", "--plan", "ref-1", "--kind", "concierge", "booking")
        self.assertIsNone(Stub.seen[0][3]["category"])

    def test_options_validate_ok(self):
        f = self.write_json({"category": "dinner", "options": []})
        p = self.run_tab("options", "validate", f)
        self.assertEqual((p.returncode, p.stdout.strip()), (0, "ok"))
        self.assertEqual(Stub.seen[0][1], "/agent/options/validate")
        self.assertEqual(Stub.seen[0][3]["category"], "dinner")

    def test_validate_200_with_errors_exits_1(self):
        Stub.replies = [(200, {"ok": False, "errors": [{"path": "options.0.url", "message": "Invalid URL"}]})]
        p = self.run_tab("options", "validate", self.write_json({}))
        self.assertEqual(p.returncode, 1)
        self.assertEqual(p.stdout.strip(), "options.0.url: Invalid URL")

    def test_submit_422_prints_paths_exits_1(self):
        Stub.replies = [(422, {"ok": False, "errors": [{"path": "options.2.area", "message": "wrong area"}, {"path": "", "message": "bad"}]})]
        p = self.run_tab("options", "submit", self.write_json({}))
        self.assertEqual(p.returncode, 1)
        self.assertEqual(p.stdout.splitlines(), ["options.2.area: wrong area", "(root): bad"])
        self.assertEqual(Stub.seen[0][1], "/agent/options")

    def test_submit_201_prints_accepted(self):
        Stub.replies = [(201, {"ok": True, "accepted": 7})]
        p = self.run_tab("options", "submit", self.write_json({}))
        self.assertEqual((p.returncode, p.stdout.split()), (0, ["ok", "accepted:", "7"]))

    def test_itinerary_submit(self):
        p = self.run_tab("itinerary", "submit", self.write_json({"title": "t"}))
        self.assertEqual((p.returncode, Stub.seen[0][1]), (0, "/agent/itinerary"))

    def test_invalid_json_file_exits_1(self):
        p = self.run_tab("itinerary", "submit", self.write_json("{nope"))
        self.assertEqual(p.returncode, 1)
        self.assertEqual(Stub.seen, [])

    def test_retries_503_then_200(self):
        Stub.replies = [(503, None), (200, {"ok": True})]
        self.assertEqual(self.run_tab("ping").returncode, 0)
        self.assertEqual(len(Stub.seen), 2)

    def test_persistent_500_exits_5(self):
        Stub.replies = [(500, None)] * 3
        self.assertEqual(self.run_tab("ping").returncode, 5)
        self.assertEqual(len(Stub.seen), 3)

    def test_redirect_not_followed(self):
        Stub.replies = [(302, None)]
        self.assertEqual(self.run_tab("ping").returncode, 5)
        self.assertEqual(len(Stub.seen), 1)


class SchemaTests(CliCase):
    def test_schema_prints_valid_json(self):
        for name in ("options", "itinerary"):
            p = self.run_tab("schema", name, env=False)
            self.assertEqual(p.returncode, 0)
            self.assertIn("$schema", json.loads(p.stdout))

    def test_schema_missing_exits_3(self):
        with tempfile.TemporaryDirectory() as d:
            copy = os.path.join(d, "tab")
            with open(TAB, "rb") as s, open(copy, "wb") as t:
                t.write(s.read())
            p = subprocess.run([sys.executable, "-I", copy, "schema", "options"], cwd=d, capture_output=True, text=True)
            self.assertEqual(p.returncode, 3)


if __name__ == "__main__":
    unittest.main()
