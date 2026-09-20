from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, 
    Boolean, Numeric, Date, BigInteger
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from typing import List, Optional
from .database import Base

class Role(Base):
    __tablename__ = "roles"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(String(255))

class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    username: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_login: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    roles = relationship("Role", secondary="user_roles")
    student_profile = relationship("Student", back_populates="user", uselist=False)
    lecturer_profile = relationship("Lecturer", back_populates="user", uselist=False)

class UserRole(Base):
    __tablename__ = "user_roles"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id", ondelete="CASCADE"), nullable=False)

class Student(Base):
    __tablename__ = "students"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    nim: Mapped[str] = mapped_column(String(30), unique=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    study_program: Mapped[Optional[str]] = mapped_column(String(150))
    class_name: Mapped[Optional[str]] = mapped_column(String(50))
    phone: Mapped[Optional[str]] = mapped_column(String(30))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = relationship("User", back_populates="student_profile")

class Lecturer(Base):
    __tablename__ = "lecturers"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True)
    nidn: Mapped[Optional[str]] = mapped_column(String(30), unique=True)
    nip: Mapped[Optional[str]] = mapped_column(String(30), unique=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    academic_title: Mapped[Optional[str]] = mapped_column(String(100))
    email: Mapped[Optional[str]] = mapped_column(String(150))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    user = relationship("User", back_populates="lecturer_profile")

class Journal(Base):
    __tablename__ = "journals"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    abbreviation: Mapped[Optional[str]] = mapped_column(String(100))
    sinta_level: Mapped[Optional[str]] = mapped_column(String(10))
    field: Mapped[Optional[str]] = mapped_column(String(150))
    website_url: Mapped[Optional[str]] = mapped_column(String(500))
    submission_url: Mapped[Optional[str]] = mapped_column(String(500))
    template_url: Mapped[Optional[str]] = mapped_column(String(500))
    apc_info: Mapped[Optional[str]] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Article(Base):
    __tablename__ = "articles"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    project_id: Mapped[Optional[int]] = mapped_column(BigInteger) # simplified relation
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    abstract: Mapped[Optional[str]] = mapped_column(Text)
    journal_id: Mapped[Optional[int]] = mapped_column(ForeignKey("journals.id", ondelete="SET NULL"))
    status: Mapped[Optional[str]] = mapped_column(String(50))
    current_version_id: Mapped[Optional[int]] = mapped_column(BigInteger) # To break circular ref, mapped softly
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    finalized_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    journal = relationship("Journal")
    authors = relationship("ArticleAuthor", back_populates="article")

class ArticleAuthor(Base):
    __tablename__ = "article_authors"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), nullable=False)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    author_order: Mapped[int] = mapped_column(Integer, nullable=False)
    is_corresponding: Mapped[bool] = mapped_column(Boolean, default=False)

    article = relationship("Article", back_populates="authors")
    student = relationship("Student")

class ArticleVersion(Base):
    __tablename__ = "article_versions"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    file_name: Mapped[Optional[str]] = mapped_column(String(255))
    file_path: Mapped[Optional[str]] = mapped_column(String(500))
    file_url: Mapped[Optional[str]] = mapped_column(String(500))
    file_type: Mapped[Optional[str]] = mapped_column(String(50))
    file_size: Mapped[Optional[int]] = mapped_column(BigInteger)
    uploaded_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    version_status: Mapped[Optional[str]] = mapped_column(String(50))
    submission_note: Mapped[Optional[str]] = mapped_column(Text)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

class Review(Base):
    __tablename__ = "reviews"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(BigInteger) # simplified
    article_version_id: Mapped[Optional[int]] = mapped_column(ForeignKey("article_versions.id", ondelete="SET NULL"))
    reviewer_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    recommendation: Mapped[Optional[str]] = mapped_column(String(50))
    overall_score: Mapped[Optional[float]] = mapped_column(Numeric(5,2))
    comments_for_author: Mapped[Optional[str]] = mapped_column(Text)
    comments_for_coordinator: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[Optional[str]] = mapped_column(String(50))
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class MentorshipAssignment(Base):
    __tablename__ = "mentorship_assignments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    lecturer_id: Mapped[int] = mapped_column(ForeignKey("lecturers.id", ondelete="CASCADE"), nullable=False)
    article_id: Mapped[int] = mapped_column(ForeignKey("articles.id", ondelete="CASCADE"), nullable=False)
    assigned_by: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    assigned_at: Mapped[Optional[datetime]] = mapped_column(DateTime, default=datetime.utcnow)
    status: Mapped[Optional[str]] = mapped_column(String(50))
    notes: Mapped[Optional[str]] = mapped_column(Text)

    student = relationship("Student")
    lecturer = relationship("Lecturer")
    article = relationship("Article")
