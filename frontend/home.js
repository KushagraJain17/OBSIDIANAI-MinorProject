const API_BASE_URL = '/api';

let currentChatId = null;
let currentFiles = []; // Array of {name, data, type}
let chats = [];

const WELCOME_HTML = `
    <div class="welcome-message" id="welcome-screen">
        <div class="welcome-icon">
            <img src="logo.png" alt="ObsidianAI Logo" style="width: 80px; height: 80px; object-fit: contain;">
        </div>
        <h3>Welcome to ObsidianAI</h3>
        <p>Your intelligent companion for notes and insights.</p>
        <div class="welcome-actions">
            <p>Drag and drop files here or start typing below</p>
        </div>
    </div>
`;

// Handle paste event for clipboard images
async function handlePaste(event) {
    const clipboardData = event.clipboardData || window.clipboardData;
    if (!clipboardData) return;

    const items = clipboardData.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type.indexOf('image') !== -1) {
            event.preventDefault();
            event.stopPropagation();

            const file = item.getAsFile();
            if (file) {
                const placeholder = {
                    name: `pasted-image-${Date.now()}.png`,
                    data: null,
                    type: file.type || 'image/png',
                    filename: null,
                    url: null,
                    isLoading: true,
                    error: null
                };
                currentFiles.push(placeholder);
                updateFilePreview();

                // Upload pasted image
                (async () => {
                    try {
                        const formData = new FormData();
                        formData.append('file', file);

                        const response = await fetch(`${API_BASE_URL}/upload-image`, {
                            method: 'POST',
                            credentials: 'include',
                            body: formData
                        });

                        if (response.ok) {
                            const data = await response.json();
                            placeholder.filename = data.filename;
                            placeholder.url = data.url;
                            placeholder.data = data.base64;
                            placeholder.isLoading = false;
                        } else {
                            const errorData = await response.json();
                            placeholder.error = errorData.error || 'Failed to upload';
                            placeholder.isLoading = false;
                        }
                    } catch (error) {
                        placeholder.error = 'Failed to upload file';
                        placeholder.isLoading = false;
                    }
                    updateFilePreview();
                })();
            }
            break;
        }
    }
}

// Check authentication on page load
window.addEventListener('DOMContentLoaded', () => {
    checkAuth();
});

async function checkAuth() {
    try {
        const response = await fetch(`${API_BASE_URL}/check-auth`, {
            credentials: 'include'
        });

        if (!response.ok) {
            window.location.href = 'index.html';
            return;
        }

        const data = await response.json();
        if (!data.authenticated) {
            window.location.href = 'index.html';
            return;
        }

        // Load chats first
        await loadChats();

        // Check for chatId in URL hash
        const urlParams = new URLSearchParams(window.location.search);
        const chatIdFromUrl = urlParams.get('chatId');
        const hashChatId = window.location.hash.substring(1);

        if (chatIdFromUrl) {
            await loadChat(chatIdFromUrl);
        } else if (hashChatId) {
            await loadChat(hashChatId);
        } else {
            // Try to load last active chat from localStorage
            const lastChatId = localStorage.getItem('lastChatId');
            if (lastChatId) {
                await loadChat(lastChatId);
            }
        }
    } catch (error) {
        console.error('Auth check failed:', error);
        window.location.href = 'index.html';
    }
}


let showArchived = false;

async function loadChats() {
    try {
        const response = await fetch(`${API_BASE_URL}/chats?archived=${showArchived}`, {
            credentials: 'include'
        });

        if (response.ok) {
            chats = await response.json();
            renderChats();
        }
    } catch (error) {
        console.error('Failed to load chats:', error);
    }
}

function toggleArchivedView() {
    showArchived = !showArchived;
    const toggleText = document.getElementById('archive-toggle-text');
    if (toggleText) {
        toggleText.textContent = showArchived ? 'Show Active' : 'Show Archived';
    }
    loadChats();
}

