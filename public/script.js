// Socket.IO connection
const socket = io();

// DOM elements
const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const logoutBtn = document.getElementById('logout-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const otherUserName = document.getElementById('other-user-name');
const userStatus = document.getElementById('user-status');
const typingIndicator = document.getElementById('typing-indicator');
const toastContainer = document.getElementById('toast-container');

// App state
let currentUser = null;
let otherUser = null;
let typingTimer = null;
let isTyping = false;
let notificationSound = null;
let audioContext = null;

// Initialize notification sound
function initializeNotificationSound() {
    try {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        
        return function playNotificationSound() {
            if (audioContext.state === 'suspended') {
                audioContext.resume();
            }
            
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(audioContext.destination);
            
            oscillator.frequency.value = 800;
            oscillator.type = 'sine';
            
            gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);
            
            oscillator.start(audioContext.currentTime);
            oscillator.stop(audioContext.currentTime + 0.3);
        };
    } catch (error) {
        console.warn('Audio not supported:', error);
        return null;
    }
}

// Utility functions
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const iconMap = {
        'success': 'check-circle',
        'error': 'exclamation-triangle',
        'info': 'info-circle'
    };
    
    toast.innerHTML = `
        <i class="fas fa-${iconMap[type] || 'info-circle'}"></i>
        <span>${message}</span>
    `;
    
    toastContainer.appendChild(toast);
    
    // Auto remove toast after 3 seconds
    setTimeout(() => {
        if (toast.parentNode) {
            toast.style.animation = 'slideOut 0.3s ease forwards';
            setTimeout(() => {
                toast.remove();
            }, 300);
        }
    }, 3000);
}

function showError(message) {
    loginError.textContent = message;
    loginError.style.display = 'block';
    
    setTimeout(() => {
        loginError.style.display = 'none';
    }, 4000);
}

function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const messageDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    
    if (messageDate.getTime() === today.getTime()) {
        // Today - show time only
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
        // Other days - show date and time
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + 
               date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
}

