"""Seed the channel_members table from the legacy members.json file.

One-time / safe-to-rerun migration that copies the stored member list
(backend/data/members.json or DATA_DIR/members.json) into the
`channel_members` DB table, which is now the source of truth. Re-runs simply
re-seed (the table is replaced with the file's current contents).

Usage:
    python -m backend.scripts.seed_members [--dry-run]
"""

import argparse
import asyncio
import json
from pathlib import Path

from backend.auth.youtube import _members_json_path


async def seed(dry_run: bool = False) -> dict:
    from backend.auth.members import _db_save_level_tiers, _db_save_members
    from backend.db.database import init_db

    # Ensure the channel_members / member_levels tables exist (create_all is idempotent).
    await init_db()

    path = _members_json_path()
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        print(f"Nothing to seed — could not read {path}: {exc}")
        return {"members": 0}

    if not isinstance(payload, dict):
        payload = {"channel_ids": payload if isinstance(payload, list) else []}
    member_ids = set(payload.get("channel_ids") or [])
    tiers = payload.get("tiers") or {}
    if not isinstance(tiers, dict):
        tiers = {}
    levels = payload.get("levels") or {}
    if not isinstance(levels, dict):
        levels = {}

    if not member_ids:
        print(f"members.json at {path} has no channel_ids; nothing to seed.")
        return {"members": 0}

    if dry_run:
        print(f"[dry-run] would seed {len(member_ids)} members from {path}")
        if levels:
            print(f"[dry-run] would seed {len(levels)} level mappings")
        return {"members": len(member_ids)}

    await _db_save_members(member_ids, tiers)
    if levels:
        await _db_save_level_tiers(levels)
    print(f"Seeded {len(member_ids)} members from {path} into channel_members.")
    print(f"  tiers: {tiers}")
    if levels:
        print(f"  levels: {levels}")
    return {"members": len(member_ids)}


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed channel_members from members.json.")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be seeded.")
    args = parser.parse_args()
    asyncio.run(seed(dry_run=args.dry_run))


if __name__ == "__main__":
    main()
