import os
import json
import smtplib
import secrets
import requests
import uuid
import re
import base64
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import List, Optional
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, Depends, HTTPException, Request, Body, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware 
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, Session
from werkzeug.security import generate_password_hash, check_password_hash
from models import Base, User, EmailVerification, Chat, Message

import config

# DB setup
engine = create_engine(config.DATABASE_URL, connect_args={"check_same_thread": False} if "sqlite" in config.DATABASE_URL else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base.metadata.create_all(bind=engine)

# FastAPI setup
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5000", "http://127.0.0.1:5000"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=config.SECRET_KEY)

frontend_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'frontend')
# Serve all frontend assets (HTML, CSS, JS) directly from the frontend folder
app.mount("/static", StaticFiles(directory=frontend_path), name="static-assets")
# Serve uploaded images
app.mount("/uploads", StaticFiles(directory=config.UPLOAD_FOLDER), name="uploads")

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def generate_chat_title_from_content(content: str, max_words: int = 6) -> str:
    if not content:
        return "New Chat"

    cleaned = re.sub(r'[^a-zA-Z0-9\s]', ' ', content)
    words = [w for w in cleaned.lower().split() if w]
    if not words:
        return "New Chat"

    drop_prefix = {
        "what", "whats", "what's", "how", "why", "can", "could", "would",
        "should", "will", "is", "are", "do", "does", "did", "please", "pls",
        "plz", "tell", "show", "find", "check", "explain", "give", "provide",
        "need", "i", "we", "me", "us", "my", "our"
    }
    stopwords = drop_prefix.union({"the", "a", "an", "in", "on", "of", "for", "with", "to", "at", "from", "about", "using"})

    while words and words[0] in drop_prefix:
        words.pop(0)

    filtered = []
    for w in words:
        if len(filtered) >= max_words:
            break
        if w in stopwords and filtered:
            continue
        filtered.append(w)

    if not filtered:
        filtered = words[:max_words]

    title = " ".join(filtered).strip()
    if not title:
        return "New Chat"

    return title[:60].title()

# Schemas
class RegisterPayload(BaseModel):
    username: str
    email: EmailStr
    password: str
    verification_token: str

class LoginPayload(BaseModel):
    username: str
    password: str

class MessagePayload(BaseModel):
    content: Optional[str] = ""
    image_data: Optional[List[dict]] = None

class VerificationPayload(BaseModel):
    email: EmailStr
    code: str

class SendCodePayload(BaseModel):
    email: EmailStr

class ResetPasswordPayload(BaseModel):
    current_password: str
    new_password: str

class UserMemoryPayload(BaseModel):
    memory: Optional[str] = ""

class ForgotPasswordResetPayload(BaseModel):
    email: EmailStr
    code: str
    new_password: str

# Helpers
def generate_numeric_code(length=6):
    return ''.join(secrets.choice('0123456789') for _ in range(length))

def send_verification_email(recipient_email, code):
    subject = "Your Verification Code"
    body = f"Your verification code is: {code}\n\nThis code expires in {config.VERIFICATION_CODE_EXPIRY_MINUTES} minutes."

    if not config.MAIL_SERVER or not config.MAIL_USERNAME or not config.MAIL_PASSWORD or not config.MAIL_DEFAULT_SENDER:
        error_msg = "Email settings not configured."
        print(f"[Email] {error_msg}")
        print(f"[Email] Verification code for {recipient_email}: {code}")
        return False, error_msg

    message = EmailMessage()
    message['Subject'] = subject
    message['From'] = config.MAIL_DEFAULT_SENDER
    message['To'] = recipient_email
    message.set_content(body)

    try:
        if config.MAIL_USE_TLS:
            with smtplib.SMTP(config.MAIL_SERVER, config.MAIL_PORT, timeout=10) as smtp:
                smtp.starttls()
                smtp.login(config.MAIL_USERNAME, config.MAIL_PASSWORD)
                smtp.send_message(message)
        elif config.MAIL_USE_SSL:
            with smtplib.SMTP_SSL(config.MAIL_SERVER, config.MAIL_PORT, timeout=10) as smtp:
                smtp.login(config.MAIL_USERNAME, config.MAIL_PASSWORD)
                smtp.send_message(message)
        else:
            with smtplib.SMTP(config.MAIL_SERVER, config.MAIL_PORT, timeout=10) as smtp:
                smtp.login(config.MAIL_USERNAME, config.MAIL_PASSWORD)
                smtp.send_message(message)
        print(f"[Email] Sent to {recipient_email}")
        return True, None
    except Exception as error:
        print(f"[Email] Send failed: {error}")
        print(f"[Email] Verification code for {recipient_email}: {code}")
        return False, str(error)