function renderChats() {
    const chatsList = document.getElementById('chats-list');
    chatsList.innerHTML = '';

    if (chats.length === 0) {
        chatsList.innerHTML = '<div style="padding: 1rem; color: var(--text-light); text-align: center;">No chats yet</div>';
        return;
    }

    chats.forEach(chat => {
        const chatItem = document.createElement('div');
        chatItem.className = 'chat-item' + (chat.id === currentChatId ? ' active' : '');
        chatItem.innerHTML = `
            <span class="chat-item-title" onclick="loadChat(${chat.id})">${chat.title}</span>
        `;
        chatsList.appendChild(chatItem);
    });
}

async function createNewChat() {
    try {
        const response = await fetch(`${API_BASE_URL}/chats`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ title: 'New Chat' })
        });

        if (response.ok) {
            const chat = await response.json();
            currentChatId = chat.id;
            document.getElementById('chat-title').textContent = chat.title;

            // Save to persistence
            localStorage.setItem('lastChatId', chat.id);
            window.location.hash = chat.id;

            document.getElementById('messages-container').innerHTML = WELCOME_HTML;
            currentFiles = [];
            document.getElementById('message-input').value = '';
            clearFilePreview();

            // Set a timeout to delete the chat if no messages are sent within 5 minutes
            setTimeout(async () => {
                try {
                    const checkResponse = await fetch(`${API_BASE_URL}/chats/${chat.id}`, {
                        credentials: 'include'
                    });
                    if (checkResponse.ok) {
                        const chatData = await checkResponse.json();
                        if (chatData.messages && chatData.messages.length === 0) {
                            // Delete empty chat
                            await fetch(`${API_BASE_URL}/chats/${chat.id}`, {
                                method: 'DELETE',
                                credentials: 'include'
                            });
                            if (currentChatId === chat.id) {
                                currentChatId = null;
                                document.getElementById('messages-container').innerHTML = WELCOME_HTML;
                            }
                            await loadChats();
                        }
                    }
                } catch (error) {
                    console.error('Failed to check/delete empty chat:', error);
                }
            }, 5 * 60 * 1000); // 5 minutes

            await loadChats();
        }
    } catch (error) {
        console.error('Failed to create chat:', error);
        alert('Failed to create new chat');
    }
}

async function loadChat(chatId) {
    if (!chatId) return;
    try {
        const response = await fetch(`${API_BASE_URL}/chats/${chatId}`, {
            credentials: 'include'
        });

        if (response.ok) {
            const chat = await response.json();
            currentChatId = chat.id;
            document.getElementById('chat-title').textContent = chat.title;

            // Save to persistence
            localStorage.setItem('lastChatId', chat.id);
            window.location.hash = chat.id;

            // Render messages
            renderMessages(chat.messages);

            // Update active chat in sidebar
            await loadChats();

            // Scroll to bottom
            const messagesContainer = document.getElementById('messages-container');
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } else {
            // If chat not found, clear persistence
            localStorage.removeItem('lastChatId');
            window.location.hash = '';
        }
    } catch (error) {
        console.error('Failed to load chat:', error);
    }
}

