#!/usr/bin/env python3
"""Validate and repair closing ** delimiters according to CommonMark."""

from __future__ import annotations

import argparse
import re
import sys
import unicodedata
from pathlib import Path


FENCE_OPEN_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})")
INLINE_CODE_RE = re.compile(r"(`+)(.*?)\1")


def is_space(character: str | None) -> bool:
    return character is None or character.isspace()


def is_punctuation(character: str | None) -> bool:
    return bool(character) and unicodedata.category(character).startswith("P")


def mask_inline_code(line: str) -> str:
    """Replace inline code spans with spaces so literal ** is ignored."""
    masked = list(line)
    for match in INLINE_CODE_RE.finditer(line):
        for index in range(match.start(), match.end()):
            masked[index] = " "
    return "".join(masked)


def exact_double_star_positions(line: str) -> list[int]:
    """Return positions of exact ** runs outside inline code."""
    masked = mask_inline_code(line)
    positions: list[int] = []
    index = 0
    while index + 1 < len(masked):
        if (
            masked[index : index + 2] == "**"
            and (index == 0 or masked[index - 1] != "*")
            and (index + 2 >= len(masked) or masked[index + 2] != "*")
            and (index == 0 or masked[index - 1] != "\\")
        ):
            positions.append(index)
            index += 2
        else:
            index += 1
    return positions


def is_invalid_closer(line: str, close_index: int) -> bool:
    before = line[close_index - 1] if close_index else None
    after = line[close_index + 2] if close_index + 2 < len(line) else None
    if is_space(before):
        return True
    return is_punctuation(before) and not (is_space(after) or is_punctuation(after))


def repair_line(line: str) -> tuple[str, list[str]]:
    """Fix same-line strong emphasis closers that cannot close."""
    positions = exact_double_star_positions(line)
    if len(positions) % 2:
        # A delimiter may continue onto the next line; leave it for the parser.
        return line, []

    repaired = line
    issues: list[str] = []
    for close_index in positions[1::2]:
        if not is_invalid_closer(repaired, close_index):
            continue

        before = repaired[close_index - 1] if close_index else None
        after = repaired[close_index + 2] if close_index + 2 < len(repaired) else None
        if is_space(before):
            issues.append(
                f"cannot auto-fix closing ** at column {close_index + 1}: "
                "preceded by whitespace"
            )
            continue

        # Adding one space after the closer satisfies the closing-delimiter rule.
        insert_at = close_index + 2
        repaired = repaired[:insert_at] + " " + repaired[insert_at:]
        issues.append(f"inserted space after closing ** at column {close_index + 1}")

    return repaired, issues


def markdown_files(paths: list[Path]) -> list[Path]:
    files: set[Path] = set()
    for path in paths:
        if path.is_dir():
            files.update(path.rglob("*.md"))
        elif path.suffix == ".md" and path.exists():
            files.add(path)
    return sorted(files)


def process_file(path: Path, check_only: bool) -> tuple[int, list[str]]:
    text = path.read_text(encoding="utf-8")
    lines = text.splitlines(keepends=True)
    output: list[str] = []
    in_fence = False
    fence_marker = ""
    fixed: list[str] = []
    unfixable: list[str] = []

    for line_number, line in enumerate(lines, start=1):
        body = line.rstrip("\r\n")
        opening = FENCE_OPEN_RE.match(body)

        if in_fence:
            closing = re.match(
                rf"^ {{0,3}}{re.escape(fence_marker[0])}{{{len(fence_marker)},}}\s*$",
                body,
            )
            if closing:
                in_fence = False
                fence_marker = ""
            output.append(line)
            continue

        if opening:
            in_fence = True
            fence_marker = opening.group(1)
            output.append(line)
            continue

        repaired, issues = repair_line(body)
        if issues:
            suffix = line[len(body) :]
            output.append(repaired + suffix)
            for issue in issues:
                location = f"{path}:{line_number}"
                if check_only:
                    unfixable.append(f"{location}: needs fix: {issue}")
                elif issue.startswith("inserted"):
                    fixed.append(f"{location}: {issue}")
                else:
                    unfixable.append(f"{location}: {issue}")
        else:
            output.append(line)

    changed = "".join(output) != text
    if changed and not check_only:
        path.write_text("".join(output), encoding="utf-8")
    return len(fixed), unfixable


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate and repair closing ** delimiters in Markdown files."
    )
    parser.add_argument(
        "paths",
        nargs="*",
        type=Path,
        help="Markdown files or directories; defaults to docs/",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="report problems without modifying files",
    )
    args = parser.parse_args()

    paths = args.paths or [Path("docs")]
    files = markdown_files(paths)
    fixed_count = 0
    unfixable: list[str] = []

    for path in files:
        file_fixed, file_unfixable = process_file(path, args.check)
        fixed_count += file_fixed
        unfixable.extend(file_unfixable)

    if args.check:
        if unfixable:
            print("\n".join(unfixable), file=sys.stderr)
            print(f"CHECK FAILED: {len(unfixable)} invalid delimiter(s)", file=sys.stderr)
            return 1
        print(f"Checked {len(files)} Markdown files: no invalid closing ** delimiters")
        return 0

    if unfixable:
        print("\n".join(unfixable), file=sys.stderr)
    print(f"Fixed {fixed_count} closing ** delimiter(s) in {len(files)} Markdown files")
    return 1 if unfixable else 0


if __name__ == "__main__":
    raise SystemExit(main())
