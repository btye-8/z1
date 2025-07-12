const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Database initialization
const db = new sqlite3.Database(':memory:');

// Initialize database tables
db.serialize(() => {
  // Users table
  db.run(`CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    last_seen TEXT DEFAULT CURRENT_TIMESTAMP,
    is_online BOOLEAN DEFAULT 0
  )`);

  // Messages table
  db.run(`CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sender TEXT NOT NULL,
    receiver TEXT NOT NULL,
    message TEXT NOT NULL,
    timestamp TEXT DEFAULT CURRENT_TIMESTAMP
  )`);

  // Insert default users
  const users = [
    { username: 'Gauri', password: '18072007' },
    { username: 'Btye', password: '18042004' }
  ];

  users.forEach(user => {
    const hashedPassword = bcrypt.hashSync(user.password, 10);
    db.run(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [user.username, hashedPassword]
    );
  });
});

// Store active connections
const activeUsers = new Map();

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Login endpoint
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  
  db.get(
    'SELECT * FROM users WHERE username = ?',
    [username],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      
      if (!user || !bcrypt.compareSync(password, user.password_hash)) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }
      
      // Update user status
      db.run(
        'UPDATE users SET is_online = 1, last_seen = CURRENT_TIMESTAMP WHERE username = ?',
        [username]
      );
      
      res.json({ success: true, username: user.username });
    }
  );
});

// Get messages endpoint
app.get('/messages/:username', (req, res) => {
  const username = req.params.username;
  
  db.all(
    'SELECT * FROM messages WHERE sender = ? OR receiver = ? ORDER BY timestamp ASC',
    [username, username],
    (err, messages) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(messages);
    }
  );
});

// Clear chat endpoint
app.post('/clear-chat', (req, res) => {
  db.run('DELETE FROM messages', (err) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    io.emit('chat_cleared');
    res.json({ success: true });
  });
});

// Get user status
app.get('/user-status/:username', (req, res) => {
  const username = req.params.username;
  
  db.get(
    'SELECT is_online, last_seen FROM users WHERE username = ?',
    [username],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(user || { is_online: false, last_seen: null });
    }
  );
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Handle user authentication
  socket.on('authenticate', (username) => {
    socket.username = username;
    activeUsers.set(username, socket.id);
    
    // Update user status in database
    db.run(
      'UPDATE users SET is_online = 1, last_seen = CURRENT_TIMESTAMP WHERE username = ?',
      [username]
    );
    
    // Notify all users about online status
    io.emit('user_status_changed', { username, isOnline: true });
    
    console.log(`User ${username} authenticated`);
  });

  // Handle new messages
  socket.on('send_message', (data) => {
    const { sender, receiver, message } = data;
    const messageId = uuidv4();
    
    // Save message to database
    db.run(
      'INSERT INTO messages (sender, receiver, message, timestamp) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [sender, receiver, message],
      function(err) {
        if (err) {
          console.error('Error saving message:', err);
          return;
        }
        
        // Get the saved message with timestamp
        db.get(
          'SELECT * FROM messages WHERE rowid = ?',
          [this.lastID],
          (err, savedMessage) => {
            if (!err && savedMessage) {
              // Send message to both users
              io.emit('receive_message', savedMessage);
            }
          }
        );
      }
    );
  });

  // Handle user typing
  socket.on('typing', (data) => {
    socket.broadcast.emit('user_typing', data);
  });

  socket.on('stop_typing', (data) => {
    socket.broadcast.emit('user_stop_typing', data);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    if (socket.username) {
      activeUsers.delete(socket.username);
      
      // Update user status in database
      db.run(
        'UPDATE users SET is_online = 0, last_seen = CURRENT_TIMESTAMP WHERE username = ?',
        [socket.username]
      );
      
      // Notify all users about offline status
      io.emit('user_status_changed', { 
        username: socket.username, 
        isOnline: false,
        lastSeen: new Date().toISOString()
      });
      
      console.log(`User ${socket.username} disconnected`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Available users:');
  console.log('Username: Gauri, Password: 18072007');
  console.log('Username: Btye, Password: 18042004');
});