function renderMessages(messages) {
    const messagesContainer = document.getElementById('messages-container');
    messagesContainer.innerHTML = '';

    if (messages.length === 0) {
        messagesContainer.innerHTML = WELCOME_HTML;
        return;
    }

    messages.forEach(message => {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${message.role}`;

        const content = document.createElement('div');
        content.className = 'message-content';

        // Handle multiple images/files
        let imageData = message.image_data;
        if (typeof imageData === 'string') {
            try {
                imageData = JSON.parse(imageData);
            } catch (e) {
                // leave as-is for backward compatibility
            }
        }

        // Create image container first
        const imageContainer = document.createElement('div');
        imageContainer.className = 'message-images';

        if (imageData) {
            if (Array.isArray(imageData)) {
                imageData.forEach((fileData, index) => {
                    if (fileData.type && fileData.type.startsWith('image/')) {
                        const img = document.createElement('img');
                        // Use URL if available (from filename), otherwise fallback to base64
                        if (fileData.filename) {
                            // Construct URL from filename
                            img.src = `/uploads/${fileData.filename}`;
                        } else if (fileData.url) {
                            img.src = fileData.url;
                        } else if (fileData.data) {
                            img.src = `data:${fileData.type};base64,${fileData.data}`;
                        }
                        img.className = 'message-image';
                        img.alt = fileData.name || 'Uploaded image';
                        img.onerror = function () {
                            // Fallback if image fails to load
                            if (fileData.data) {
                                this.src = `data:${fileData.type};base64,${fileData.data}`;
                            } else {
                                this.alt = 'Image failed to load';
                            }
                        };
                        imageContainer.appendChild(img);
                    } else if (fileData.type === 'application/pdf') {
                        const pdfInfo = document.createElement('div');
                        pdfInfo.className = 'file-info-message';
                        pdfInfo.style.cssText = 'padding: 0.5rem; background: rgba(0,0,0,0.05); border-radius: 6px; margin: 0.25rem 0;';
                        pdfInfo.textContent = `${fileData.name || 'PDF File'} (PDF)`;
                        imageContainer.appendChild(pdfInfo);
                    }
                });
            } else if (imageData.data && imageData.type) {
                // Single file object (backward compatibility)
                if (imageData.type.startsWith('image/')) {
                    const img = document.createElement('img');
                    if (imageData.filename) {
                        img.src = `/uploads/${imageData.filename}`;
                    } else if (imageData.url) {
                        img.src = imageData.url;
                    } else if (imageData.data) {
                        img.src = `data:${imageData.type};base64,${imageData.data}`;
                    }
                    img.className = 'message-image';
                    img.alt = imageData.name || 'Uploaded image';
                    img.onerror = function () {
                        if (imageData.data) {
                            this.src = `data:${imageData.type};base64,${imageData.data}`;
                        } else {
                            this.alt = 'Image failed to load';
                        }
                    };
                    imageContainer.appendChild(img);
                } else if (imageData.type === 'application/pdf') {
                    const pdfInfo = document.createElement('div');
                    pdfInfo.className = 'file-info-message';
                    pdfInfo.style.cssText = 'padding: 0.5rem; background: rgba(0,0,0,0.05); border-radius: 6px; margin: 0.25rem 0;';
                    pdfInfo.textContent = `${imageData.name || 'PDF File'} (PDF)`;
                    imageContainer.appendChild(pdfInfo);
                }
            } else {
                // Single base64 image string (legacy)
                const img = document.createElement('img');
                img.src = `data:image/jpeg;base64,${message.image_data}`;
                img.className = 'message-image';
                img.alt = 'Uploaded image';
                imageContainer.appendChild(img);
            }
        }

        // Add images first
        if (imageContainer.children.length > 0) {
            content.appendChild(imageContainer);
        }

        // Then add text content
        if (message.content) {
            const textContent = document.createElement('div');
            // Render markdown content
            if (typeof marked !== 'undefined') {
                textContent.innerHTML = marked.parse(message.content);
            } else {
                // Fallback to plain text if marked is not loaded
                textContent.textContent = message.content;
            }
            content.appendChild(textContent);
        }

        messageDiv.appendChild(content);
        messagesContainer.appendChild(messageDiv);
    });
}

async function handleFileUpload(event) {
    const files = Array.from(event.target.files);
    if (!files || files.length === 0) return;

    const validFiles = [];

    files.forEach(file => {
        if (file.type.startsWith('image/') || file.type === 'application/pdf') {
            validFiles.push(file);
        } else {
            alert(`File "${file.name}" is not supported. Please select images or PDF files.`);
        }
    });

    if (validFiles.length === 0) return;

    for (const file of validFiles) {
        const placeholder = {
            name: file.name,
            data: null,
            type: file.type,
            filename: null,
            url: null,
            isLoading: true,
            error: null
        };
        currentFiles.push(placeholder);
        updateFilePreview();

        try {
            const formData = new FormData();
            formData.append('file', file);

            const response = await fetch(`${API_BASE_URL}/upload-image`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });

            if (response.ok) {
                const data = await response.json();
                placeholder.filename = data.filename;
                placeholder.url = data.url;
                placeholder.data = data.base64; // Keep base64 for preview
                placeholder.isLoading = false;
            } else {
                const errorData = await response.json();
                placeholder.error = errorData.error || 'Failed to upload';
                placeholder.isLoading = false;
            }
        } catch (error) {
            placeholder.error = 'Failed to upload file';
            placeholder.isLoading = false;
        }

        updateFilePreview();
    }
}

function updateFilePreview() {
    const preview = document.getElementById('file-preview');
    preview.innerHTML = '';

    currentFiles.forEach((file, index) => {
        const item = document.createElement('div');
        item.className = 'file-preview-item';
        if (file.isLoading) {
            item.classList.add('loading');
        }
        if (file.error) {
            item.classList.add('error');
        }

        if (file.isLoading) {
            const overlay = document.createElement('div');
            overlay.className = 'file-loading-overlay';
            overlay.innerHTML = `
                <div class="loader-spinner"></div>
                <span>Loading...</span>
            `;
            item.appendChild(overlay);
        }

        if (!file.isLoading && file.type.startsWith('image/') && (file.url || file.data)) {
            const img = document.createElement('img');
            img.src = file.url || `data:${file.type};base64,${file.data}`;
            img.alt = file.name;
            item.appendChild(img);
        } else if (!file.isLoading && file.type === 'application/pdf') {
            const pdfInfo = document.createElement('div');
            pdfInfo.className = 'file-info';
            pdfInfo.textContent = file.name + ' (PDF)';
            item.appendChild(pdfInfo);
        } else if (file.error) {
            const errorInfo = document.createElement('div');
            errorInfo.className = 'file-info';
            errorInfo.textContent = file.error;
            item.appendChild(errorInfo);
        }

        const removeBtn = document.createElement('button');
        removeBtn.innerHTML = '✕';
        removeBtn.onclick = () => {
            currentFiles.splice(index, 1);
            updateFilePreview();
        };
        item.appendChild(removeBtn);

        preview.appendChild(item);
    });
}

function clearFilePreview() {
    currentFiles = [];
    document.getElementById('file-preview').innerHTML = '';
    document.getElementById('image-input').value = '';
}

async function sendMessage() {
    const messageInput = document.getElementById('message-input');
    const content = messageInput.value.trim();

    if (!content && currentFiles.length === 0) {
        alert('Please enter a message or upload files');
        return;
    }

    if (currentFiles.some(f => f.isLoading)) {
        alert('Please wait for files to finish loading');
        return;
    }

    if (currentFiles.some(f => f.error)) {
        alert('Please remove files that failed to load');
        return;
    }

    const filesToSend = currentFiles.map(f => ({ ...f }));

    // Create chat if none exists
    if (!currentChatId) {
        await createNewChat();
    }

    // Add user message to UI immediately
    const messagesContainer = document.getElementById('messages-container');
    const welcomeMessage = messagesContainer.querySelector('.welcome-message');
    if (welcomeMessage) {
        welcomeMessage.remove();
    }

    const userMessageDiv = document.createElement('div');
    userMessageDiv.className = 'message user';

    let messageHtml = '<div class="message-content">';

    // Add files preview
    if (filesToSend.length > 0) {
        filesToSend.forEach(file => {
            if (file.type.startsWith('image/')) {
                const src = file.url || `data:${file.type};base64,${file.data}`;
                messageHtml += `<img src="${src}" class="message-image" alt="${file.name}">`;
            } else if (file.type === 'application/pdf') {
                messageHtml += `<div style="padding: 0.5rem; background: rgba(0,0,0,0.05); border-radius: 6px; margin: 0.25rem 0;">${file.name} (PDF)</div>`;
            }
        });
    }

    messageHtml += `<div>${content || 'Files uploaded'}</div></div>`;
    userMessageDiv.innerHTML = messageHtml;
    messagesContainer.appendChild(userMessageDiv);

    // Show loading message
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant';
    loadingDiv.id = 'loading-message';
    loadingDiv.innerHTML = `<div class="message-content">Thinking...</div>`;
    messagesContainer.appendChild(loadingDiv);

    messagesContainer.scrollTop = messagesContainer.scrollHeight;

    // Clear input
    messageInput.value = '';
    clearFilePreview();

    try {
        // Prepare files data - send file info (filename, url) if uploaded, otherwise base64
        const filesData = filesToSend.length > 0 ? filesToSend.map(f => {
            if (f.filename && f.url) {
                return {
                    filename: f.filename,
                    url: f.url,
                    type: f.type,
                    name: f.name
                };
            } else {
                return {
                    name: f.name,
                    data: f.data,
                    type: f.type
                };
            }
        }) : null;

        // Build request body
        const requestBody = {
            content: content,
            image_data: filesData || null // Send as array for multiple files
        };

        const response = await fetch(`${API_BASE_URL}/chats/${currentChatId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(requestBody)
        });

        const data = await response.json();

        // Remove loading message
        document.getElementById('loading-message').remove();

        if (response.ok) {
            // Add assistant response with typing animation
            await typeMessage(data.assistant_message.content, messagesContainer);

            // Chat title is now updated dynamically on the backend based on first message
            // Reload chats to update title
            await loadChats();

            // Update displayed title
            if (data.assistant_message && currentChatId) {
                try {
                    const chatResponse = await fetch(`${API_BASE_URL}/chats/${currentChatId}`, {
                        credentials: 'include'
                    });
                    if (chatResponse.ok) {
                        const chatData = await chatResponse.json();
                        document.getElementById('chat-title').textContent = chatData.title;
                    }
                } catch (error) {
                    console.error('Failed to update chat title:', error);
                }
            }
        } else {
            // Show error message in chat
            const errorMessageDiv = document.createElement('div');
            errorMessageDiv.className = 'message assistant';
            errorMessageDiv.innerHTML = `
                <div class="message-content" style="color: var(--danger-color);">
                    Error: ${data.error || 'Failed to send message'}
                </div>
            `;
            messagesContainer.appendChild(errorMessageDiv);

            // Also show alert for important errors
            if (data.error && (data.error.includes('balance') || data.error.includes('key'))) {
                alert(data.error);
            }
        }

        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    } catch (error) {
        document.getElementById('loading-message')?.remove();
        console.error('Failed to send message:', error);
        alert('Network error. Please try again.');
    }
}

