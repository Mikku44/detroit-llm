"""Daily usage-log housekeeping (runs as a cronjob at 00:00 UTC).

Deletes usage/image rows older than the retention window so the per-tier
sliding weekly/monthly token windows keep resetting off compact data — even if
no user makes a request. Enforcement itself is unchanged: `_tier_usage` still
computes live 7/30-day sums from the remaining rows.

The retention default (35 days) is a few days past the 30-day monthly window,
so pruning never removes data a live enforcement query could still need.

Usage:
    python -m backend.scripts.cleanup_usage [--retention-days 35]

Cron entry (see deploy/README.md):
    0 0 * * * cd /opt/detroit-llm/deploy && docker compose exec -T backend \
        python -m backend.scripts.cleanup_usage >> /var/log/detroit-cleanup.log 2>&1
"""

import argparse
import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, func, select

from backend.db.database import async_session
from backend.db.models import ImageUsage, UsageLog

DEFAULT_RETENTION_DAYS = 35


async def purge_older_than(db, cutoff: datetime, dry_run: bool = False) -> dict:
    """Delete usage/image rows created before `cutoff`. Returns deleted counts."""
    usage = int(
        (await db.execute(select(func.count(UsageLog.id)).where(UsageLog.created_at < cutoff))).scalar_one() or 0
    )
    images = int(
        (await db.execute(select(func.count(ImageUsage.id)).where(ImageUsage.created_at < cutoff))).scalar_one() or 0
    )

    if not dry_run:
        if usage:
            await db.execute(delete(UsageLog).where(UsageLog.created_at < cutoff))
        if images:
            await db.execute(delete(ImageUsage).where(ImageUsage.created_at < cutoff))
        await db.commit()
    return {"usage_logs": usage, "image_usage": images}


async def _run(retention_days: int, dry_run: bool) -> dict:
    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=retention_days)
    async with async_session() as db:
        return await purge_older_than(db, cutoff, dry_run=dry_run)


def main() -> None:
    parser = argparse.ArgumentParser(description="Prune old usage logs (daily cron).")
    parser.add_argument("--retention-days", type=int, default=DEFAULT_RETENTION_DAYS)
    parser.add_argument("--dry-run", action="store_true", help="Report what would be deleted without deleting.")
    args = parser.parse_args()
    result = asyncio.run(_run(args.retention_days, args.dry_run))
    action = "would delete" if args.dry_run else "deleted"
    print(
        f"cleanup done: {action} {result['usage_logs']} usage_logs, "
        f"{result['image_usage']} image_usage rows (older than {args.retention_days} days)"
    )


if __name__ == "__main__":
    main()
