const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const { auth, adminAuth } = require('./middleware/auth');

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB connection error:', err));

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Join a chat room
  socket.on('joinChat', (chatId) => {
    socket.join(chatId);
    console.log(`User ${socket.id} joined chat ${chatId}`);
  });

  // Handle new message
  socket.on('sendMessage', async (data) => {
    const { chatId, sender, content, userId } = data;
    const Message = require('./models/Message');
    const Chat = require('./models/Chat');

    const User = require('./models/User');

    // For authenticated users, use userId as chat identifier
    // For anonymous users, use the generated chatId
    const chatIdentifier = userId || chatId;

    // Create or find the chat
    let chat = await Chat.findOne({ userId: chatIdentifier });
    if (!chat) {
      try {
        chat = new Chat({ userId: chatIdentifier });
        await chat.save();
      } catch (error) {
        if (error.code === 11000) { // Duplicate key error
          chat = await Chat.findOne({ userId: chatIdentifier });
        } else {
          throw error;
        }
      }
    }

    // Resolve username for easier identification in admin console
    let username;
    try {
      if (userId) {
        const user = await User.findById(userId).select('username');
        username = user ? user.username : undefined;
      } else if (data.username) {
        username = data.username;
      } else {
        username = 'Anonymous';
      }
    } catch (err) {
      username = data.username || 'Anonymous';
    }

    const message = new Message({ chatId: chat._id, userId, username, sender, content });
    await message.save();

    // Update chat timestamp
    chat.updatedAt = new Date();
    await chat.save();

    // Emit to all users in the chat room
    io.to(chatId).emit('newMessage', message);
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Authentication routes
app.post('/api/auth/register', async (req, res) => {
  const { username, email, password, role = 'user' } = req.body;
  const User = require('./models/User');

  try {
    const user = new User({ username, email, password, role });
    await user.save();
    const token = jwt.sign({ _id: user._id, role: user.role }, process.env.JWT_SECRET);
    res.status(201).json({ user: { _id: user._id, username: user.username, email: user.email, role: user.role }, token });
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Username or email already exists' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  const User = require('./models/User');

  try {
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const token = jwt.sign({ _id: user._id, role: user.role }, process.env.JWT_SECRET);
    res.json({ user: { _id: user._id, username: user.username, email: user.email, role: user.role }, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Protected API routes for admin
app.get('/api/chats', auth, async (req, res) => {
  const Chat = require('./models/Chat');
  const User = require('./models/User');
  try {
    let query = {};

    // If userId query param is provided, filter by that user
    if (req.query.userId) {
      query.userId = req.query.userId;
    } else if (req.user.role !== 'admin') {
      // Non-admin users can only see their own chats
      query.userId = req.user._id;
    }

    // Chat.userId is stored as Mixed (ObjectId or string). Populate user info
    let chats = await Chat.find(query).sort({ updatedAt: -1 }).lean();
    const mongoose = require('mongoose');
    chats = await Promise.all(chats.map(async (chat) => {
      const uid = chat.userId;
      // If userId is a string and looks like an ObjectId, fetch user
      if (uid && typeof uid === 'string' && mongoose.Types.ObjectId.isValid(uid)) {
        const user = await User.findById(uid).select('username email').lean();
        if (user) chat.userId = user;
      } else if (uid && typeof uid === 'object' && uid._id && mongoose.Types.ObjectId.isValid(uid._id)) {
        // If it's an object without username, try to populate
        if (!uid.username) {
          const user = await User.findById(uid._id).select('username email').lean();
          if (user) chat.userId = user;
        }
      }
      return chat;
    }));

    res.json(chats);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/chats/:id/messages', auth, async (req, res) => {
  const Message = require('./models/Message');
  const User = require('./models/User');
  try {
    // Allow both admin and the chat owner to view messages
    const Chat = require('./models/Chat');
    const chat = await Chat.findById(req.params.id);

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Check if user is admin or the chat owner
    if (req.user.role !== 'admin' && chat.userId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await Message.find({ chatId: req.params.id }).populate('userId', 'username').sort({ timestamp: 1 });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/chats/:id/messages', auth, adminAuth, async (req, res) => {
  const { content } = req.body;
  const Message = require('./models/Message');
  try {
    // Save admin message including admin username for clarity
    const message = new Message({ chatId: req.params.id, userId: req.user._id, username: req.user.username, sender: 'admin', content });
    await message.save();

    // Update chat timestamp
    const Chat = require('./models/Chat');
    await Chat.findByIdAndUpdate(req.params.id, { updatedAt: new Date() });

    // Emit the message to all users in the chat room via WebSocket
    io.to(req.params.id).emit('newMessage', message);

    res.json(message);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single chat with populated user data
app.get('/api/chats/:id', auth, async (req, res) => {
  const Chat = require('./models/Chat');
  try {
    let chat = await Chat.findById(req.params.id).lean();
    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Determine chat owner id for permission check
    const chatOwnerId = (typeof chat.userId === 'object' && chat.userId && chat.userId._id) ? chat.userId._id : chat.userId;
    if (req.user.role !== 'admin' && chatOwnerId.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Populate userId if it's a user id string
    const mongoose = require('mongoose');
    const User = require('./models/User');
    if (chat.userId && typeof chat.userId === 'string' && mongoose.Types.ObjectId.isValid(chat.userId)) {
      const user = await User.findById(chat.userId).select('username email').lean();
      if (user) chat.userId = user;
    }

    res.json(chat);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create new chat for authenticated user
app.post('/api/chats', auth, async (req, res) => {
  const { userId } = req.body;
  const Chat = require('./models/Chat');

  // Only allow users to create their own chats or admins to create any
  if (req.user.role !== 'admin' && userId !== req.user._id.toString()) {
    return res.status(403).json({ error: 'Access denied' });
  }

  try {
    const chat = new Chat({ userId });
    await chat.save();
    res.status(201).json(chat);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ error: 'Chat already exists for this user' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Token verification endpoint
app.get('/api/auth/verify', auth, (req, res) => {
  res.json({ user: { _id: req.user._id, username: req.user.username, email: req.user.email, role: req.user.role } });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