// Typing animation function - 5000 words per minute
async function typeMessage(text, container) {
    const assistantMessageDiv = document.createElement('div');
    assistantMessageDiv.className = 'message assistant';
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    assistantMessageDiv.appendChild(contentDiv);
    container.appendChild(assistantMessageDiv);

    const charsPerSecond = 500;
    const delayPerChar = 1000 / charsPerSecond;

    // Display markdown character by character
    let currentText = '';
    for (let i = 0; i < text.length; i++) {
        currentText += text[i];

        // Render markdown as we type
        if (typeof marked !== 'undefined') {
            contentDiv.innerHTML = marked.parse(currentText);
        } else {
            // Fallback to plain text if marked is not loaded
            contentDiv.textContent = currentText;
        }

        // Scroll to bottom periodically
        if (i % 20 === 0) {
            container.scrollTop = container.scrollHeight;
        }

        await new Promise(resolve => setTimeout(resolve, delayPerChar));
    }

    // Final scroll
    container.scrollTop = container.scrollHeight;
}


function handleKeyPress(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function toggleSearch() {
    const searchContainer = document.getElementById('search-container');
    if (searchContainer.style.display === 'none') {
        searchContainer.style.display = 'block';
        document.getElementById('search-input').focus();
    } else {
        searchContainer.style.display = 'none';
        document.getElementById('search-input').value = '';
        searchChats();
    }
}

async function searchChats() {
    const query = document.getElementById('search-input').value;
    try {
        const url = query
            ? `${API_BASE_URL}/chats?search=${encodeURIComponent(query)}&archived=${showArchived}`
            : `${API_BASE_URL}/chats?archived=${showArchived}`;

        const response = await fetch(url, {
            credentials: 'include'
        });

        if (response.ok) {
            chats = await response.json();
            renderChats();
        }
    } catch (error) {
        console.error('Failed to search chats:', error);
    }
}

function showChatMenu() {
    const menu = document.getElementById('chat-menu');
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.chat-actions')) {
        document.getElementById('chat-menu').style.display = 'none';
    }
});