def call_gemini_api(api_key, messages, user_memory=None):
    model = 'gemini-2.5-flash'
    headers = {"Content-Type": "application/json"}
    params = {"key": api_key}

    contents = []
    for msg in messages:
        role = msg.get('role', 'user')
        if role == 'assistant':
            role = 'model'
        content = msg.get('content', '')
        image_data = msg.get('image_data')
        parts = []
        if content:
            parts.append({"text": content})
        if image_data:
            if isinstance(image_data, list):
                for file_item in image_data:
                    file_type = file_item.get('type', 'image/jpeg')
                    file_data = file_item.get('data', '')
                    if file_type.startswith('image/') and file_data:
                        parts.append({"inline_data": {"mime_type": file_type, "data": file_data}})
                    elif file_type == 'application/pdf':
                        file_name = file_item.get('name', 'document.pdf')
                        parts.append({"text": f"\n[PDF File: {file_name} - Please analyze the content of this PDF document]"})
            else:
                if image_data:
                    parts.append({"inline_data": {"mime_type": "image/jpeg", "data": image_data}})
        if not parts:
            parts.append({"text": "Please analyze this."})
        contents.append({"role": role, "parts": parts})

    # Build system instruction
    system_text = "Format every answer in clean Markdown.\n\nUse headings, bullet points, and proper fenced code blocks for any code.\n\nNever use placeholder tokens like INLINECODE_0 or ARTIFACT_0.\n\nGive real code only, inside code fences.\n\nDo not add extra text like 'here is your answer' — just give the formatted Markdown output."
    
    # Add user memory/preferences if provided
    if user_memory and user_memory.strip():
        system_text = f"{system_text}\n\nUser Preferences and Context:\n{user_memory.strip()}\n\nRemember these preferences and context in all your responses."
    
    payload = {
        "contents": contents,
        "systemInstruction": {
            "parts": [{
                "text": system_text
            }]
        },
        "generationConfig": {
            "temperature": 0.7,
            "maxOutputTokens": 2000
        }
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    try:
        response = requests.post(url, json=payload, headers=headers, params=params, timeout=30)
        response.raise_for_status()

        # Parse JSON safely
        try:
            result = response.json()
        except json.JSONDecodeError as json_err:
            response_text = response.text[:1000]
            return {"error": f"Invalid JSON response: {str(json_err)}. Preview: {response_text}"}

        if not result:
            return {"error": "Empty response received"}

        # Flexible text extraction
        text = None

        if 'candidates' in result and isinstance(result['candidates'], list) and len(result['candidates']) > 0:
            candidate = result['candidates'][0]
            if 'finishReason' in candidate:
                finish_reason = candidate.get('finishReason', '')
                if finish_reason in ['SAFETY', 'RECITATION', 'OTHER']:
                    safety_ratings = candidate.get('safetyRatings', [])
                    safety_info = ', '.join([f"{r.get('category', 'Unknown')}: {r.get('probability', 'Unknown')}" for r in safety_ratings])
                    return {"error": f"Content blocked by safety filters. Reason: {finish_reason}. Details: {safety_info}"}
            if 'content' in candidate:
                content = candidate['content']
                if isinstance(content, dict) and 'parts' in content:
                    parts = content['parts']
                    if isinstance(parts, list):
                        text_parts = []
                        for part in parts:
                            if isinstance(part, dict):
                                if 'text' in part:
                                    text_parts.append(str(part['text']))
                                elif 'content' in part:
                                    text_parts.append(str(part['content']))
                        if text_parts:
                            text = ''.join(text_parts)

        if not text and 'text' in result:
            text = str(result['text'])

        if not text and 'content' in result:
            content = result['content']
            if isinstance(content, str):
                text = content
            elif isinstance(content, dict) and 'text' in content:
                text = str(content['text'])

        if not text and 'message' in result:
            message = result['message']
            if isinstance(message, dict) and 'content' in message:
                text = str(message['content'])
            elif isinstance(message, str):
                text = message

        if not text:
            def extract_text_recursive(obj):
                if isinstance(obj, str) and obj.strip():
                    return obj
                elif isinstance(obj, dict):
                    for key in ['text', 'content', 'message', 'output', 'response']:
                        if key in obj:
                            found_text = extract_text_recursive(obj[key])
                            if found_text:
                                return found_text
                    for value in obj.values():
                        found_text = extract_text_recursive(value)
                        if found_text:
                            return found_text
                elif isinstance(obj, list):
                    for item in obj:
                        found_text = extract_text_recursive(item)
                        if found_text:
                            return found_text
                return None

            text = extract_text_recursive(result)

        if text and text.strip():
            return {
                "choices": [{
                    "message": {
                        "content": text.strip()
                    }
                }]
            }

        return {"error": "Unexpected response format"}
    except requests.exceptions.HTTPError as e:
        error_msg = f"Error {e.response.status_code}: "
        try:
            error_data = e.response.json()
            if 'error' in error_data:
                error_info = error_data['error']
                if isinstance(error_info, dict):
                    detailed_msg = error_info.get('message', error_info.get('status', ''))
                    error_msg += detailed_msg
                elif isinstance(error_info, str):
                    error_msg += error_info
            else:
                error_msg += str(error_data)
        except Exception:
            try:
                error_msg += e.response.text[:500]
            except Exception:
                error_msg += "Unknown error"
        return {"error": error_msg}
    except requests.exceptions.RequestException as e:
        return {"error": f"Network error: {str(e)}"}
    except Exception as e:
        return {"error": f"Unexpected error processing response ({type(e).__name__}): {str(e)}"}

def get_current_user(request: Request, db: Session = Depends(get_db)) -> User:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

# Routes
@app.get("/api/check-username")
def check_username(username: str, db: Session = Depends(get_db)):
    username = username.strip()
    if not username:
        return {"available": False, "message": "Username cannot be empty"}
    exists = db.query(User).filter(User.username == username).first() is not None
    return {"available": not exists, "message": "Username already taken, choose another one" if exists else "Username available"}

@app.post("/api/register")
def register(payload: RegisterPayload, request: Request, db: Session = Depends(get_db)):
    payload.username = payload.username.strip()
    payload.email = payload.email.strip()
    payload.password = payload.password.strip()
    
    if not payload.username or not payload.email or not payload.password or not payload.verification_token:
        raise HTTPException(status_code=400, detail="Missing required fields")

    if db.query(User).filter(User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already taken, choose another one")
    if db.query(User).filter(User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already exists")

    verification_record = db.query(EmailVerification).filter(EmailVerification.email == payload.email).first()
    if not verification_record or verification_record.verification_token != payload.verification_token or not verification_record.verified:
        raise HTTPException(status_code=400, detail="Invalid or unverified email token")

    if verification_record.expires_at < datetime.utcnow():
        db.delete(verification_record)
        db.commit()
        raise HTTPException(status_code=400, detail="Verification expired. Please request a new code.")

    user = User(
        username=payload.username,
        email=payload.email,
        password_hash=generate_password_hash(payload.password)
    )
    db.add(user)
    db.commit()

    db.delete(verification_record)
    db.commit()

    request.session['user_id'] = user.id
    return {"message": "User created successfully", "user_id": user.id}

@app.post("/api/send-verification-code")
def send_verification_code(payload: SendCodePayload, db: Session = Depends(get_db)):
    email = payload.email.strip()
    code = generate_numeric_code()
    hashed_code = generate_password_hash(code)
    expires_at = datetime.utcnow() + timedelta(minutes=config.VERIFICATION_CODE_EXPIRY_MINUTES)

    record = db.query(EmailVerification).filter(EmailVerification.email == email).first()
    if record:
        record.code_hash = hashed_code
        record.created_at = datetime.utcnow()
        record.expires_at = expires_at
        record.attempts = 0
        record.verified = False
        record.verification_token = None
    else:
        record = EmailVerification(
            email=email,
            code_hash=hashed_code,
            expires_at=expires_at
        )
        db.add(record)

    db.commit()

    success, error_msg = send_verification_email(email, code)
    if not success:
        raise HTTPException(status_code=500, detail=error_msg or "Failed to send verification code")
    return {"message": "Verification code sent successfully"}

@app.post("/api/verify-email-code")
def verify_email_code(payload: VerificationPayload, db: Session = Depends(get_db)):
    payload.email = payload.email.strip()
    payload.code = payload.code.strip()
    
    record = db.query(EmailVerification).filter(EmailVerification.email == payload.email).first()
    if not record:
        raise HTTPException(status_code=400, detail="No verification request found for this email")

    if record.expires_at < datetime.utcnow():
        db.delete(record)
        db.commit()
        raise HTTPException(status_code=400, detail="Verification code expired. Please request a new code.")

    if record.attempts >= config.VERIFICATION_MAX_ATTEMPTS:
        db.delete(record)
        db.commit()
        raise HTTPException(status_code=400, detail="Too many incorrect attempts. Please request a new code.")

    if not check_password_hash(record.code_hash, payload.code):
        record.attempts += 1
        db.commit()
        remaining = max(0, config.VERIFICATION_MAX_ATTEMPTS - record.attempts)
        raise HTTPException(status_code=400, detail=f"Invalid code. {remaining} attempts remaining.")

    record.verified = True
    record.verification_token = str(uuid.uuid4())
    record.attempts = 0
    db.commit()

    return {"message": "Email verified successfully", "verification_token": record.verification_token}

@app.post("/api/forgot-password-reset")
def forgot_password_reset(payload: ForgotPasswordResetPayload, db: Session = Depends(get_db)):
    payload.email = payload.email.strip()
    payload.code = payload.code.strip()
    payload.new_password = payload.new_password.strip()

    record = db.query(EmailVerification).filter(EmailVerification.email == payload.email).first()
    if not record:
        raise HTTPException(status_code=400, detail="No verification request found")

    if record.expires_at < datetime.utcnow():
        db.delete(record)
        db.commit()
        raise HTTPException(status_code=400, detail="Verification code expired")

    if not check_password_hash(record.code_hash, payload.code):
        raise HTTPException(status_code=400, detail="Invalid verification code")

    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    user.password_hash = generate_password_hash(payload.new_password)
    db.delete(record)
    db.commit()

    return {"message": "Password reset successfully"}

@app.post("/api/login")
def login(payload: LoginPayload, request: Request, db: Session = Depends(get_db)):
    payload.username = payload.username.strip()
    payload.password = payload.password.strip()
    
    user = db.query(User).filter(User.username == payload.username).first()
    if not user or not check_password_hash(user.password_hash, payload.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    request.session['user_id'] = user.id
    return {"message": "Login successful", "user_id": user.id}

@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {"message": "Logout successful"}

@app.post("/api/reset-password")
def reset_password(payload: ResetPasswordPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    payload.current_password = payload.current_password.strip()
    payload.new_password = payload.new_password.strip()

    if not payload.current_password or not payload.new_password:
        raise HTTPException(status_code=400, detail="Current password and new password are required")

    if not check_password_hash(user.password_hash, payload.current_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    if len(payload.new_password) < 6:
        raise HTTPException(status_code=400, detail="Password must be at least 6 characters")

    user.password_hash = generate_password_hash(payload.new_password)
    db.commit()

    return {"message": "Password reset successfully"}

@app.get("/api/check-auth")
def check_auth(user: User = Depends(get_current_user)):
    return {
        "authenticated": True,
        "user_id": user.id,
        "username": user.username,
        "email": user.email,
        "user_memory": user.user_memory or ""
    }

@app.get("/api/user-memory")
def get_user_memory(user: User = Depends(get_current_user)):
    return {
        "user_memory": user.user_memory or ""
    }

@app.put("/api/user-memory")
def update_user_memory(payload: UserMemoryPayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    user.user_memory = payload.memory.strip() if payload.memory else None
    db.commit()
    return {
        "message": "Memory updated successfully",
        "user_memory": user.user_memory or ""
    }

@app.post("/api/chats")
def create_chat(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat = Chat(user_id=user.id, title="New Chat")
    db.add(chat)
    db.commit()
    db.refresh(chat)
    return {
        "id": chat.id,
        "title": chat.title,
        "created_at": chat.created_at.isoformat(),
        "updated_at": chat.updated_at.isoformat(),
        "archived": chat.archived
    }

@app.get("/api/chats")
def get_chats(archived: bool = False, search: str = "", user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    query = db.query(Chat).filter(Chat.user_id == user.id, Chat.archived == archived)
    if search:
        search_term = f"%{search}%"
        # Search in chat titles OR in any message content within that chat
        query = query.filter(
            (Chat.title.ilike(search_term)) |
            (Chat.messages.any(Message.content.ilike(search_term)))
        )
    chats = query.order_by(Chat.updated_at.desc()).all()
    return [{
        "id": chat.id,
        "title": chat.title,
        "created_at": chat.created_at.isoformat(),
        "updated_at": chat.updated_at.isoformat(),
        "archived": chat.archived,
        "message_count": len(chat.messages)
    } for chat in chats]

@app.get("/api/chats/{chat_id}")
def get_chat(chat_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == user.id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    messages = []
    for msg in chat.messages:
        parsed_image_data = None
        if msg.image_data:
            try:
                parsed = json.loads(msg.image_data)
                parsed_image_data = parsed
            except Exception:
                parsed_image_data = [{"data": msg.image_data, "type": "image/jpeg"}]

        messages.append({
            "id": msg.id,
            "role": msg.role,
            "content": msg.content,
            "image_data": parsed_image_data,
            "created_at": msg.created_at.isoformat()
        })
    return {
        "id": chat.id,
        "title": chat.title,
        "created_at": chat.created_at.isoformat(),
        "updated_at": chat.updated_at.isoformat(),
        "archived": chat.archived,
        "messages": messages
    }

@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == user.id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    db.delete(chat)
    db.commit()
    return {"message": "Chat deleted successfully"}

@app.post("/api/chats/{chat_id}/archive")
def archive_chat(chat_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == user.id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    chat.archived = True
    db.commit()
    return {"message": "Chat archived successfully"}

@app.put("/api/chats/{chat_id}/title")
def update_chat_title(chat_id: int, title: str = Body(..., embed=True), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == user.id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")
    chat.title = title.strip()
    db.commit()
    return {"message": "Title updated successfully"}

@app.post("/api/upload-image")
async def upload_image(file: UploadFile = File(...), user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Validate file type
    if not file.content_type or not (file.content_type.startswith('image/') or file.content_type == 'application/pdf'):
        raise HTTPException(status_code=400, detail="Only images and PDF files are allowed")
    
    # Generate unique filename
    file_ext = Path(file.filename).suffix if file.filename else '.jpg'
    unique_filename = f"{uuid.uuid4()}{file_ext}"
    file_path = config.UPLOAD_FOLDER_PATH / unique_filename
    
    # Save file
    try:
        # Ensure we're at the start of the file
        await file.seek(0)
        content = await file.read()
        
        file_size = len(content)
        print(f"[Debug] Uploading file: {unique_filename}, Size: {file_size} bytes, Type: {file.content_type}")
        
        if file_size == 0:
            raise HTTPException(status_code=400, detail="Empty file uploaded")

        with open(file_path, "wb") as buffer:
            buffer.write(content)
        
        # For images, also read as base64 for Gemini API
        image_base64 = None
        if file.content_type.startswith('image/'):
            image_base64 = base64.b64encode(content).decode('utf-8')
        
        return {
            "filename": unique_filename,
            "url": f"/uploads/{unique_filename}",
            "type": file.content_type,
            "base64": image_base64,
            "name": file.filename
        }
    except HTTPException:
        raise
    except Exception as e:
        print(f"[Error] Upload failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")

@app.post("/api/chats/{chat_id}/messages")
def send_message(chat_id: int, payload: MessagePayload, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    chat = db.query(Chat).filter(Chat.id == chat_id, Chat.user_id == user.id).first()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    if not config.GEMINI_API_KEY or config.GEMINI_API_KEY.strip() == '':
        raise HTTPException(status_code=400, detail="Key not configured. Please set GEMINI_API_KEY in .env file.")

    content = (payload.content or "").strip()
    image_data = payload.image_data

    if not content and not image_data:
        raise HTTPException(status_code=400, detail="Message content or files are required")

    # Determine if this is the first message before we add a new one
    is_first_message = db.query(Message).filter(Message.chat_id == chat_id).count() == 0

    # Process image data - convert file paths to base64 for Gemini API
    image_data_for_storage = None
    image_data_for_api = None
    
    if image_data:
        if isinstance(image_data, list):
            image_data_for_storage = []
            image_data_for_api = []
            for item in image_data:
                if isinstance(item, dict):
                    # If it has a filename/url, it's a saved file
                    if 'filename' in item or 'url' in item:
                        filename = item.get('filename', item.get('url', '').split('/')[-1])
                        file_path = config.UPLOAD_FOLDER_PATH / filename
                        print(f"[Debug] Processing file for chat: {file_path}")
                        if file_path.exists():
                            with open(file_path, 'rb') as f:
                                file_content = f.read()
                                print(f"[Debug] Read {len(file_content)} bytes from {filename}")
                                if len(file_content) > 0:
                                    base64_data = base64.b64encode(file_content).decode('utf-8')
                                    image_data_for_api.append({
                                        "data": base64_data,
                                        "type": item.get('type', 'image/jpeg')
                                    })
                                else:
                                    print(f"[Warning] Empty file: {filename}")
                        else:
                            print(f"[Error] File not found: {file_path}")
                        image_data_for_storage.append({
                            "filename": item.get('filename'),
                            "url": item.get('url'),
                            "type": item.get('type'),
                            "name": item.get('name')
                        })
                    elif 'data' in item:
                        # Base64 data (for backward compatibility or pasted images)
                        image_data_for_api.append(item)
                        image_data_for_storage.append(item)
        else:
            image_data_for_storage = image_data
            image_data_for_api = image_data
        
        image_data_json = json.dumps(image_data_for_storage)
    else:
        image_data_json = None

    user_message = Message(
        chat_id=chat_id,
        role='user',
        content=content or 'Files uploaded',
        image_data=image_data_json
    )
    db.add(user_message)
    db.commit()

    previous_messages = db.query(Message).filter(Message.chat_id == chat_id).order_by(Message.created_at).all()
    messages_for_model = []
    for msg in previous_messages:
        msg_dict = {'role': msg.role, 'content': msg.content}
        if msg.image_data:
            try:
                parsed = json.loads(msg.image_data)
                # Convert stored file paths back to base64 for API
                if isinstance(parsed, list):
                    api_images = []
                    for img in parsed:
                        if isinstance(img, dict) and ('filename' in img or 'url' in img):
                            file_path = config.UPLOAD_FOLDER_PATH / img.get('filename', img.get('url', '').split('/')[-1])
                            if file_path.exists():
                                with open(file_path, 'rb') as f:
                                    file_content = f.read()
                                    base64_data = base64.b64encode(file_content).decode('utf-8')
                                    api_images.append({
                                        "data": base64_data,
                                        "type": img.get('type', 'image/jpeg')
                                    })
                        elif isinstance(img, dict) and 'data' in img:
                            api_images.append(img)
                    if api_images:
                        msg_dict['image_data'] = api_images
                else:
                    msg_dict['image_data'] = parsed
            except Exception:
                pass
        messages_for_model.append(msg_dict)

    current_msg = {'role': 'user', 'content': content or 'What do you see in these files?'}
    if image_data_for_api:
        current_msg['image_data'] = image_data_for_api
    messages_for_model.append(current_msg)

    # Include user memory in API call
    response = call_gemini_api(config.GEMINI_API_KEY, messages_for_model, user_memory=user.user_memory)

    if 'error' in response:
        error_msg = response['error']
        if any(term in error_msg.lower() for term in ['invalid', 'unauthorized', 'authentication', 'key']):
            error_msg = f"Invalid key: {error_msg}. Please check your GEMINI_API_KEY in .env file. Get your key from https://aistudio.google.com/"
        elif any(term in error_msg.lower() for term in ['quota', 'rate limit']):
            error_msg = f"Quota/rate limit: {error_msg}. Please try again later or check your quota at https://aistudio.google.com/"
        raise HTTPException(status_code=500, detail=error_msg)

    assistant_content = response.get('choices', [{}])[0].get('message', {}).get('content', 'No response')

    assistant_message = Message(
        chat_id=chat_id,
        role='assistant',
        content=assistant_content
    )
    db.add(assistant_message)

    if is_first_message:
        if content:
            chat.title = generate_chat_title_from_content(content)
        elif image_data:
            if isinstance(image_data, list):
                file_count = len(image_data)
                chat.title = f"{file_count} file{'s' if file_count > 1 else ''} uploaded"
            else:
                chat.title = "Image Upload"
        else:
            chat.title = "New Chat"

    chat.updated_at = datetime.utcnow()
    db.commit()

    user_msg_response = {
        'id': user_message.id,
        'role': user_message.role,
        'content': user_message.content,
        'created_at': user_message.created_at.isoformat()
    }
    if user_message.image_data:
        try:
            parsed = json.loads(user_message.image_data)
            user_msg_response['image_data'] = parsed if isinstance(parsed, list) else parsed
        except Exception:
            user_msg_response['image_data'] = user_message.image_data

    return {
        'user_message': user_msg_response,
        'assistant_message': {
            'id': assistant_message.id,
            'role': assistant_message.role,
            'content': assistant_message.content,
            'created_at': assistant_message.created_at.isoformat()
        }
    }

@app.get("/")
def index():
    return FileResponse(os.path.join(frontend_path, "index.html"))

@app.get("/home.html")
def home():
    return FileResponse(os.path.join(frontend_path, "home.html"))

# Serve remaining frontend routes/files
app.mount("/", StaticFiles(directory=frontend_path, html=True), name="frontend")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="localhost", port=5000, reload=True)