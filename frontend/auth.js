const API_BASE_URL = '/api';

// Check if user is already authenticated
window.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});

const sendCodeButton = document.getElementById('send-code-btn');
const verifyCodeButton = document.getElementById('verify-code-btn');
const registerButton = document.getElementById('register-btn');
const verificationMessage = document.getElementById('verification-status');

let verificationToken = null;
let verificationEmail = null;
let codeCooldownTimeout = null;

async function checkAuth() {
    try {
        const response = await fetch(`${API_BASE_URL}/check-auth`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            if (data.authenticated) {
                window.location.href = 'home.html';
            }
        }
    } catch (error) {
        console.error('Auth check failed:', error);
    }
}

function activateLogin() {
    document.getElementById('register-panel').classList.remove('active');
    document.getElementById('forgot-panel').classList.remove('active');
    document.getElementById('login-panel').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('tab-login').classList.add('active');
    document.querySelector('.tab-slider').style.left = '4px';
    document.getElementById('auth-title').textContent = 'Login';
    document.getElementById('auth-error').textContent = '';
}

function activateRegister() {
    document.getElementById('login-panel').classList.remove('active');
    document.getElementById('forgot-panel').classList.remove('active');
    document.getElementById('register-panel').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('tab-register').classList.add('active');
    document.querySelector('.tab-slider').style.left = 'calc(50% + 0px)';
    document.getElementById('auth-title').textContent = 'Register';
    document.getElementById('auth-error').textContent = '';
}

function activateForgot() {
    document.getElementById('login-panel').classList.remove('active');
    document.getElementById('register-panel').classList.remove('active');
    document.getElementById('forgot-panel').classList.add('active');
    document.getElementById('auth-title').textContent = 'Reset Password';
    document.getElementById('auth-error').textContent = '';
    // Hide tabs when in forgot password mode
    document.querySelector('.auth-tabs').style.display = 'none';
}

// Update activateLogin to show tabs again
const originalActivateLogin = activateLogin;
activateLogin = function () {
    originalActivateLogin();
    document.querySelector('.auth-tabs').style.display = 'flex';
};

async function sendForgotCode() {
    const email = document.getElementById('forgot-email').value.trim();
    const errorElement = document.getElementById('auth-error');

    if (!email) {
        errorElement.textContent = 'Please enter your email';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/send-verification-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        if (response.ok) {
            document.getElementById('forgot-verification').style.display = 'flex';
            document.getElementById('send-forgot-btn').style.display = 'none';
            errorElement.style.color = '#22c55e';
            errorElement.textContent = 'Verification code sent to your email';
        } else {
            const data = await response.json();
            errorElement.style.color = '#ff4444';
            errorElement.textContent = data.detail || 'Failed to send code';
        }
    } catch (error) {
        errorElement.textContent = 'Network error';
    }
}

async function resetForgotPassword() {
    const email = document.getElementById('forgot-email').value.trim();
    const code = document.getElementById('forgot-code').value.trim();
    const newPassword = document.getElementById('forgot-new-password').value.trim();
    const errorElement = document.getElementById('auth-error');

    if (!email || !code || !newPassword) {
        errorElement.textContent = 'Please fill in all fields';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/forgot-password-reset`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, code, new_password: newPassword })
        });

        const data = await response.json();

        if (response.ok) {
            errorElement.style.color = '#22c55e';
            errorElement.textContent = 'Password reset successfully. You can now login.';
            setTimeout(() => activateLogin(), 2000);
        } else {
            errorElement.style.color = '#ff4444';
            errorElement.textContent = data.detail || 'Reset failed';
        }
    } catch (error) {
        errorElement.textContent = 'Network error';
    }
}

async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    const errorElement = document.getElementById('auth-error');

    if (!username || !password) {
        errorElement.style.color = '#ff4444';
        errorElement.textContent = 'Please fill in all fields';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });

        const data = await response.json();

        if (response.ok) {
            window.location.href = 'home.html';
        } else {
            errorElement.style.color = '#ff4444';
            errorElement.textContent = data.detail || data.error || 'Login failed. Please check your credentials.';
        }
    } catch (error) {
        errorElement.style.color = '#ff4444';
        errorElement.textContent = 'Network error. Please try again.';
        console.error('Login error:', error);
    }
}

let usernameCheckTimeout = null;

async function checkUsernameAvailability(username) {
    if (!username || username.trim().length === 0) {
        return;
    }

    const usernameInput = document.getElementById('register-username');
    const errorElement = document.getElementById('auth-error');

    try {
        const response = await fetch(`${API_BASE_URL}/check-username?username=${encodeURIComponent(username.trim())}`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            if (!data.available) {
                errorElement.textContent = 'Username already taken, choose another one';
                usernameInput.style.borderColor = '#ef4444';
            } else {
                errorElement.textContent = '';
                usernameInput.style.borderColor = '';
            }
        }
    } catch (error) {
        console.error('Username check error:', error);
    }
}

async function register() {
    const username = document.getElementById('register-username').value.trim();
    const email = document.getElementById('register-email').value.trim();
    const password = document.getElementById('register-password').value.trim();
    const errorElement = document.getElementById('auth-error');

    if (!username || !email || !password || !verificationToken) {
        errorElement.textContent = 'Please complete all fields and verify your email before signing up.';
        return;
    }
    if (email !== verificationEmail) {
        errorElement.textContent = 'Email mismatch. Please verify the same email you intend to register with.';
        return;
    }

    if (password.length < 6) {
        errorElement.textContent = 'Password must be at least 6 characters';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ username, email, password, verification_token: verificationToken })
        });

        const data = await response.json();

        if (response.ok) {
            window.location.href = 'home.html';
        } else {
            if (data.error && data.error.includes('Username already exists')) {
                errorElement.textContent = 'Username already taken, choose another one';
            } else {
                errorElement.textContent = data.error || data.detail || 'Registration failed';
            }
        }
    } catch (error) {
        errorElement.textContent = 'Network error. Please try again.';
        console.error('Registration error:', error);
    }
}

async function sendVerificationCode() {
    clearVerificationState(false);

    const email = document.getElementById('register-email').value.trim();
    if (!email) {
        verificationMessage && (verificationMessage.textContent = 'Enter an email address before requesting a code.');
        return;
    }

    toggleSendCodeButton(true, 'Sending...');

    try {
        const response = await fetch(`${API_BASE_URL}/send-verification-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email })
        });

        const data = await response.json();

        if (response.ok) {
            verificationMessage && (verificationMessage.textContent = 'Code sent. Check your inbox (and spam).');
            startCodeCooldown();
        } else {
            verificationMessage && (verificationMessage.textContent = data.error || 'Failed to send verification code.');
            toggleSendCodeButton(false);
        }
    } catch (error) {
        verificationMessage && (verificationMessage.textContent = 'Network error sending code.');
        console.error('Send verification code error:', error);
        toggleSendCodeButton(false);
    }
}