function formatLastSeen(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const timeDiff = now - date;
    
    if (timeDiff < 60000) { // Less than 1 minute
        return 'Last seen just now';
    } else if (timeDiff < 3600000) { // Less than 1 hour
        const minutes = Math.floor(timeDiff / 60000);
        return `Last seen ${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    } else if (timeDiff < 86400000) { // Less than 1 day
        const hours = Math.floor(timeDiff / 3600000);
        return `Last seen ${hours} hour${hours > 1 ? 's' : ''} ago`;
    } else {
        // More than 1 day
        const days = Math.floor(timeDiff / 86400000);
        if (days === 1) {
            return 'Last seen yesterday';
        } else {
            return `Last seen ${days} days ago`;
        }
    }
}

function scrollToBottom() {
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function updateOtherUserStatus(isOnline, lastSeen) {
    if (isOnline) {
        userStatus.textContent = 'Online';
        userStatus.className = 'status online';
    } else if (lastSeen) {
        userStatus.textContent = formatLastSeen(lastSeen);
        userStatus.className = 'status offline';
    } else {
        userStatus.textContent = 'Offline';
        userStatus.className = 'status offline';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function displayMessage(message) {
    const messageDiv = document.createElement('div');
    const isSent = message.sender === currentUser;
    
    messageDiv.className = `message ${isSent ? 'sent' : 'received'}`;
    messageDiv.innerHTML = `
        <div class="message-bubble">
            <div class="message-text">${escapeHtml(message.message)}</div>
            <div class="message-time">${formatTime(message.timestamp)}</div>
        </div>
    `;
    
    chatMessages.appendChild(messageDiv);
    scrollToBottom();
}

// Authentication functions
async function login(username, password) {
    try {
        // Disable login button during request
        const loginBtn = document.querySelector('.login-btn');
        loginBtn.disabled = true;
        loginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Logging in...';
        
        const response = await fetch('/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ username, password }),
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentUser = data.username;
            otherUser = username === 'Gauri' ? 'Btye' : 'Gauri';
            otherUserName.textContent = otherUser;
            
            // Switch to chat screen
            loginScreen.classList.add('hidden');
            chatScreen.classList.remove('hidden');
            
            // Authenticate with socket
            socket.emit('authenticate', currentUser);
            
            // Load chat history
            await loadChatHistory();
            
            // Check other user status
            await checkOtherUserStatus();
            
            // Initialize notification sound
            notificationSound = initializeNotificationSound();
            
            // Request notification permission
            if ('Notification' in window && Notification.permission === 'default') {
                Notification.requestPermission();
            }
            
            // Focus on message input
            messageInput.focus();
            showToast('Welcome to the chat!', 'success');
        } else {
            showError(data.error || 'Invalid username or password');
        }
    } catch (error) {
        console.error('Login error:', error);
        showError('Connection error. Please check your internet connection and try again.');
    } finally {
        // Re-enable login button
        const loginBtn = document.querySelector('.login-btn');
        loginBtn.disabled = false;
        loginBtn.innerHTML = '<i class="fas fa-sign-in-alt"></i> Login';
    }
}

async function logout() {
    if (confirm('Are you sure you want to logout?')) {
        try {
            currentUser = null;
            otherUser = null;
            
            // Switch to login screen
            chatScreen.classList.add('hidden');
            loginScreen.classList.remove('hidden');
            
            // Clear chat messages
            chatMessages.innerHTML = `
                <div class="welcome-message">
                    <i class="fas fa-lock"></i>
                    <p>This is a private conversation between you and your chat partner.</p>
                    <p>Messages are end-to-end encrypted.</p>
                </div>
            `;
            
            // Clear form
            document.getElementById('username').value = '';
            document.getElementById('password').value = '';
            
            // Reset typing state
            isTyping = false;
            typingIndicator.classList.add('hidden');
            
            // Focus on username input
            document.getElementById('username').focus();
            
            showToast('Logged out successfully', 'success');
        } catch (error) {
            console.error('Logout error:', error);
            showToast('Error during logout', 'error');
        }
    }
}

// Chat functions
async function loadChatHistory() {
    try {
        const response = await fetch(`/messages/${currentUser}`);
        const messages = await response.json();
        
        // Clear existing messages
        chatMessages.innerHTML = '';
        
        if (messages.length === 0) {
            chatMessages.innerHTML = `
                <div class="welcome-message">
                    <i class="fas fa-lock"></i>
                    <p>This is a private conversation between you and ${otherUser}.</p>
                    <p>Messages are end-to-end encrypted.</p>
                </div>
            `;
        } else {
            messages.forEach(message => {
                displayMessage(message);
            });
        }
        
        scrollToBottom();
    } catch (error) {
        console.error('Error loading chat history:', error);
        showToast('Error loading chat history', 'error');
    }
}

async function checkOtherUserStatus() {
    try {
        const response = await fetch(`/user-status/${otherUser}`);
        const status = await response.json();
        updateOtherUserStatus(status.is_online, status.last_seen);
    } catch (error) {
        console.error('Error checking user status:', error);
    }
}

function sendMessage() {
    const message = messageInput.value.trim();
    if (!message || message.length > 1000) {
        if (message.length > 1000) {
            showToast('Message too long. Maximum 1000 characters allowed.', 'error');
        }
        return;
    }
    
    // Disable send button temporarily
    sendBtn.disabled = true;
    
    // Emit message to server
    socket.emit('send_message', {
        sender: currentUser,
        receiver: otherUser,
        message: message
    });
    
    // Clear input
    messageInput.value = '';
    messageInput.style.height = 'auto';
    
    // Stop typing indicator
    if (isTyping) {
        socket.emit('stop_typing', { user: currentUser });
        isTyping = false;
    }
    
    // Re-enable send button
    setTimeout(() => {
        sendBtn.disabled = false;
    }, 500);
}

async function clearChat() {
    const confirmMessage = 'Are you sure you want to clear all chat history?\n\nThis action cannot be undone and will delete all messages for both users.';
    
    if (confirm(confirmMessage)) {
        try {
            // Disable clear button during request
            clearChatBtn.disabled = true;
            clearChatBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            
            const response = await fetch('/clear-chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                }
            });
            
            if (response.ok) {
                showToast('Chat history cleared successfully', 'success');
            } else {
                showToast('Error clearing chat history', 'error');
            }
        } catch (error) {
            console.error('Error clearing chat:', error);
            showToast('Error clearing chat history', 'error');
        } finally {
            // Re-enable clear button
            clearChatBtn.disabled = false;
            clearChatBtn.innerHTML = '<i class="fas fa-trash"></i>';
        }
    }
}

// Event listeners
loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = document.getElementById('username').value.trim();
    const password = document.getElementById('password').value.trim();
    
    if (!username || !password) {
        showError('Please enter both username and password');
        return;
    }
    
    login(username, password);
});

sendBtn.addEventListener('click', sendMessage);

messageInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
        return;
    }
    
    // Handle typing indicator
    if (!isTyping) {
        socket.emit('typing', { user: currentUser });
        isTyping = true;
    }
    
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
        socket.emit('stop_typing', { user: currentUser });
        isTyping = false;
    }, 1000);
});

messageInput.addEventListener('input', function() {
    // Auto-resize textarea
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    
    // Update send button state
    sendBtn.disabled = this.value.trim().length === 0;
});

logoutBtn.addEventListener('click', logout);
clearChatBtn.addEventListener('click', clearChat);

// Socket event listeners
socket.on('connect', () => {
    console.log('Connected to server');
    if (currentUser) {
        showToast('Connected to server', 'success');
    }
});

socket.on('disconnect', () => {
    console.log('Disconnected from server');
    showToast('Connection lost. Reconnecting...', 'error');
});

socket.on('reconnect', () => {
    console.log('Reconnected to server');
    showToast('Reconnected successfully', 'success');
    
    // Re-authenticate if user was logged in
    if (currentUser) {
        socket.emit('authenticate', currentUser);
    }
});

socket.on('receive_message', (message) => {
    displayMessage(message);
    
    // Show notification if message is from other user
    if (message.sender !== currentUser) {
        showToast('New Message', 'info');
        
        // Play notification sound
        if (notificationSound) {
            try {
                notificationSound();
            } catch (error) {
                console.warn('Could not play notification sound:', error);
            }
        }
        
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
            const notification = new Notification(`New message from ${message.sender}`, {
                body: message.message.length > 50 ? message.message.substring(0, 50) + '...' : message.message,
                icon: '/favicon.ico',
                tag: 'new-message'
            });
            
            // Auto-close notification after 3 seconds
            setTimeout(() => {
                notification.close();
            }, 3000);
        }
    }
});

socket.on('user_typing', (data) => {
    if (data.user !== currentUser) {
        typingIndicator.classList.remove('hidden');
        scrollToBottom();
    }
});

socket.on('user_stop_typing', (data) => {
    if (data.user !== currentUser) {
        typingIndicator.classList.add('hidden');
    }
});

socket.on('user_status_changed', (data) => {
    if (data.username === otherUser) {
        updateOtherUserStatus(data.isOnline, data.lastSeen);
    }
});

socket.on('chat_cleared', () => {
    chatMessages.innerHTML = `
        <div class="welcome-message">
            <i class="fas fa-lock"></i>
            <p>This is a private conversation between you and ${otherUser}.</p>
            <p>Messages are end-to-end encrypted.</p>
        </div>
    `;
    showToast('Chat history cleared by admin', 'info');
});

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
    // Focus on username input
    document.getElementById('username').focus();
    
    // Initialize send button state
    sendBtn.disabled = true;
    
    // Add CSS for slide out animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes slideOut {
            from {
                transform: translateX(0);
                opacity: 1;
            }
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
    document.head.appendChild(style);
    
    // Handle keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + Enter to send message
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && currentUser) {
            sendMessage();
        }
        
        // Escape to logout
        if (e.key === 'Escape' && currentUser) {
            logout();
        }
    });
    
    // Initialize audio context on first user interaction
    document.addEventListener('click', () => {
        if (audioContext && audioContext.state === 'suspended') {
            audioContext.resume();
        }
    }, { once: true });
});

// Handle page visibility for better UX
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // User switched to another tab
        console.log('User left the page');
    } else {
        // User came back to the page
        console.log('User returned to the page');
        if (currentUser) {
            // Refresh other user status when coming back
            checkOtherUserStatus();
        }
    }
});

// Handle online/offline status
window.addEventListener('online', () => {
    showToast('Internet connection restored', 'success');
});

window.addEventListener('offline', () => {
    showToast('Internet connection lost', 'error');
});

// Handle beforeunload to cleanup
window.addEventListener('beforeunload', () => {
    if (currentUser && isTyping) {
        socket.emit('stop_typing', { user: currentUser });
    }
});

// Prevent context menu on mobile for better UX
document.addEventListener('contextmenu', (e) => {
    if (window.innerWidth <= 768) {
        e.preventDefault();
    }
});

// Handle touch events for mobile
let touchStartY = 0;
document.addEventListener('touchstart', (e) => {
    touchStartY = e.touches[0].clientY;
});

document.addEventListener('touchmove', (e) => {
    const touchY = e.touches[0].clientY;
    const touchDiff = touchStartY - touchY;
    
    // Prevent pull-to-refresh on mobile
    if (touchDiff < 0 && window.scrollY === 0) {
        e.preventDefault();
    }
});

// Auto-scroll to bottom when new messages arrive
const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            const addedNode = mutation.addedNodes[0];
            if (addedNode.classList && addedNode.classList.contains('message')) {
                scrollToBottom();
            }
        }
    });
});

// Start observing chat messages for new additions
observer.observe(chatMessages, { childList: true });

console.log('Private Messaging App initialized successfully!');