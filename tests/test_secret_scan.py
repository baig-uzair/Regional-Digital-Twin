"""No secrets in tracked files, the frontend bundle, or Grafana dashboards (Spec A-17 / rule 4)."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LEAKED = "DalarnaTwin2026" + "!"  # the previously committed password; split so this file does not contain it
TEXT_EXT = {".py", ".js", ".html", ".css", ".json", ".md", ".yml", ".yaml", ".sql", ".txt", ".example", ".env", ".ini", ".toml", ""}
ASSIGN = re.compile(r"""(api[_-]?key|client[_-]?secret|secret|password|token)\s*[:=]\s*['"][A-Za-z0-9+/_\-!@#$%^&*]{8,}['"]""", re.I)


def tracked_files():
    try:
        out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout.splitlines()
        return [ROOT / p for p in out if (ROOT / p).is_file()]
    except Exception:  # not a git checkout
        return [p for p in ROOT.rglob("*") if p.is_file() and ".git" not in p.parts and "node_modules" not in p.parts and ".env" != p.name]


def read(path):
    if path.suffix.lower() not in TEXT_EXT or path.stat().st_size > 2_000_000:
        return ""
    try:
        return path.read_text(encoding="utf-8", errors="ignore")
    except OSError:
        return ""


def test_env_file_is_not_tracked():
    names = {p.name for p in tracked_files()}
    assert ".env" not in names


def test_previously_leaked_password_is_gone_from_the_working_tree():
    offenders = [str(p.relative_to(ROOT)) for p in tracked_files() if LEAKED in read(p)]
    assert offenders == []


def test_no_hard_coded_credentials_in_application_code():
    offenders = []
    for p in tracked_files():
        rel = p.relative_to(ROOT).as_posix()
        if rel.startswith(("tests/", "docs/")) or p.suffix not in {".py", ".js", ".html", ".json", ".yml"}:
            continue
        for m in ASSIGN.finditer(read(p)):
            value = m.group(0)
            if re.search(r"(os\.environ|getenv|_env\(|process\.env|your_key|changeme|votre_cle|password\s*[:=]\s*['\"]\s*['\"])", value, re.I):
                continue
            offenders.append(f"{rel}: {value[:60]}")
    assert offenders == [], offenders


def test_frontend_and_grafana_contain_no_secrets():
    files = list((ROOT / "static").rglob("*")) + list((ROOT / "grafana").rglob("*.json")) + [ROOT / "index.html"]
    for p in files:
        if not p.is_file():
            continue
        text = read(p)
        assert not ASSIGN.search(text), f"possible secret in {p.relative_to(ROOT)}"
        assert LEAKED not in text


def test_real_secret_values_from_env_never_appear_in_tracked_files():
    env = ROOT / ".env"
    if not env.exists():
        return
    values = []
    for line in env.read_text(encoding="utf-8", errors="ignore").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            if re.search(r"(KEY|SECRET|PASSWORD|TOKEN)", k) and len(v.strip()) >= 8:
                values.append(v.strip())
    for p in tracked_files():
        text = read(p)
        for v in values:
            assert v not in text, f"a real secret value from .env appears in {p.relative_to(ROOT)}"