async function verifyEmailCode() {
    const email = document.getElementById('register-email').value.trim();
    const code = document.getElementById('verification-code').value.trim();
    const errorElement = document.getElementById('register-error');

    if (!email || !code) {
        verificationMessage && (verificationMessage.textContent = 'Enter both email and code to verify.');
        return;
    }

    verifyCodeButton.disabled = true;
    verifyCodeButton.textContent = 'Verifying...';
    if (verificationMessage) verificationMessage.textContent = '';
    errorElement.textContent = '';

    try {
        const response = await fetch(`${API_BASE_URL}/verify-email-code`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, code })
        });

        const data = await response.json();

        if (response.ok) {
            verificationToken = data.verification_token;
            verificationEmail = email;
            verificationMessage && (verificationMessage.textContent = 'Email verified! You can complete your registration.');
            if (registerButton) registerButton.disabled = false;
            document.getElementById('verification-code')?.setAttribute('disabled', 'disabled');
            sendCodeButton?.setAttribute('disabled', 'disabled');
            if (sendCodeButton) sendCodeButton.textContent = 'Verified';
            if (verifyCodeButton) verifyCodeButton.style.display = 'none';
        } else {
            verificationMessage && (verificationMessage.textContent = data.error || 'Code verification failed.');
            if (verifyCodeButton) {
                verifyCodeButton.disabled = false;
                verifyCodeButton.textContent = 'Verify Email';
            }
        }
    } catch (error) {
        verificationMessage && (verificationMessage.textContent = 'Network error verifying code.');
        console.error('Verify code error:', error);
        if (verifyCodeButton) {
            verifyCodeButton.disabled = false;
            verifyCodeButton.textContent = 'Verify Email';
        }
    }
}

function startCodeCooldown() {
    let remaining = 60;
    toggleSendCodeButton(true, `Resend in ${remaining}s`);

    const tick = () => {
        remaining -= 1;
        if (remaining <= 0) {
            toggleSendCodeButton(false);
            codeCooldownTimeout = null;
        } else {
            toggleSendCodeButton(true, `Resend in ${remaining}s`);
            codeCooldownTimeout = setTimeout(tick, 1000);
        }
    };

    codeCooldownTimeout = setTimeout(tick, 1000);
}

function toggleSendCodeButton(disabled, text) {
    if (!sendCodeButton) return;
    sendCodeButton.disabled = disabled;
    if (text) {
        sendCodeButton.textContent = text;
    } else {
        sendCodeButton.textContent = 'Send Code';
    }
}

function clearVerificationState(resetMessage = true) {
    verificationToken = null;
    verificationEmail = null;
    registerButton && (registerButton.disabled = true);
    document.getElementById('verification-code')?.removeAttribute('disabled');
    if (verifyCodeButton) {
        verifyCodeButton.style.display = 'block';
        verifyCodeButton.disabled = false;
        verifyCodeButton.textContent = 'Verify Email';
    }
    if (resetMessage) {
        verificationMessage && (verificationMessage.textContent = '');
    }
    if (codeCooldownTimeout) {
        clearTimeout(codeCooldownTimeout);
        codeCooldownTimeout = null;
    }
    toggleSendCodeButton(false);
}

// Reset verification when email changes
document.getElementById('register-email')?.addEventListener('input', () => {
    clearVerificationState();
});

// Check username availability in real-time
document.getElementById('register-username')?.addEventListener('input', (e) => {
    const username = e.target.value.trim();
    const errorElement = document.getElementById('register-error');

    // Clear previous timeout
    if (usernameCheckTimeout) {
        clearTimeout(usernameCheckTimeout);
    }

    // Clear error if username is empty
    if (!username) {
        errorElement.textContent = '';
        e.target.style.borderColor = '';
        return;
    }

    // Debounce username check
    usernameCheckTimeout = setTimeout(() => {
        checkUsernameAvailability(username);
    }, 500);
});

// Allow Enter key to submit forms
document.getElementById('login-username')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});

document.getElementById('login-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') login();
});

document.getElementById('register-username')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') register();
});

document.getElementById('register-email')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') register();
});

document.getElementById('register-password')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') register();
});

document.getElementById('verification-code')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') verifyEmailCode();
});