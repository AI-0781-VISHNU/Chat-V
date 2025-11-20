import React, { useState, useEffect, useCallback } from 'react';
import io from 'socket.io-client';
import UserChat from './UserChat';
import './App.css';

const API_BASE_URL = 'http://localhost:3001';
const socket = io(API_BASE_URL);

const AuthContext = React.createContext();

function AdminDashboard() {
  const [chats, setChats] = useState([]);
  const [selectedChat, setSelectedChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState('');
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));
  const [token, setToken] = useState(localStorage.getItem('token'));

  const fetchChats = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      const rawChats = Array.isArray(data) ? data : [];

      // For any chats where `userId` wasn't populated (string id), fetch chat details
      const chatsWithUser = await Promise.all(rawChats.map(async (chat) => {
        // If userId is missing, a plain string, or an object without username, fetch details
        const needsPopulate = !chat.userId || typeof chat.userId === 'string' || (typeof chat.userId === 'object' && !chat.userId.username);
        if (needsPopulate) {
          try {
            const resp = await fetch(`${API_BASE_URL}/api/chats/${chat._id}`, {
              headers: { Authorization: `Bearer ${token}` }
            });
            if (resp.ok) {
              const populated = await resp.json();
              return populated;
            }
          } catch (err) {
            console.warn('Failed to fetch chat details for population', chat._id, err);
          }
        }
        return chat;
      }));

      setChats(chatsWithUser);
    } catch (error) {
      console.error('Error fetching chats:', error);
    }
  }, [token]);

  // Resolve a display name for a chat: prefer populated userId.username,
  // then any username found in messages for that chat, then fall back to id or 'User'.
  const resolveChatDisplayName = (chat) => {
    if (!chat) return 'User';
    // no-op
    if (chat.userId && typeof chat.userId === 'object' && chat.userId.username) return chat.userId.username;
    if (chat.userId && typeof chat.userId === 'string') return chat.userId;
    // If selected chat and we have messages, try to find username from messages state
    if (selectedChat && selectedChat._id === chat._id) {
      const userMsg = messages.find(m => m.sender === 'user' && m.username);
      if (userMsg) return userMsg.username;
      const anyMsg = messages.find(m => m.username);
      if (anyMsg) return anyMsg.username;
    }
    return 'User';
  };

  useEffect(() => {
    if (token && user?.role === 'admin') {
      fetchChats();
    }

    const handleNewMessage = (message) => {
      if (selectedChat && message.chatId === selectedChat._id) {
        setMessages(prevMessages => {
          // Check if message already exists to prevent duplicates
          const messageExists = prevMessages.some(msg => msg._id === message._id || (msg._id.startsWith('temp_') && msg.content === message.content && msg.sender === message.sender));
          if (!messageExists) {
            // Remove any temporary messages with the same content
            const filteredMessages = prevMessages.filter(msg => !(msg._id.startsWith('temp_') && msg.content === message.content && msg.sender === message.sender));
            return [...filteredMessages, message];
          }
          return prevMessages;
        });
      }
      // Update chat list to show latest activity
      fetchChats();
    };

    socket.on('newMessage', handleNewMessage);

    return () => {
      socket.off('newMessage', handleNewMessage);
    };
  }, [selectedChat, token, user?.role, fetchChats]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectChat = async (chat) => {
    // If chat doesn't have populated user data, fetch it
    let chatWithUser = chat;
    if (!chat.userId?.username && typeof chat.userId === 'string') {
      try {
        const response = await fetch(`${API_BASE_URL}/api/chats/${chat._id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (response.ok) {
          chatWithUser = await response.json();
        }
      } catch (error) {
        console.error('Error fetching chat details:', error);
      }
    }

    setSelectedChat(chatWithUser);
    socket.emit('joinChat', chat._id);
    try {
      const response = await fetch(`${API_BASE_URL}/api/chats/${chat._id}/messages`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await response.json();
      setMessages(data);
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedChat) return;

    const messageContent = newMessage.trim();

    // Optimistically add the message to UI immediately
    const optimisticMessage = {
      _id: `temp_${Date.now()}`, // Temporary ID
      chatId: selectedChat._id,
      sender: 'admin',
      content: messageContent,
      userId: user._id,
      username: user.username,
      timestamp: new Date()
    };
    setMessages(prevMessages => [...prevMessages, optimisticMessage]);
    setNewMessage('');

    try {
      const response = await fetch(`${API_BASE_URL}/api/chats/${selectedChat._id}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          content: messageContent
        }),
      });
      if (!response.ok) {
        // Remove optimistic message if request failed
        setMessages(prevMessages => prevMessages.filter(msg => msg._id !== optimisticMessage._id));
        setNewMessage(optimisticMessage.content); // Restore the message
      }
    } catch (error) {
      console.error('Error sending message:', error);
      // Remove optimistic message if request failed
      setMessages(prevMessages => prevMessages.filter(msg => msg._id !== optimisticMessage._id));
      setNewMessage(optimisticMessage.content); // Restore the message
    }
  };



  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setChats([]);
    setSelectedChat(null);
    setMessages([]);
  };



  return (
    <AuthContext.Provider value={{ user, token, logout }}>
      <div className="App">
        <div className="admin-dashboard">
          <div className="chat-list">
            <div className="admin-header">
              <h2>Live Chat Admin</h2>
              <div className="user-info">
                <span>Welcome, {user?.username}</span>
                <button onClick={logout} className="logout-btn">Logout</button>
              </div>
            </div>
            <div className="chats">
              {chats.map(chat => (
                <div
                  key={chat._id}
                  className={`chat-item ${selectedChat && selectedChat._id === chat._id ? 'active' : ''}`}
                  onClick={() => selectChat(chat)}
                >
                  <div className="chat-info">
                    <span className="user-id">
                      {resolveChatDisplayName(chat)}{(chat.userId && typeof chat.userId === 'object' && chat.userId._id) ? ` (${chat.userId._id})` : ''}
                    </span>
                    <span className="chat-status">{chat.status}</span>
                  </div>
                  <span className="last-updated">
                    {new Date(chat.updatedAt).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div className="chat-window">
            {selectedChat ? (
              <>
                <div className="chat-header">
                  <h3>Chat with {resolveChatDisplayName(selectedChat)}</h3>
                </div>
                <div className="messages">
                {messages.map((msg, index) => (
                  <div key={msg._id || index} className={`message ${msg.sender}`}>
                    <div className="message-meta">
                      <strong className="message-username">{msg.username || (msg.userId && msg.userId.username) || (msg.userId === user._id ? user.username : 'User')}</strong>
                    </div>
                    <div className="message-content">{msg.content}</div>
                    <div className="message-time">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </div>
                  </div>
                ))}
                </div>
                <form onSubmit={sendMessage} className="message-form">
                  <input
                    type="text"
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type your reply..."
                    className="message-input"
                  />
                  <button type="submit" className="send-button">Send</button>
                </form>
              </>
            ) : (
              <div className="no-chat-selected">
                <p>Select a chat to start responding</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </AuthContext.Provider>
  );
}

function AuthPage() {
  const [authMode, setAuthMode] = useState('login'); // 'login' or 'register'
  const [authForm, setAuthForm] = useState({ username: '', email: '', password: '' });

  const handleAuth = async (e) => {
    e.preventDefault();
    const endpoint = authMode === 'login' ? 'login' : 'register';
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(authForm)
      });
      const data = await response.json();
      if (response.ok) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        window.location.reload(); // Refresh to load the appropriate component
      } else {
        alert(data.error);
      }
    } catch (error) {
      console.error('Auth error:', error);
    }
  };

  return (
    <div className="App">
      <div className="auth-container">
        <h2>{authMode === 'login' ? 'Login' : 'Register'}</h2>
        <form onSubmit={handleAuth}>
          {authMode === 'register' && (
            <input
              type="text"
              placeholder="Username"
              value={authForm.username}
              onChange={(e) => setAuthForm({ ...authForm, username: e.target.value })}
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={authForm.email}
            onChange={(e) => setAuthForm({ ...authForm, email: e.target.value })}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={authForm.password}
            onChange={(e) => setAuthForm({ ...authForm, password: e.target.value })}
            required
          />
          <button type="submit">{authMode === 'login' ? 'Login' : 'Register'}</button>
        </form>
        <button onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
          {authMode === 'login' ? 'Need to register?' : 'Already have an account?'}
        </button>
      </div>
    </div>
  );
}

function App() {
  const [user, setUser] = useState(JSON.parse(localStorage.getItem('user')));
  const [token, setToken] = useState(localStorage.getItem('token'));

  const handleLogout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  };

  if (!token || !user) {
    return <AuthPage />;
  }

  if (user.role === 'admin') {
    return <AdminDashboard />;
  } else {
    return <UserChat user={user} token={token} onLogout={handleLogout} />;
  }
}

export default App;
