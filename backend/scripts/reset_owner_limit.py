import asyncio
from sqlalchemy import delete, select
from backend.db.database import async_session
from backend.db.models import ApiKey, ImageUsage, UsageLog, User

async def _run(purge_usage: bool = True, clear_tier: bool = False):
    async with async_session() as db:
        owners = (await db.execute(select(User).where(User.is_owner == True))).scalars().all()
        if not owners:
            print("no owner found")
            return
        for owner in owners:
            print(f"owner: {owner.id} {owner.google_email} tier={owner.tier_id} is_paid={owner.is_paid}")
            if clear_tier:
                owner.tier_id = None
                print(" -> cleared tier_id (now unlimited)")
            if purge_usage:
                key_ids = (await db.execute(select(ApiKey.id).where(ApiKey.user_id == owner.id))).scalars().all()
                if key_ids:
                    u = await db.execute(delete(UsageLog).where(UsageLog.api_key_id.in_(key_ids)))
                    print(f" -> deleted {u.rowcount} usage_logs (last 7/30d window reset)")
                    img = await db.execute(delete(ImageUsage).where(ImageUsage.user_id == owner.id))
                    print(f" -> deleted {img.rowcount} image_usage rows")
                else:
                    print(" -> no api keys, nothing to purge")
        await db.commit()
        print("done")

if __name__ == "__main__":
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument("--keep-usage", action="store_true", help="do not delete usage logs, only clear tier")
    p.add_argument("--clear-tier", action="store_true", help="also set tier_id=NULL for unlimited owner")
    args = p.parse_args()
    asyncio.run(_run(purge_usage=not args.keep_usage, clear_tier=args.clear_tier))
