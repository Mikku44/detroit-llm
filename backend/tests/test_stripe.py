import hashlib
import hmac
import json

import pytest

from backend.auth.session import create_session_token


@pytest.fixture
def patch_stripe_key(monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "stripe_api_key", "rk_test_fake")
    return settings


def test_checkout_requires_auth(client):
    r = client.post("/stripe/checkout", json={"tier_id": "nomad"})
    assert r.status_code == 401


def test_checkout_unconfigured_returns_503(client, session_token, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "stripe_api_key", "")
    r = client.post(
        "/stripe/checkout",
        json={"tier_id": "nomad"},
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert r.status_code == 503


def test_checkout_unknown_tier_rejected(client, session_token, patch_stripe_key):
    r = client.post(
        "/stripe/checkout",
        json={"tier_id": "nope"},
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert r.status_code == 400


def test_checkout_free_tier_rejected(client, session_token, patch_stripe_key):
    r = client.post(
        "/stripe/checkout",
        json={"tier_id": "free"},
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert r.status_code == 400


def test_checkout_creates_subscription_session(client, session_token, patch_stripe_key, monkeypatch):
    from backend.stripe import router as stripe_router

    captured = {}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, path, data=None):
            captured["data"] = data
            return FakeResponse(200, {"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1"})

    class FakeResponse:
        def __init__(self, status_code, json):
            self.status_code = status_code
            self._json = json

        def json(self):
            return self._json

    async def fake_client():
        return FakeClient()

    monkeypatch.setattr(stripe_router, "_stripe_client", fake_client)

    r = client.post(
        "/stripe/checkout",
        json={"tier_id": "nomad"},
        headers={"Authorization": f"Bearer {session_token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["session_id"] == "cs_test_1"
    assert body["url"].startswith("https://checkout.stripe.com")
    assert body["tier_id"] == "nomad"
    # Subscription mode + monthly recurring price.
    assert captured["data"]["mode"] == "subscription"
    assert captured["data"]["line_items[0][price_data][recurring][interval]"] == "month"
    assert captured["data"]["client_reference_id"]
    assert int(captured["data"]["line_items[0][price_data][unit_amount]"]) == 5000


def test_checkout_status_ownership(client, session_token, patch_stripe_key, monkeypatch):
    from backend.stripe import router as stripe_router

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, path):
            return FakeResponse(
                200,
                {
                    "id": "cs_test_1",
                    "status": "complete",
                    "payment_status": "paid",
                    "amount_total": 5000,
                    "currency": "thb",
                    "metadata": {"tier_id": "nomad"},
                    "client_reference_id": "someone-else",
                    "customer_email": None,
                },
            )

    class FakeResponse:
        def __init__(self, status_code, json):
            self.status_code = status_code
            self._json = json

        def json(self):
            return self._json

    async def fake_client():
        return FakeClient()

    monkeypatch.setattr(stripe_router, "_stripe_client", fake_client)

    # Different client_reference_id than the caller -> 403.
    r = client.get("/stripe/checkout/cs_test_1", headers={"Authorization": f"Bearer {session_token}"})
    assert r.status_code == 403


def _sign_payload(secret: str, payload: bytes, timestamp: str = "1700000000") -> str:
    signed = f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), signed, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={sig}"


def _checkout_completed_event(
    user_id: str, customer: str = "cus_test", subscription: str = "sub_test"
) -> dict:
    return {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_live_x",
                "mode": "subscription",
                "payment_status": "paid",
                "client_reference_id": user_id,
                "customer": customer,
                "subscription": subscription,
                "amount_total": 5000,
                "currency": "thb",
                "metadata": {"tier_id": "nomad"},
            }
        },
    }


def test_webhook_requires_secret(client, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", "")
    r = client.post("/stripe/webhook", json={})
    assert r.status_code == 503


def test_webhook_bad_signature(client, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    payload = json.dumps({"type": "checkout.session.completed"}).encode()
    r = client.post(
        "/stripe/webhook",
        content=payload,
        headers={"stripe-signature": "t=1,v1=bogus"},
    )
    assert r.status_code == 400
    assert "Invalid signature" in r.json()["detail"]


def test_webhook_checkout_completed_grants_access(
    client, session_token, non_member_user_id, monkeypatch
):
    from backend.config import settings
    from backend.db.database import async_session
    from backend.db.models import User
    from sqlalchemy import select

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")
    monkeypatch.setattr(settings, "stripe_api_key", "rk_test_fake")

    event = _checkout_completed_event(
        non_member_user_id, customer="cus_grant", subscription="sub_grant"
    )
    payload = json.dumps(event).encode()
    sig = _sign_payload("whsec_test", payload)

    r = client.post(
        "/stripe/webhook",
        content=payload,
        headers={"stripe-signature": sig},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["is_paid"] is True
    assert body["user_id"] == non_member_user_id

    # The user now has full access in the DB.
    import asyncio

    from backend.db.models import Payment

    async def check():
        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == non_member_user_id))
            user = result.scalar_one()
            return user.is_paid, user.stripe_customer_id, user.stripe_subscription_id

    is_paid, customer, subscription = asyncio.run(check())
    assert is_paid is True
    assert customer == "cus_grant"
    assert subscription == "sub_grant"

    # A payment history row was recorded.
    async def check_payment():
        async with async_session() as db:
            result = await db.execute(
                select(Payment).where(Payment.user_id == non_member_user_id)
            )
            return result.scalars().all()

    payments = asyncio.run(check_payment())
    assert len(payments) == 1
    p = payments[0]
    assert p.status == "paid"
    assert p.amount == 5000
    assert p.currency == "thb"
    assert p.tier_id == "nomad"
    assert p.stripe_customer_id == "cus_grant"
    assert p.checkout_session_id == "cs_live_x"


def test_webhook_subscription_deleted_revokes(client, session_token, non_member_user_id, monkeypatch):
    from backend.config import settings
    from backend.db.database import async_session
    from backend.db.models import User
    from sqlalchemy import select

    monkeypatch.setattr(settings, "stripe_webhook_secret", "whsec_test")

    # First grant access.
    event = _checkout_completed_event(
        non_member_user_id, customer="cus_revoke", subscription="sub_revoke"
    )
    payload = json.dumps(event).encode()
    client.post(
        "/stripe/webhook",
        content=payload,
        headers={"stripe-signature": _sign_payload("whsec_test", payload)},
    )

    # Then cancel the subscription.
    cancel = {
        "type": "customer.subscription.deleted",
        "data": {"object": {"id": "sub_revoke", "customer": "cus_revoke", "status": "canceled"}},
    }
    payload = json.dumps(cancel).encode()
    r = client.post(
        "/stripe/webhook",
        content=payload,
        headers={"stripe-signature": _sign_payload("whsec_test", payload)},
    )
    assert r.status_code == 200

    import asyncio

    async def check():
        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == non_member_user_id))
            user = result.scalar_one()
            return user.is_paid

    assert asyncio.run(check()) is False


