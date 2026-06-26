#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent / "integration-aoe"
sys.path.insert(0, str(ROOT))

from sync_itest_aoe.pi_session.annotation import annotate_session_file  # noqa: E402


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Annotate a Pi session JSONL transcript.")
    parser.add_argument("path", type=Path, help="Path to a Pi session .jsonl file.")
    parser.add_argument("--jsonl", action="store_true", help="Print one annotation JSON object per line.")
    parser.add_argument("--summary-only", action="store_true", help="Print only aggregate annotation counts.")
    parser.add_argument("--include-text", action="store_true", help="Include full text bodies in annotation output.")
    parser.add_argument("--limit", type=int, help="Limit the number of printed annotations.")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    report = annotate_session_file(args.path, include_text=args.include_text)

    if args.summary_only:
        print(json.dumps(report.summary(), indent=2, sort_keys=True))
        return 0 if not report.diagnostics else 1

    annotations = report.annotations[: args.limit] if args.limit is not None else report.annotations
    if args.jsonl:
        for annotation in annotations:
            print(json.dumps(annotation.to_json(), sort_keys=True))
        for diagnostic in report.diagnostics:
            print(
                json.dumps(
                    {
                        "category": "diagnostic",
                        "kind": "parse_diagnostic",
                        "path": str(diagnostic.path),
                        "line_number": diagnostic.line_number,
                        "message": diagnostic.message,
                        "raw": diagnostic.raw,
                    },
                    sort_keys=True,
                )
            )
    else:
        payload = report.to_json()
        payload["annotations"] = [annotation.to_json() for annotation in annotations]
        if args.limit is not None:
            payload["truncated"] = len(report.annotations) > args.limit
        print(json.dumps(payload, indent=2, sort_keys=True))

    return 0 if not report.diagnostics else 1


if __name__ == "__main__":
    raise SystemExit(main())
