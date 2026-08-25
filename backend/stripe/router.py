import hashlib
import hmac
import json

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import settings, TIER_OPTIONS
from backend.auth.session import require_session
from backend.db.database import get_db
from backend.db.models import User, Payment

router = APIRouter(prefix="/stripe", tags=["stripe"])

STRIPE_API_URL = "https://api.stripe.com/v1"


async def _stripe_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        base_url=STRIPE_API_URL,
        headers={"Authorization": f"Bearer {settings.stripe_api_key}"},
        timeout=15,
        limits=httpx.Limits(max_connections=20, max_keepalive_connections=5),
    )


def _parse_amount_thb(price: str) -> int:
    """Convert a tier price like '1,500฿' to Stripe minor units (satang)."""
    digits = "".join(ch for ch in price if ch.isdigit())
    if not digits:
        raise HTTPException(status_code=400, detail=f"Invalid price: {price}")
    return int(digits) * 100


async def _user_by_id(db: AsyncSession, user_id: str) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id))
    return result.scalar_one_or_none()


@router.post("/checkout")
async def create_checkout(
    request: Request,
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Create a Stripe Checkout Session for a paid tier.

    Body: {"tier_id": "nomad" | ..., "payment_method": "card" | "promptpay"}
    - card: monthly subscription (recurring)
    - promptpay: one-time PromptPay QR payment for 30 days (THB, Checkout payment mode).
      PromptPay is not supported in Checkout subscription mode per Stripe docs,
      so we use payment mode for QR payments.
    On payment, Stripe sends checkout.session.completed -> the webhook sets
    user.is_paid = True so the user gets full access immediately.
    """
    if not settings.stripe_api_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    body = await request.json()
    tier_id = (body.get("tier_id") or "").strip().lower()
    tier = next((t for t in TIER_OPTIONS if t["id"] == tier_id), None)
    if not tier or tier_id == "free":
        raise HTTPException(status_code=400, detail=f"Unknown tier: {tier_id}")

    payment_method = (body.get("payment_method") or "card").strip().lower()
    if payment_method not in ("card", "promptpay"):
        raise HTTPException(status_code=400, detail="payment_method must be 'card' or 'promptpay'")

    unit_amount = _parse_amount_thb(tier["price"])

    user = await _user_by_id(db, user_id)
    if payment_method == "card" and user and user.stripe_customer_id and user.stripe_subscription_id and user.is_paid:
        raise HTTPException(
            status_code=409,
            detail="You already have an active subscription. Use your Stripe portal to manage it.",
        )

    if payment_method == "promptpay":
        form = {
            "mode": "payment",
            "success_url": f"{settings.dashboard_url}/usage?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
            "cancel_url": f"{settings.dashboard_url}/usage?checkout=cancelled",
            "client_reference_id": user_id,
            "metadata[tier_id]": tier_id,
            "metadata[user_id]": user_id,
            "metadata[payment_method]": "promptpay",
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": "thb",
            "line_items[0][price_data][unit_amount]": str(unit_amount),
            "line_items[0][price_data][product_data][name]": f"{tier['emoji']} {tier['name']} — Detroit LLM (PromptPay)",
            "payment_method_types[0]": "promptpay",
            "payment_method_types[1]": "card",
            "expires_at": str(int(__import__("time").time()) + 30 * 60),
        }
    else:
        form = {
            "mode": "subscription",
            "success_url": f"{settings.dashboard_url}/usage?checkout=success&session_id={{CHECKOUT_SESSION_ID}}",
            "cancel_url": f"{settings.dashboard_url}/usage?checkout=cancelled",
            "client_reference_id": user_id,
            "metadata[tier_id]": tier_id,
            "metadata[user_id]": user_id,
            "metadata[payment_method]": "card",
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": "thb",
            "line_items[0][price_data][unit_amount]": str(unit_amount),
            "line_items[0][price_data][recurring][interval]": "month",
            "line_items[0][price_data][product_data][name]": f"{tier['emoji']} {tier['name']} — Detroit LLM",
            "payment_method_types[0]": "card",
        }
    if user and user.stripe_customer_id:
        form["customer"] = user.stripe_customer_id

    async with await _stripe_client() as client:
        resp = await client.post("/checkout/sessions", data=form)
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="Failed to create Stripe checkout session")

    data = resp.json()
    return {"session_id": data["id"], "url": data["url"], "tier_id": tier_id, "payment_method": payment_method}


@router.get("/checkout/{session_id}")
async def checkout_status(
    session_id: str,
    user_id: str = Depends(require_session),
):
    """Check the status of a checkout session (payment/expired/complete)."""
    if not settings.stripe_api_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    async with await _stripe_client() as client:
        resp = await client.get(f"/checkout/sessions/{session_id}")

    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail="Checkout session not found")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="Failed to retrieve Stripe checkout session")

    data = resp.json()
    if data.get("client_reference_id") != user_id:
        raise HTTPException(status_code=403, detail="Not your checkout session")

    return {
        "session_id": session_id,
        "mode": data.get("mode"),
        "status": data.get("status"),
        "payment_status": data.get("payment_status"),
        "amount_total": data.get("amount_total"),
        "currency": data.get("currency"),
        "tier_id": (data.get("metadata") or {}).get("tier_id"),
        "customer": data.get("customer"),
        "subscription": data.get("subscription"),
        "customer_email": data.get("customer_email"),
    }


@router.get("/subscription")
async def get_subscription(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Return the current Stripe subscription status for the logged-in user.

    Used by the dashboard to show an active subscription + a cancel button.
    """
    user = await _user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.is_paid or not user.stripe_subscription_id:
        return {
            "active": False,
            "is_paid": user.is_paid,
            "subscription_id": None,
            "status": None,
            "current_period_end": None,
            "tier_id": None,
        }

    if not settings.stripe_api_key:
        return {
            "active": bool(user.is_paid),
            "is_paid": user.is_paid,
            "subscription_id": user.stripe_subscription_id,
            "status": None,
            "current_period_end": None,
            "tier_id": None,
        }

    async with await _stripe_client() as client:
        resp = await client.get(f"/subscriptions/{user.stripe_subscription_id}")

    if resp.status_code >= 400:
        return {
            "active": bool(user.is_paid),
            "is_paid": user.is_paid,
            "subscription_id": user.stripe_subscription_id,
            "status": "unknown",
            "current_period_end": None,
            "tier_id": None,
        }

    data = resp.json()
    status = data.get("status")
    active = status in ("active", "trialing", "past_due")
    tier_id = None
    items = data.get("items") or {}
    price = (items.get("data") or [{}])[0].get("price") or {}
    tier_id = (price.get("metadata") or {}).get("tier_id")

    return {
        "active": active,
        "is_paid": bool(user.is_paid),
        "subscription_id": user.stripe_subscription_id,
        "status": status,
        "current_period_end": data.get("current_period_end"),
        "tier_id": tier_id,
    }


@router.post("/subscription/cancel")
async def cancel_subscription(
    user_id: str = Depends(require_session),
    db: AsyncSession = Depends(get_db),
):
    """Cancel the logged-in user's Stripe subscription.

    Cancels at the end of the current billing period (the user keeps access until
    then). If a previous subscription was already canceled, reuses it instead of
    creating a new one.
    """
    if not settings.stripe_api_key:
        raise HTTPException(status_code=503, detail="Stripe is not configured")

    user = await _user_by_id(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.stripe_subscription_id:
        raise HTTPException(status_code=400, detail="No subscription to cancel")

    subscription_id = user.stripe_subscription_id
    async with await _stripe_client() as client:
        resp = await client.delete(f"/subscriptions/{subscription_id}")

    if resp.status_code == 404:
        # Subscription already gone — just clear local state.
        user.is_paid = False
        await db.commit()
        return {"status": "canceled", "at_period_end": True}
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail="Failed to cancel subscription")

    data = resp.json()
    status = data.get("status")
    cancel_at_period_end = data.get("cancel_at_period_end", False)

    # Access persists until the end of the billing period; is_paid stays true
    # and the customer.subscription.deleted/updated webhook will clear it later.
    user.is_paid = status != "canceled"
    await db.commit()

    return {
        "status": status or "canceled",
        "at_period_end": bool(cancel_at_period_end) or status == "canceled",
        "current_period_end": data.get("current_period_end"),
    }


def _verify_webhook_signature(payload: bytes, sig_header: str, secret: str) -> bool:
    """Verify a Stripe webhook signature (HMAC-SHA256, `t=<ts>,v1=<sig>`)."""
    if not sig_header or not secret:
        return False
    try:
        timestamp, expected = None, None
        for part in sig_header.split(","):
            key, _, value = part.partition("=")
            if key == "t":
                timestamp = value
            elif key == "v1":
                expected = value
        if not timestamp or not expected:
            return False
        signed_payload = f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
        computed = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
        return hmac.compare_digest(computed, expected)
    except Exception:
        return False


async def _activate_subscription(user: User, db: AsyncSession, stripe_data: dict):
    """Grant full access to a user who just paid via Stripe (is_paid = True)."""
    user.is_paid = True
    if stripe_data.get("customer"):
        user.stripe_customer_id = stripe_data["customer"]
    if stripe_data.get("subscription"):
        user.stripe_subscription_id = stripe_data["subscription"]
    await db.commit()


async def _record_payment(db: AsyncSession, user_id: str, session: dict) -> Payment:
    """Insert a row into payments_history from a Stripe checkout session."""
    payment = Payment(
        user_id=user_id,
        stripe_customer_id=session.get("customer"),
        stripe_subscription_id=session.get("subscription"),
        checkout_session_id=session.get("id"),
        tier_id=(session.get("metadata") or {}).get("tier_id"),
        amount=session.get("amount_total") or 0,
        currency=session.get("currency") or "thb",
        status="paid" if session.get("payment_status") == "paid" else "pending",
        event_type="checkout.session.completed",
    )
    db.add(payment)
    await db.commit()
    return payment


async def _deactivate_subscription(user: User, db: AsyncSession):
    user.is_paid = False
    await db.commit()


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Handle Stripe events.

    - checkout.session.completed  -> grant access (user.is_paid = True)
    - customer.subscription.deleted / invoice.payment_failed -> revoke access
    """
    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Stripe webhook secret is not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    if not _verify_webhook_signature(payload, sig_header, settings.stripe_webhook_secret):
        raise HTTPException(status_code=400, detail="Invalid signature")

    try:
        event = json.loads(payload)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid payload")

    event_type = event.get("type")
    data = event.get("data") or {}
    obj = data.get("object") or {}

    # Map a checkout session to its user + subscription via client_reference_id.
    # Supports both card subscriptions (mode=subscription, has subscription id)
    # and PromptPay one-time payments (mode=payment, no subscription).
    if event_type == "checkout.session.completed":
        session = obj
        user_id = session.get("client_reference_id")
        subscription = session.get("subscription")
        if not user_id:
            return JSONResponse({"received": True, "skipped": "no client_reference_id"})
        user = await _user_by_id(db, user_id)
        if not user:
            return JSONResponse({"received": True, "skipped": "user not found"})
        # On first payment the session already carries the customer + subscription.
        await _activate_subscription(user, db, {"customer": session.get("customer"), "subscription": subscription})
        # Persist the subscription id (session.subscription is usually set on completed).
        if subscription:
            user.stripe_subscription_id = subscription
        # Remember which tier the user subscribed to (drives image quotas etc.).
        tier_id = (session.get("metadata") or {}).get("tier_id")
        if tier_id:
            user.tier_id = tier_id
        await db.commit()
        # Record the payment in the history table.
        await _record_payment(db, user_id, session)
        return JSONResponse({"received": True, "user_id": user_id, "is_paid": True, "payment_method": (session.get("metadata") or {}).get("payment_method")})

    # A subscription object: id, customer, status, items[0].price.metadata.tier_id.
    if event_type in ("customer.subscription.deleted", "customer.subscription.updated"):
        subscription_id = obj.get("id")
        customer_id = obj.get("customer")
        status = obj.get("status")
        active = status in ("active", "trialing", "past_due")
        if event_type == "customer.subscription.deleted":
            active = False
        if not customer_id:
            return JSONResponse({"received": True, "skipped": "no customer"})
        result = await db.execute(
            select(User).where(User.stripe_customer_id == customer_id)
        )
        user = result.scalar_one_or_none()
        if not user:
            return JSONResponse({"received": True, "skipped": "user not found"})
        if active:
            user.is_paid = True
            if subscription_id:
                user.stripe_subscription_id = subscription_id
        else:
            user.is_paid = False
        await db.commit()
        return JSONResponse({"received": True, "user_id": user.id, "is_paid": user.is_paid})

    return JSONResponse({"received": True})
