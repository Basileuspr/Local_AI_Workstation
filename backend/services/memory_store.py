"""
SQLite-backed durable memory for the local assistant.

This is intentionally a small structured store. It does not use embeddings or
vector search; relevant memories are selected by user/project and ranked by
importance and recency.
"""

from datetime import datetime, timezone
from pathlib import Path
import uuid

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, UniqueConstraint, create_engine, or_
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, sessionmaker


from config import settings

DATABASE_PATH = settings.memory_db_path
DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def _utc_now() -> datetime:
    """Return a timezone-naive UTC timestamp that SQLite can store cleanly."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now)


class Project(Base):
    __tablename__ = "projects"
    __table_args__ = (UniqueConstraint("user_id", "name", name="uq_projects_user_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now, onupdate=_utc_now)


class ChatSession(Base):
    __tablename__ = "chat_sessions"

    # String IDs let the existing Electron session IDs also group SQLite messages.
    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now, onupdate=_utc_now)


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[int] = mapped_column(primary_key=True)
    session_id: Mapped[str] = mapped_column(ForeignKey("chat_sessions.id"), index=True)
    role: Mapped[str] = mapped_column(String(30))
    content: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now)


class Memory(Base):
    __tablename__ = "memories"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    project_id: Mapped[int | None] = mapped_column(ForeignKey("projects.id"), nullable=True, index=True)
    session_id: Mapped[str | None] = mapped_column(ForeignKey("chat_sessions.id"), nullable=True, index=True)
    memory_type: Mapped[str] = mapped_column(String(100), default="general")
    memory_text: Mapped[str] = mapped_column(Text)
    importance: Mapped[int] = mapped_column(Integer, default=3)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_utc_now, onupdate=_utc_now)


def initialize_database() -> None:
    """Create the SQLite file and tables when the backend starts."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    Base.metadata.create_all(bind=engine)


def create_user_if_missing(username: str) -> User:
    username = username.strip()
    if not username:
        raise ValueError("username cannot be empty")

    with SessionLocal() as db:
        user = db.query(User).filter(User.username == username).first()
        if user:
            return user

        user = User(username=username)
        db.add(user)
        db.commit()
        db.refresh(user)
        return user


def create_project_if_missing(user_id: int, name: str, description: str | None = None) -> Project:
    """Return a user's named project, creating it when first referenced."""
    name = name.strip()
    if not name:
        raise ValueError("project name cannot be empty")

    with SessionLocal() as db:
        project = db.query(Project).filter(Project.user_id == user_id, Project.name == name).first()
        if project:
            return project

        project = Project(user_id=user_id, name=name, description=description)
        db.add(project)
        db.commit()
        db.refresh(project)
        return project


def _create_session(
    user_id: int,
    project_id: int | None = None,
    title: str | None = None,
    session_id: str | None = None,
) -> ChatSession:
    with SessionLocal() as db:
        chat_session = ChatSession(
            id=session_id or str(uuid.uuid4()),
            user_id=user_id,
            project_id=project_id,
            title=title,
        )
        db.add(chat_session)
        db.commit()
        db.refresh(chat_session)
        return chat_session


def create_session(user_id: int, project_id: int | None = None, title: str | None = None) -> ChatSession:
    return _create_session(user_id=user_id, project_id=project_id, title=title)


def get_or_create_session(
    user_id: int,
    session_id: str | None = None,
    project_id: int | None = None,
    title: str | None = None,
) -> ChatSession:
    """Reuse a UI session ID when available so persisted messages stay grouped."""
    if not session_id:
        return create_session(user_id=user_id, project_id=project_id, title=title)

    with SessionLocal() as db:
        chat_session = db.get(ChatSession, session_id)
        if chat_session:
            if chat_session.user_id != user_id:
                raise ValueError("session belongs to a different user")
            if project_id is not None and chat_session.project_id is None:
                chat_session.project_id = project_id
                db.commit()
                db.refresh(chat_session)
            return chat_session

    return _create_session(
        user_id=user_id,
        project_id=project_id,
        title=title,
        session_id=session_id,
    )


def save_message(session_id: str, role: str, content: str) -> Message:
    with SessionLocal() as db:
        chat_session = db.get(ChatSession, session_id)
        if not chat_session:
            raise ValueError("session does not exist")

        message = Message(session_id=session_id, role=role, content=content)
        chat_session.updated_at = _utc_now()
        db.add(message)
        db.commit()
        db.refresh(message)
        return message


def delete_chat_session_data(session_id: str) -> None:
    """Permanently remove one chat's SQLite transcript and session-scoped memories."""
    with SessionLocal() as db:
        db.query(Message).filter(Message.session_id == session_id).delete(synchronize_session=False)
        db.query(Memory).filter(Memory.session_id == session_id).delete(synchronize_session=False)
        db.query(ChatSession).filter(ChatSession.id == session_id).delete(synchronize_session=False)
        db.commit()


def save_memory(
    user_id: int,
    memory_text: str,
    memory_type: str = "general",
    project_id: int | None = None,
    session_id: str | None = None,
    importance: int = 3,
) -> Memory:
    memory_text = memory_text.strip()
    if not memory_text:
        raise ValueError("memory_text cannot be empty")
    if not 1 <= importance <= 5:
        raise ValueError("importance must be between 1 and 5")

    with SessionLocal() as db:
        memory = Memory(
            user_id=user_id,
            project_id=project_id,
            session_id=session_id,
            memory_type=memory_type.strip() or "general",
            memory_text=memory_text,
            importance=importance,
        )
        db.add(memory)
        db.commit()
        db.refresh(memory)
        return memory


def get_relevant_memories(user_id: int, project_id: int | None = None, limit: int = 10) -> list[Memory]:
    with SessionLocal() as db:
        query = db.query(Memory).filter(Memory.user_id == user_id)

        # Project chats receive project-specific memories plus general user memories.
        if project_id is not None:
            query = query.filter(or_(Memory.project_id == project_id, Memory.project_id.is_(None)))

        return query.order_by(Memory.importance.desc(), Memory.updated_at.desc()).limit(limit).all()


def get_user_by_username(username: str) -> User | None:
    with SessionLocal() as db:
        return db.query(User).filter(User.username == username.strip()).first()


def list_memories(user_id: int) -> list[Memory]:
    with SessionLocal() as db:
        return (
            db.query(Memory)
            .filter(Memory.user_id == user_id)
            .order_by(Memory.importance.desc(), Memory.updated_at.desc())
            .all()
        )


def memory_to_dict(memory: Memory) -> dict:
    return {
        "id": memory.id,
        "user_id": memory.user_id,
        "project_id": memory.project_id,
        "session_id": memory.session_id,
        "memory_type": memory.memory_type,
        "memory_text": memory.memory_text,
        "importance": memory.importance,
        "created_at": memory.created_at.isoformat(),
        "updated_at": memory.updated_at.isoformat(),
    }
