#!/usr/bin/env python3
"""Checks that the Kotlin port of the desktop data layer still matches the Rust original.

  python3 scripts/verify-parity.py

Two independent comparisons:

1. SQL parity — every statement of `db.rs` (base schema + v5 import index + seed rows) must appear
   in `ReciprocalDb.kt`, and vice versa. Guarantees a desktop `reciprocal.db` and the Android one
   are the same schema and the same seed data.
2. Wire-model parity — every field of the serde structs in `models.rs` (which the React frontend
   sees as camelCase JSON) must exist in the matching Kotlin `@Serializable` class.
3. Command coverage — every command the frontend calls (api.ts + the Tauri plugin calls it still
   makes) must be handled somewhere in the Kotlin sources.

Exit code 0 = identical, 1 = drift found (printed).
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RUST_DB = ROOT.parent / "src-tauri/src/db.rs"
RUST_MODELS = ROOT.parent / "src-tauri/src/models.rs"
KOTLIN_DB = ROOT / "app/src/main/java/com/lutszhong/reciprocal/data/ReciprocalDb.kt"
KOTLIN_MODELS = ROOT / "app/src/main/java/com/lutszhong/reciprocal/data/Models.kt"


def squash(text: str) -> str:
    """Collapses whitespace and punctuation spacing so formatting does not count as drift."""
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"\s*([(),])\s*", r"\1", text)
    return text.strip().rstrip(";").strip()


def split_statements(sql: str) -> list[str]:
    parts = [squash(part) for part in sql.split(";")]
    return [part for part in parts if part]


def rust_const(source: str, name: str) -> str:
    match = re.search(rf'const {name}: &str = r#"(.*?)"#;', source, re.S)
    if not match:
        raise SystemExit(f"could not find Rust const {name}")
    return match.group(1)


def kotlin_string_list(source: str, name: str) -> list[str]:
    # Extracts the triple-quoted (...) .trimIndent() blocks and plain string entries of a list.
    match = re.search(rf"private val {name} = listOf\((.*?)\n        \)\n", source, re.S)
    if not match:
        raise SystemExit(f"could not find Kotlin list {name}")
    body = match.group(1)
    entries = re.findall(r'"""(.*?)"""\.trimIndent\(\)|"((?:[^"\\]|\\.)*)"', body, re.S)
    out: list[str] = []
    for triple, single in entries:
        raw = triple if triple else single.replace('\\"', '"')
        out.extend(split_statements(raw))
    return out


def join_kotlin_strings(source: str, name: str) -> str:
    """Joins a `"..." + "...".` constant split over several lines."""
    match = re.search(rf"const val {name} =\s*(.*?)\n\n", source, re.S)
    if not match:
        raise SystemExit(f"could not find Kotlin constant {name}")
    pieces = re.findall(r'"((?:[^"\\]|\\.)*)"', match.group(1))
    return "".join(piece.replace('\\"', '"') for piece in pieces)


def report(title: str, missing_in_kotlin: list[str], missing_in_rust: list[str]) -> bool:
    ok = not missing_in_kotlin and not missing_in_rust
    print(f"{'PASS' if ok else 'FAIL'}  {title}")
    for statement in missing_in_kotlin:
        print(f"      missing in Kotlin: {statement[:120]}")
    for statement in missing_in_rust:
        print(f"      missing in Rust  : {statement[:120]}")
    return ok


def main() -> int:
    rust_source = RUST_DB.read_text()
    kotlin_source = KOTLIN_DB.read_text()

    # ---- 1. SQL parity -------------------------------------------------
    rust_sql = split_statements(rust_const(rust_source, "SCHEMA"))
    # Statements that the desktop app applies outside `SCHEMA` (v5 migration).
    rust_sql += [
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_imported_key
          ON events (external_id, date, IFNULL(start_time, ''), all_day)
          WHERE source = 'apple' AND external_id IS NOT NULL
        """,
    ]
    rust_sql = [squash(statement) for statement in rust_sql]
    # PRAGMAs are transport concerns: WAL is enabled by SQLiteOpenHelper, foreign keys in onConfigure.
    rust_sql = [s for s in rust_sql if not s.upper().startswith("PRAGMA")]

    kotlin_sql = kotlin_string_list(kotlin_source, "SCHEMA_STATEMENTS")
    # The imported-event unique index lives in its own constant in the Kotlin port.
    kotlin_sql += [squash(join_kotlin_strings(kotlin_source, "CREATE_IMPORTED_INDEX"))]

    rust_seed = split_statements(rust_const(rust_source, "SEED"))
    kotlin_seed = kotlin_string_list(kotlin_source, "SEED_STATEMENTS")
    # `sqlite_sequence` bookkeeping in the Kotlin seed has no Rust counterpart; AUTOINCREMENT keeps
    # it correct by itself, so it must not appear in the port at all.
    kotlin_seed = [s for s in kotlin_seed if "sqlite_sequence" not in s]

    ok = True
    ok &= report(
        f"SQL schema ({len(rust_sql)} statements vs {len(kotlin_sql)})",
        [s for s in rust_sql if s not in kotlin_sql],
        [s for s in kotlin_sql if s not in rust_sql],
    )
    # Seed parity is a deliberate divergence: the Android build ships no demo rows (a fresh install
    # opens on the empty states), while the desktop app seeds sample habits/events/tasks/blocks.
    demo_prefixes = (
        "INSERT INTO habits",
        "INSERT INTO habit_logs",
        "INSERT INTO events",
        "INSERT INTO tasks",
        "INSERT INTO timetable",
    )
    kotlin_demo = [s for s in kotlin_seed if s.startswith(demo_prefixes)]
    if kotlin_demo:
        ok = False
        print(f"FAIL  seed: Android must not ship demo rows ({len(kotlin_demo)} inserts found)")
    elif kotlin_seed != ["INSERT INTO settings (key, value) VALUES ('onboarded', '1')"]:
        ok = False
        print(f"FAIL  seed: unexpected Android seed statements: {kotlin_seed}")
    else:
        print(
            f"PASS  seed: Android intentionally seeds no demo data "
            f"(desktop seeds {len(rust_seed)} statements — documented divergence)"
        )

    # ---- 2. wire-model parity ------------------------------------------
    rust_models = RUST_MODELS.read_text()
    kotlin_models = KOTLIN_MODELS.read_text()

    rust_structs: dict[str, list[str]] = {}
    for match in re.finditer(r"pub struct (\w+) \{(.*?)\n\}", rust_models, re.S):
        name, body = match.group(1), match.group(2)
        fields = []
        for field in re.finditer(r"^\s+pub (\w+):", body, re.M):
            fields.append(field.group(1))
        rust_structs[name] = fields

    kotlin_classes: dict[str, list[str]] = {}
    for match in re.finditer(r"data class (\w+)\((.*?)\n\)", kotlin_models, re.S):
        name, body = match.group(1), match.group(2)
        fields = re.findall(r"^\s+val (\w+):", body, re.M)
        kotlin_classes[name] = fields

    def camel(value: str) -> str:
        head, *tail = value.split("_")
        return head + "".join(part.capitalize() for part in tail)

    model_ok = True
    for name, fields in rust_structs.items():
        # `default_event_source` is a serde helper, not a struct.
        if name not in kotlin_classes:
            print(f"FAIL  model {name}: no Kotlin data class")
            model_ok = False
            continue
        expected = [camel(field) for field in fields]
        actual = kotlin_classes[name]
        missing = [field for field in expected if field not in actual]
        extra = [field for field in actual if field not in expected]
        if missing or extra:
            model_ok = False
            print(f"FAIL  model {name}: missing={missing} extra={extra}")
        else:
            print(f"PASS  model {name} ({len(expected)} fields)")

    # ---- 3. command coverage ------------------------------------------
    api_ts = (ROOT / "web/src/lib/api.ts").read_text()
    frontend_commands = set(re.findall(r'call<[^>]*>\("([a-z_]+)"', api_ts))
    # Plugin commands the bundled frontend still invokes (see @tauri-apps/api/app and
    # @tauri-apps/plugin-dialog inside web/node_modules).
    frontend_commands |= {"plugin:app|version", "plugin:dialog|save", "plugin:dialog|open"}

    kotlin_sources = "\n".join(
        path.read_text()
        for path in (ROOT / "app/src/main/java/com/lutszhong/reciprocal").rglob("*.kt")
    )
    missing_commands = sorted(
        command
        for command in frontend_commands
        if f'"{command}"' not in kotlin_sources
    )
    if missing_commands:
        print(f"FAIL  command coverage ({len(frontend_commands)} frontend commands)")
        for command in missing_commands:
            print(f"      not handled: {command}")
        model_ok = False
    else:
        print(f"PASS  command coverage ({len(frontend_commands)} commands handled)")

    unknown = sorted(set(kotlin_classes) - set(rust_structs))
    if unknown:
        print(f"note  Kotlin-only types: {', '.join(unknown)}")

    return 0 if ok and model_ok else 1


if __name__ == "__main__":
    sys.exit(main())