def test_paid_user_passes_access_gate(client, non_member_user_id, monkeypatch):
    """A user with is_paid=True is treated like a member by the API gate."""
    from backend.auth.session import create_session_token
    from backend.db.database import async_session
    from backend.db.models import User
    from sqlalchemy import select

    import asyncio

    async def mark_paid():
        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == non_member_user_id))
            user = result.scalar_one()
            user.is_paid = True
            await db.commit()

    asyncio.run(mark_paid())

    token = create_session_token(non_member_user_id)
    created = client.post(
        "/admin/keys",
        json={"name": "paid"},
        headers={"Authorization": f"Bearer {token}"},
    ).json()
    r = client.post(
        "/v1/chat/completions",
        json={"model": "deepseek-v4-pro", "messages": [{"role": "user", "content": "hi"}]},
        headers={"Authorization": f"Bearer {created['key']}"},
    )
    assert r.status_code == 200, r.text


def test_get_subscription_no_subscription(client, non_member_user_id, patch_stripe_key):
    token = create_session_token(non_member_user_id)
    r = client.get("/stripe/subscription", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["active"] is False
    assert body["subscription_id"] is None


def test_cancel_subscription_requires_existing(client, non_member_user_id, patch_stripe_key):
    token = create_session_token(non_member_user_id)
    r = client.post(
        "/stripe/subscription/cancel",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 400
    assert "No subscription" in r.json()["detail"]


def test_cancel_subscription_calls_stripe(
    client, non_member_user_id, session_token, patch_stripe_key, monkeypatch
):
    """A user with a stored subscription id is canceled via the Stripe API."""
    import asyncio

    from backend.db.database import async_session
    from backend.db.models import User
    from sqlalchemy import select

    async def seed():
        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == non_member_user_id))
            user = result.scalar_one()
            user.is_paid = True
            user.stripe_subscription_id = "sub_cancel_me"
            user.stripe_customer_id = "cus_cancel_me"
            await db.commit()

    asyncio.run(seed())

    from backend.stripe import router as stripe_router

    captured = {}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def delete(self, path):
            captured["path"] = path
            return FakeResponse(
                200,
                {
                    "id": "sub_cancel_me",
                    "status": "canceled",
                    "cancel_at_period_end": False,
                    "current_period_end": 1700000000,
                },
            )

    class FakeResponse:
        def __init__(self, status_code, json):
            self.status_code = status_code
            self._json = json

        def json(self):
            return self._json

    async def fake_client():
        return FakeClient()

    monkeypatch.setattr(stripe_router, "_stripe_client", fake_client)

    token = create_session_token(non_member_user_id)
    r = client.post(
        "/stripe/subscription/cancel",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "canceled"
    assert body["at_period_end"] is True
    assert captured["path"] == "/subscriptions/sub_cancel_me"

    async def check_paid():
        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == non_member_user_id))
            return result.scalar_one().is_paid

    assert asyncio.run(check_paid()) is False


def test_get_subscription_active(client, non_member_user_id, patch_stripe_key, monkeypatch):
    import asyncio

    from backend.db.database import async_session
    from backend.db.models import User
    from sqlalchemy import select

    async def seed():
        async with async_session() as db:
            result = await db.execute(select(User).where(User.id == non_member_user_id))
            user = result.scalar_one()
            user.is_paid = True
            user.stripe_subscription_id = "sub_active_1"
            await db.commit()

    asyncio.run(seed())

    from backend.stripe import router as stripe_router

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, path):
            return FakeResponse(
                200,
                {
                    "id": "sub_active_1",
                    "status": "active",
                    "current_period_end": 1700000000,
                    "items": {
                        "data": [
                            {
                                "price": {
                                    "metadata": {"tier_id": "nomad"},
                                }
                            }
                        ]
                    },
                },
            )

    class FakeResponse:
        def __init__(self, status_code, json):
            self.status_code = status_code
            self._json = json

        def json(self):
            return self._json

    async def fake_client():
        return FakeClient()

    monkeypatch.setattr(stripe_router, "_stripe_client", fake_client)

    token = create_session_token(non_member_user_id)
    r = client.get("/stripe/subscription", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200
    body = r.json()
    assert body["active"] is True
    assert body["status"] == "active"
    assert body["tier_id"] == "nomad"
    assert body["current_period_end"] == 1700000000
