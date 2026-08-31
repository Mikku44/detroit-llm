import uuid
from datetime import datetime, timezone

from sqlalchemy import String, Integer, Boolean, DateTime, Text, ForeignKey, BigInteger, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.db.database import Base, ConversationBase


def _utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    google_email: Mapped[str] = mapped_column(String, unique=True, nullable=True)
    google_sub: Mapped[str] = mapped_column(String, unique=True, nullable=True)
    youtube_channel_id: Mapped[str] = mapped_column(String, nullable=True)
    display_name: Mapped[str] = mapped_column(String, nullable=True)
    avatar_url: Mapped[str] = mapped_column(String, nullable=True)
    is_owner: Mapped[bool] = mapped_column(Boolean, default=False)
    is_member: Mapped[bool] = mapped_column(Boolean, default=False)
    # Verification flag. Defaults to True for now (phone verification is hidden).
    is_verified: Mapped[bool] = mapped_column(Boolean, default=True)
    # Verified phone number (from Firebase phone auth).
    phone_number: Mapped[str | None] = mapped_column(String, nullable=True)
    # Direct Stripe subscription payer (separate from YouTube membership).
    is_paid: Mapped[bool] = mapped_column(Boolean, default=False)
    stripe_customer_id: Mapped[str | None] = mapped_column(String, nullable=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Stripe subscription tier (nomad/dreamer/entrepreneur/angel) from webhook metadata.
    tier_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    api_keys: Mapped[list["ApiKey"]] = relationship(back_populates="user", cascade="all, delete-orphan")
    payments: Mapped[list["Payment"]] = relationship(back_populates="user")


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    key_prefix: Mapped[str] = mapped_column(String, nullable=False)
    key_hash: Mapped[str] = mapped_column(String, nullable=False)
    raw_key: Mapped[str | None] = mapped_column(String, nullable=True)
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), nullable=False)
    name: Mapped[str] = mapped_column(String, default="default")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    last_used_at: Mapped[datetime] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="api_keys")
    usage_logs: Mapped[list["UsageLog"]] = relationship(back_populates="api_key", cascade="all, delete-orphan")


class UsageLog(Base):
    __tablename__ = "usage_logs"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    api_key_id: Mapped[str] = mapped_column(String, ForeignKey("api_keys.id"), nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=True)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    total_tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)

    api_key: Mapped["ApiKey"] = relationship(back_populates="usage_logs")


class ImageUsage(Base):
    """One row per generated image, used to enforce per-tier monthly image quotas."""

    __tablename__ = "image_usage"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, index=True, nullable=False)
    model: Mapped[str] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)


class ChannelMember(Base):
    """One row per current YouTube member channel ID.

    Serves as the persisted source of truth for the member list, replacing the
    members.json fallback file. tier_id maps the member's YouTube level to a
    gateway tier (nomad/dreamer/entrepreneur/angel).
    """

    __tablename__ = "channel_members"

    channel_id: Mapped[str] = mapped_column(String, primary_key=True)
    tier_id: Mapped[str | None] = mapped_column(String, nullable=True)
    level_id: Mapped[str | None] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)


class MemberLevel(Base):
    """YouTube membership level ID -> gateway tier map.

    Some members.list responses only expose a level ID (highestAccessibleLevel)
    without a display name. This table resolves those IDs to tiers.
    """

    __tablename__ = "member_levels"

    level_id: Mapped[str] = mapped_column(String, primary_key=True)
    tier_id: Mapped[str] = mapped_column(String, nullable=False, default="nomad")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)


class Payment(Base):
    """Payment history from Stripe subscriptions and one-time payments."""

    __tablename__ = "payments_history"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, ForeignKey("users.id"), index=True, nullable=False)
    # Stripe identifiers.
    stripe_customer_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    stripe_subscription_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    stripe_payment_intent_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    stripe_invoice_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Stripe Checkout session id.
    checkout_session_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    # Tier purchased: nomad/dreamer/entrepreneur/angel.
    tier_id: Mapped[str | None] = mapped_column(String, nullable=True)
    amount: Mapped[int] = mapped_column(Integer, default=0)
    currency: Mapped[str] = mapped_column(String, default="thb")
    status: Mapped[str] = mapped_column(String, default="pending")  # pending | paid | failed | refunded | canceled
    event_type: Mapped[str] = mapped_column(String, nullable=True)  # Stripe event that recorded this row
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)

    user: Mapped["User"] = relationship(back_populates="payments")


class Conversation(ConversationBase):
    __tablename__ = "conversations"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    # Lives in the separate conversations DB; no FK to users.id (cross-DB).
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String, default="New Chat")
    model: Mapped[str] = mapped_column(String, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    messages: Mapped[list["ConversationMessage"]] = relationship(
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="ConversationMessage.position",
    )


class ConversationMessage(ConversationBase):
    __tablename__ = "conversation_messages"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    conversation_id: Mapped[str] = mapped_column(
        String, ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, default="")
    reasoning: Mapped[str] = mapped_column(Text, nullable=True)
    encrypted: Mapped[bool] = mapped_column(Boolean, default=False)
    model: Mapped[str] = mapped_column(String, nullable=True)
    usage: Mapped[str] = mapped_column(Text, nullable=True)  # JSON-serialized
    attachments: Mapped[str] = mapped_column(Text, nullable=True)  # JSON-serialized
    finish_reason: Mapped[str] = mapped_column(String, nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow)

    conversation: Mapped["Conversation"] = relationship(back_populates="messages")
    likes: Mapped[list["MessageLike"]] = relationship(back_populates="message", cascade="all, delete-orphan")


class MessageLike(ConversationBase):
    __tablename__ = "message_likes"
    __table_args__ = (UniqueConstraint("user_id", "message_id", name="uq_message_likes_user_message"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    message_id: Mapped[str] = mapped_column(
        String, ForeignKey("conversation_messages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reaction: Mapped[str] = mapped_column(String, nullable=False, default="like")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, index=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    message: Mapped["ConversationMessage"] = relationship(back_populates="likes")
