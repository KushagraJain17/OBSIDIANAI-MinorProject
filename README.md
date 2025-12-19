# ObsidianAI - Conversational Image Recognition Chatbot

A full-stack web application for conversational image recognition using Google Gemini API. This application features user authentication (with email verification), chat history management, and a minimalist UI with lime green accents.

## Features

- **User Authentication**: Secure login and registration system with email verification.
- **Chat Management**: Create, search, delete, and archive chats.
- **Image Recognition**: Upload images and PDF files (analyzed as images) to get AI-powered descriptions and answers.
- **Conversation History**: Maintains context for follow-up questions within a chat session.
- **Gemini Integration**: Powered by Google's Gemini 2.5 Flash model for fast and accurate multimodal responses.
- **Markdown Support**: AI responses are formatted in clean Markdown.
- **Responsive Design**: Minimalist and responsive user interface.

## Project Structure

```
.
├── backend/
│   ├── app.py              # Flask backend API
│   ├── config.py           # Configuration management
│   ├── models.py           # SQLAlchemy database models
│   ├── requirements.txt    # Python dependencies
│   ├── .env                # Environment variables (not tracked)
│   └── uploads/            # Directory for user uploaded files
├── frontend/
│   ├── index.html          # Login/Registration page
│   ├── home.html           # Main chat interface
│   ├── styles.css          # Application styling
│   ├── auth.js             # Authentication logic
│   ├── home.js             # Chat interface logic
│   └── logo.png            # Application logo
└── README.md
```

## Setup Instructions

### Prerequisites

- Python 3.8+
- A Google Gemini API Key
- An SMTP email account (e.g., Gmail with App Password) for sending verification codes.

### Backend Setup

1.  **Navigate to the backend directory:**
    ```bash
    cd backend
    ```

2.  **Create a virtual environment:**
    ```bash
    python -m venv venv
    ```

3.  **Activate the virtual environment:**
    - Windows:
        ```bash
        venv\Scripts\activate
        ```
    - Linux/Mac:
        ```bash
        source venv/bin/activate
        ```

4.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

5.  **Configure Environment Variables:**
    Create a `.env` file in the `backend` directory. You can copy the example below and fill in your values.

    **backend/.env**
    ```ini
    # Core Security
    SECRET_KEY=your_super_secret_random_key_here

    # Database (Optional, defaults to sqlite:///chatbot.db)
    # DATABASE_URL=sqlite:///chatbot.db

    # Google Gemini API
    GEMINI_API_KEY=your_gemini_api_key_from_google_ai_studio

    # Email Configuration (Required for Registration)
    MAIL_SERVER=smtp.gmail.com
    MAIL_PORT=587
    MAIL_USE_TLS=True
    MAIL_USE_SSL=False
    MAIL_USERNAME=your_email@gmail.com
    MAIL_PASSWORD=your_email_app_password
    MAIL_DEFAULT_SENDER=your_email@gmail.com

    # Verification Settings (Optional)
    VERIFICATION_CODE_EXPIRY_MINUTES=10
    VERIFICATION_MAX_ATTEMPTS=5
    ```

    > **Note:** For Gmail, you likely need to set up an "App Password" if you have 2-Factor Authentication enabled. Use that App Password as the `MAIL_PASSWORD`.

6.  **Run the Server:**
    ```bash
    python app.py
    ```
    The backend will start on `http://localhost:5000`.

### Frontend Setup

The frontend is a static site that communicates with the backend API.

1.  **Serve the frontend:**
    For the best experience, use a simple HTTP server.
    
    ```bash
    cd ../frontend
    python -m http.server 8000
    ```

2.  **Access the Application:**
    Open your browser and navigate to `http://localhost:8000`.

## Usage Guide

1.  **Register:** Sign up with a valid email. Check your email for the verification code to complete registration.
2.  **Login:** Use your credentials to log in.
3.  **New Chat:** Click "New Chat" to start a fresh conversation.
4.  **Upload:** Click the attachment icon to upload images or PDFs.
5.  **Interact:** Type your prompt and hit enter. The AI will respond taking the images into context.
6.  **Manage:** Use the sidebar to switch between chats, search history, or archive old conversations.

## API Endpoints Overview

-   **Auth**: `/api/register`, `/api/login`, `/api/verify-email-code`, `/api/send-verification-code`
-   **Chats**: `/api/chats` (GET, POST), `/api/chats/{id}` (GET, DELETE)
-   **Messages**: `/api/chats/{id}/messages` (POST)
-   **Memory**: `/api/user-memory` (GET, PUT) - *The AI remembers user preferences.*

## License

[MIT License](LICENSE)
