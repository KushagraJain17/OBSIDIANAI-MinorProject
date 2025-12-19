import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

# Basic Config
SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///chatbot.db")
UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", "uploads")

# Email Configuration
MAIL_SERVER = os.environ.get('MAIL_SERVER') or 'smtp.gmail.com'
MAIL_PORT = int(os.environ.get('MAIL_PORT') or 587)
MAIL_USE_TLS = os.environ.get('MAIL_USE_TLS', 'True').lower() == 'true'
MAIL_USE_SSL = os.environ.get('MAIL_USE_SSL', 'False').lower() == 'true'
MAIL_USERNAME = os.environ.get('MAIL_USERNAME') or ''
MAIL_PASSWORD = (os.environ.get('MAIL_PASSWORD') or '').replace(' ', '')
MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER') or MAIL_USERNAME

# Verification Logic
VERIFICATION_CODE_EXPIRY_MINUTES = int(os.getenv('VERIFICATION_CODE_EXPIRY_MINUTES', '10'))
VERIFICATION_MAX_ATTEMPTS = int(os.getenv('VERIFICATION_MAX_ATTEMPTS', '5'))

# AI Configuration
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')

# Paths
BASE_DIR = Path(__file__).resolve().parent
UPLOAD_FOLDER_PATH = BASE_DIR / os.getenv("UPLOAD_FOLDER", "uploads")
UPLOAD_FOLDER_PATH.mkdir(parents=True, exist_ok=True)
UPLOAD_FOLDER = str(UPLOAD_FOLDER_PATH)