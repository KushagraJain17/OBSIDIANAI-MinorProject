from datetime import datetime
from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    DateTime,
    Boolean,
    ForeignKey,
)
from sqlalchemy.orm import declarative_base, relationship

Base = declarative_base()


class User(Base):
    __tablename__ = "user"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(80), unique=True, nullable=False)
    email = Column(String(120), unique=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    user_memory = Column(Text, nullable=True)  # User's persistent memory/preferences for AI
    created_at = Column(DateTime, default=datetime.utcnow)
    chats = relationship("Chat", back_populates="user", cascade="all, delete-orphan")


class EmailVerification(Base):
    __tablename__ = "email_verification"
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(120), unique=True, nullable=False)
    code_hash = Column(String(255), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    expires_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, default=0)
    verified = Column(Boolean, default=False)
    verification_token = Column(String(255), nullable=True)


class Chat(Base):
    __tablename__ = "chat"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id"), nullable=False)
    title = Column(String(200), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    archived = Column(Boolean, default=False)
    messages = relationship(
        "Message", back_populates="chat", cascade="all, delete-orphan", order_by="Message.created_at"
    )
    user = relationship("User", back_populates="chats")


class Message(Base):
    __tablename__ = "message"
    id = Column(Integer, primary_key=True, index=True)
    chat_id = Column(Integer, ForeignKey("chat.id"), nullable=False)
    role = Column(String(20), nullable=False)  # 'user' or 'assistant'
    content = Column(Text, nullable=False)
    image_data = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    chat = relationship("Chat", back_populates="messages")