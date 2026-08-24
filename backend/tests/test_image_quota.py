import pytest

from backend.auth.session import create_session_token
from backend.db.models import User, ImageUsage


async def _add_image_usage(db_session, user_id, count=1):
    for _ in range(count):
        db_session.add(ImageUsage(user_id=user_id, model="z-image-turbo"))
    await db_session.commit()


async def test_free_user_quota_2_images(client, db_session, non_member_user_id):
    """Free tier = 2 images/month. Quota enforcement rejects the 3rd."""
    await _add_image_usage(db_session, non_member_user_id, 2)

    from backend.proxy.router import _image_quota_for_user, _check_image_quota

    quota, used = await _image_quota_for_user(db_session, non_member_user_id)
    assert quota == 2
    assert used == 2

    with pytest.raises(Exception) as exc:
        await _check_image_quota(db_session, non_member_user_id)
    assert exc.value.status_code == 403
    assert "Monthly image quota reached" in exc.value.detail


async def test_paid_nomad_quota_10(client, db_session, non_member_user_id):
    """Nomad tier = 10 images/month."""
    from sqlalchemy import select

    result = await db_session.execute(select(User).where(User.id == non_member_user_id))
    user = result.scalar_one()
    user.is_paid = True
    user.tier_id = "nomad"
    await db_session.commit()

    from backend.proxy.router import _image_quota_for_user

    quota, used = await _image_quota_for_user(db_session, non_member_user_id)
    assert quota == 10
    assert used == 0


async def test_owner_member_quota_unlimited(client, db_session, owner_user_id):
    """Owner is not limited by the free tier cap."""
    from backend.proxy.router import _image_quota_for_user

    quota, _ = await _image_quota_for_user(db_session, owner_user_id)
    assert quota == 10000


def test_image_generations_enforces_quota(client, db_session, verified_free_user_id):
    """Free user who used their quota gets 403 from /v1/images/generations."""
    import asyncio

    asyncio.run(_add_image_usage(db_session, verified_free_user_id, 2))

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "img"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()

    r = client.post(
        "/v1/images/generations",
        json={"prompt": "a cat", "model": "z-image-turbo"},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 403
    assert "quota" in r.json()["detail"].lower()


def test_chat_image_gen_enforces_quota(client, db_session, verified_free_user_id):
    """Chat image-gen (image_gen flag) for an exhausted free user -> 403."""
    import asyncio

    asyncio.run(_add_image_usage(db_session, verified_free_user_id, 2))

    token = create_session_token(verified_free_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "img"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()

    r = client.post(
        "/v1/chat/completions",
        json={
            "model": "deepseek-v4-flash",
            "image_gen": True,
            "messages": [{"role": "user", "content": "draw a cat"}],
        },
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 403
    assert "quota" in r.json()["detail"].lower()
