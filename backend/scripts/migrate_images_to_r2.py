import argparse
import asyncio
import base64
import json
import re
from sqlalchemy import select
from backend.db.database import get_conversation_db, async_session
from backend.db.models import ConversationMessage
from backend.chat.crypto import chat_date_of, decrypt_text, derive_key, encrypt_text
from backend.storage.r2 import upload_bytes, is_configured

DATA_URI_RE = re.compile(r"data:(image/[^;]+);base64,([A-Za-z0-9+/=]+)")

async def _migrate(dry_run: bool, limit: int):
    if not is_configured() and not dry_run:
        print("R2 not configured (R2_ENDPOINT/R2_ACCESS_KEY_ID etc missing) — use --dry-run to preview")
        return
    async for db in get_conversation_db():
        q = select(ConversationMessage).where(ConversationMessage.content.like("%data:image%"))
        rows = (await db.execute(q)).scalars().all()
        q2 = select(ConversationMessage).where(ConversationMessage.attachments.like("%data:image%"))
        rows += (await db.execute(q2)).scalars().all()
        seen = set()
        uniq = []
        for r in rows:
            if r.id not in seen:
                seen.add(r.id)
                uniq.append(r)
        print(f"found {len(uniq)} messages with data: URIs")
        migrated = 0
        for m in uniq[: limit or len(uniq)]:
            orig_content = m.content or ""
            content = orig_content
            if m.encrypted:
                try:
                    from sqlalchemy.orm import selectinload
                    from backend.db.models import Conversation
                    conv = (await db.execute(select(Conversation).where(Conversation.id == m.conversation_id))).scalar_one_or_none()
                    if conv:
                        key = derive_key(conv.user_id, conv.id, chat_date_of(conv.created_at))
                        content = decrypt_text(key, content)
                except Exception:
                    pass

            def repl_mo(mo):
                mime = mo.group(1)
                b64 = mo.group(2)
                try:
                    raw = base64.b64decode(b64)
                    if dry_run:
                        return f"data:{mime};base64,...migrated..."
                    url = upload_bytes(raw, mime, prefix="images/migrated")
                    return url or mo.group(0)
                except Exception as e:
                    print(f"  skip: {e}")
                    return mo.group(0)

            new_content = DATA_URI_RE.sub(repl_mo, content)
            new_attachments = m.attachments
            if m.attachments and "data:image" in m.attachments:
                try:
                    atts = json.loads(m.attachments)
                    changed = False
                    for a in atts if isinstance(atts, list) else []:
                        du = a.get("dataUrl") or a.get("url") or ""
                        if isinstance(du, str) and du.startswith("data:image"):
                            header, b64 = du.split(",", 1)
                            mime = header.split(";")[0].split(":")[1] if ":" in header else "image/jpeg"
                            raw = base64.b64decode(b64)
                            if dry_run:
                                a["url"] = f"r2://migrated/...{mime}"
                                a.pop("dataUrl", None)
                            else:
                                url = upload_bytes(raw, mime, prefix="images/migrated")
                                if url:
                                    a["url"] = url
                                    a.pop("dataUrl", None)
                            changed = True
                    if changed:
                        new_attachments = json.dumps(atts)
                except Exception:
                    pass

            if new_content != content or new_attachments != m.attachments:
                migrated += 1
                if not dry_run:
                    if m.encrypted and conv:
                        m.content = encrypt_text(key, new_content)
                    else:
                        m.content = new_content
                    m.attachments = new_attachments
                print(f"  {m.id}: migrated")
        if not dry_run and migrated:
            await db.commit()
        print(f"done: {migrated} messages {'would be ' if dry_run else ''}migrated")
        break

def main():
    p = argparse.ArgumentParser(description="Migrate inline data:image URIs in conversations to R2")
    p.add_argument("--dry-run", action="store_true")
    p.add_argument("--limit", type=int, default=0, help="max messages to process (0=all)")
    args = p.parse_args()
    asyncio.run(_migrate(args.dry_run, args.limit))

if __name__ == "__main__":
    main()