async function deleteCurrentChat() {
    if (!currentChatId) return;

    if (!confirm('Are you sure you want to delete this chat?')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/chats/${currentChatId}`, {
            method: 'DELETE',
            credentials: 'include'
        });

        if (response.ok) {
            currentChatId = null;
            document.getElementById('chat-title').textContent = 'New Chat';
            document.getElementById('messages-container').innerHTML = WELCOME_HTML;
            await loadChats();
        } else {
            alert('Failed to delete chat');
        }
    } catch (error) {
        console.error('Failed to delete chat:', error);
        alert('Failed to delete chat');
    }
}

async function archiveCurrentChat() {
    if (!currentChatId) return;

    try {
        const response = await fetch(`${API_BASE_URL}/chats/${currentChatId}/archive`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ archived: true })
        });

        if (response.ok) {
            currentChatId = null;
            document.getElementById('chat-title').textContent = 'New Chat';
            document.getElementById('messages-container').innerHTML = WELCOME_HTML;
            await loadChats();
        } else {
            alert('Failed to archive chat');
        }
    } catch (error) {
        console.error('Failed to archive chat:', error);
        alert('Failed to archive chat');
    }
}

async function showSettings() {
    document.getElementById('settings-modal').style.display = 'flex';
    await loadAccountInfo();
}

function closeSettings() {
    document.getElementById('settings-modal').style.display = 'none';
}

async function loadAccountInfo() {
    try {
        const response = await fetch(`${API_BASE_URL}/check-auth`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            if (data.authenticated) {
                document.getElementById('account-username').value = data.username || '';
                document.getElementById('account-email').value = data.email || '';
                document.getElementById('user-memory').value = data.user_memory || '';
            }
        }
    } catch (error) {
        console.error('Failed to load account info:', error);
    }
}

async function saveUserMemory() {
    const memory = document.getElementById('user-memory').value.trim();
    const messageEl = document.getElementById('memory-save-message');

    try {
        const response = await fetch(`${API_BASE_URL}/user-memory`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ memory: memory })
        });

        const data = await response.json();

        if (response.ok) {
            messageEl.style.display = 'block';
            messageEl.style.color = '#22c55e';
            messageEl.textContent = 'Memory saved successfully! The AI will remember this in all future conversations.';

            setTimeout(() => {
                messageEl.style.display = 'none';
            }, 3000);
        } else {
            messageEl.style.display = 'block';
            messageEl.style.color = 'var(--danger-color)';
            messageEl.textContent = data.error || 'Failed to save memory';
        }
    } catch (error) {
        console.error('Failed to save memory:', error);
        messageEl.style.display = 'block';
        messageEl.style.color = 'var(--danger-color)';
        messageEl.textContent = 'Network error. Please try again.';
    }
}


async function resetPassword() {
    const currentPassword = document.getElementById('current-password').value.trim();
    const newPassword = document.getElementById('new-password').value.trim();
    const confirmPassword = document.getElementById('confirm-password').value.trim();
    const messageEl = document.getElementById('password-reset-message');

    if (!currentPassword || !newPassword || !confirmPassword) {
        messageEl.style.display = 'block';
        messageEl.style.color = 'var(--danger-color)';
        messageEl.textContent = 'Please fill in all fields';
        return;
    }

    if (newPassword.length < 6) {
        messageEl.style.display = 'block';
        messageEl.style.color = 'var(--danger-color)';
        messageEl.textContent = 'Password must be at least 6 characters';
        return;
    }

    if (newPassword !== confirmPassword) {
        messageEl.style.display = 'block';
        messageEl.style.color = 'var(--danger-color)';
        messageEl.textContent = 'New passwords do not match';
        return;
    }

    try {
        const response = await fetch(`${API_BASE_URL}/reset-password`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword
            })
        });

        const data = await response.json();

        if (response.ok) {
            messageEl.style.display = 'block';
            messageEl.style.color = '#22c55e';
            messageEl.textContent = 'Password reset successfully';

            // Clear fields
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
            document.getElementById('confirm-password').value = '';

            setTimeout(() => {
                messageEl.style.display = 'none';
            }, 3000);
        } else {
            messageEl.style.display = 'block';
            messageEl.style.color = 'var(--danger-color)';
            messageEl.textContent = data.error || 'Failed to reset password';
        }
    } catch (error) {
        console.error('Failed to reset password:', error);
        messageEl.style.display = 'block';
        messageEl.style.color = 'var(--danger-color)';
        messageEl.textContent = 'Network error. Please try again.';
    }
}

function renameChat() {
    if (!currentChatId) return;

    const titleElement = document.getElementById('chat-title');
    const currentTitle = titleElement.textContent;

    // Create input element
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentTitle;
    input.style.cssText = 'font-size: 1.25rem; font-weight: 600; border: 2px solid rgba(74, 222, 128, 0.9); border-radius: 8px; padding: 0.25rem 0.5rem; width: 100%; background: rgba(255, 255, 255, 0.9); outline: none; color: #000;';
    input.style.maxWidth = '400px';

    // Replace title with input
    titleElement.style.display = 'none';
    titleElement.parentNode.insertBefore(input, titleElement);
    input.focus();
    input.select();

    const finishRename = async () => {
        const newTitle = input.value.trim();
        if (newTitle && newTitle !== currentTitle) {
            await updateChatTitle(currentChatId, newTitle);
        }
        titleElement.style.display = 'block';
        input.remove();
    };

    input.addEventListener('blur', finishRename);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            finishRename();
        } else if (e.key === 'Escape') {
            titleElement.style.display = 'block';
            input.remove();
        }
    });
}

async function updateChatTitle(chatId, newTitle) {
    newTitle = newTitle.trim();
    if (!newTitle) return;

    try {
        const response = await fetch(`${API_BASE_URL}/chats/${chatId}/title`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify({ title: newTitle })
        });

        if (response.ok) {
            document.getElementById('chat-title').textContent = newTitle;
            await loadChats();
        } else {
            alert('Failed to update chat title');
        }
    } catch (error) {
        console.error('Failed to update chat title:', error);
        alert('Failed to update chat title');
    }
}

async function logout() {
    try {
        // Clear persistence
        localStorage.removeItem('lastChatId');
        window.location.hash = '';

        await fetch(`${API_BASE_URL}/logout`, {
            method: 'POST',
            credentials: 'include'
        });
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Logout failed:', error);
        window.location.href = 'index.html';
    }
}

// Close modal when clicking outside
document.getElementById('settings-modal')?.addEventListener('click', (e) => {
    if (e.target.id === 'settings-modal') {
        closeSettings();
    }
});

// Initialize Drag and Drop
document.addEventListener('DOMContentLoaded', () => {
    const mainContent = document.querySelector('.main-content');
    const dropOverlay = document.getElementById('drop-overlay');

    if (mainContent && dropOverlay) {
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            mainContent.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            }, false);
        });

        ['dragenter', 'dragover'].forEach(eventName => {
            mainContent.addEventListener(eventName, () => {
                dropOverlay.classList.add('active');
            }, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            mainContent.addEventListener(eventName, () => {
                dropOverlay.classList.remove('active');
            }, false);
        });

        mainContent.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;

            if (files && files.length > 0) {
                const event = { target: { files: files } };
                handleFileUpload(event);
            }
        }, false);
    }
});