import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './App.css';

const API_BASE_URL = 'http://localhost:3001';
const socket = io(API_BASE_URL);

function UserChat({ user, token, onLogout }) {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [chatId, setChatId] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    let isMounted = true;

    // Fetch existing messages for this user's chat
    const fetchMessages = async () => {
      try {
        // First, find the chat for this user
        const chatResponse = await fetch(`${API_BASE_URL}/api/chats?userId=${user._id}`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!isMounted) return;

        if (chatResponse.ok) {
          const chats = await chatResponse.json();
          const userChat = chats.find(chat => {
            if (!chat.userId) return false;
            const chatUserId = (typeof chat.userId === 'object' && chat.userId && chat.userId._id) ? chat.userId._id : chat.userId;
            return chatUserId && typeof chatUserId === 'string' && chatUserId === user._id;
          });

          if (userChat) {
            if (isMounted) {
              setChatId(userChat._id);

              // Now fetch messages for this chat
              const messageResponse = await fetch(`${API_BASE_URL}/api/chats/${userChat._id}/messages`, {
                headers: { Authorization: `Bearer ${token}` }
              });
              if (messageResponse.ok && isMounted) {
                const data = await messageResponse.json();
                setMessages(data);
              }

              // Join the chat room using the actual chat ID
              socket.emit('joinChat', userChat._id);
            }
          } else {
            // If no chat exists, create one
            const createChatResponse = await fetch(`${API_BASE_URL}/api/chats`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`
              },
              body: JSON.stringify({ userId: user._id })
            });

            if (createChatResponse.ok && isMounted) {
              const newChat = await createChatResponse.json();
              setChatId(newChat._id);
              socket.emit('joinChat', newChat._id);
            }
          }
        }
      } catch (error) {
        console.error('Error fetching messages:', error);
      }
    };

    fetchMessages();

    return () => {
      isMounted = false;
    };
  }, [user._id, token]);

  // Separate useEffect for handling messages when chatId changes
  useEffect(() => {
    if (!chatId) return;

    // Listen for new messages
    const handleNewMessage = (message) => {
      // Only add message if it's for this user's chat
      if (message.chatId === chatId) {
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
    };

    socket.on('newMessage', handleNewMessage);

    return () => {
      socket.off('newMessage', handleNewMessage);
    };
  }, [chatId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (inputMessage.trim() && chatId) {
      const messageContent = inputMessage.trim();

      // Optimistically add the message to UI immediately
      const optimisticMessage = {
        _id: `temp_${Date.now()}`, // Temporary ID
        chatId,
        sender: 'user',
        content: messageContent,
        userId: user._id,
        username: user.username,
        timestamp: new Date()
      };
      setMessages(prevMessages => [...prevMessages, optimisticMessage]);
      setInputMessage('');

      // Send via WebSocket
      const messageData = {
        chatId,
        sender: 'user',
        content: messageContent,
        userId: user._id
      };
      socket.emit('sendMessage', messageData);
    }
  };

  return (
    <div className="App">
      <div className="user-chat">
        <div className="user-header">
          <h2>Live Chat Support</h2>
          <div className="user-info">
            <span>Welcome, {user.username}</span>
            <button onClick={onLogout} className="logout-btn">Logout</button>
          </div>
        </div>
        <div className="chat-window">
          <div className="messages">
            {messages.map((msg, index) => (
                    <div key={msg._id || index} className={`message ${msg.sender}`}>
                      <div className="message-meta">
                        <strong className="message-username">{msg.username || (msg.userId === user._id ? user.username : 'Anonymous')}</strong>
                      </div>
                      <div className="message-content">{msg.content}</div>
                      <div className="message-time">
                        {new Date(msg.timestamp).toLocaleTimeString()}
                      </div>
                    </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={sendMessage} className="message-form">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Type your message..."
              className="message-input"
            />
            <button type="submit" className="send-button">Send</button>
          </form>
        </div>
      </div>
    </div>
  );
}

export default UserChat;
