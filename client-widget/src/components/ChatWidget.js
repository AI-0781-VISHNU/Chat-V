import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './ChatWidget.css';

const ChatWidget = ({ serverUrl = 'http://localhost:3001' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState('');
  const [chatId, setChatId] = useState(null);
  const socketRef = useRef();
  const messagesEndRef = useRef();

  useEffect(() => {
    // Generate a unique chat ID for this user session
    const newChatId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    setChatId(newChatId);

    // Connect to Socket.IO server
    socketRef.current = io(serverUrl);

    // Join the chat room
    socketRef.current.emit('joinChat', newChatId);

    // Listen for new messages
    socketRef.current.on('newMessage', (message) => {
      setMessages(prevMessages => [...prevMessages, message]);
    });

    return () => {
      socketRef.current.disconnect();
    };
  }, [serverUrl]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (inputMessage.trim() && chatId) {
      const messageData = {
        chatId,
        sender: 'user',
        content: inputMessage.trim()
      };
      socketRef.current.emit('sendMessage', messageData);
      setInputMessage('');
    }
  };

  const toggleChat = () => {
    setIsOpen(!isOpen);
  };

  return (
    <div className="chat-widget">
      {!isOpen && (
        <div className="chat-toggle" onClick={toggleChat}>
          💬 Chat
        </div>
      )}
      {isOpen && (
        <div className="chat-window">
          <div className="chat-header">
            <h3>Live Chat</h3>
            <button onClick={toggleChat} className="close-btn">×</button>
          </div>
          <div className="chat-messages">
            {messages.map((msg, index) => (
              <div key={index} className={`message ${msg.sender}`}>
                <span className="message-content">{msg.content}</span>
                <span className="message-time">
                  {new Date(msg.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <form onSubmit={sendMessage} className="chat-input-form">
            <input
              type="text"
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              placeholder="Type your message..."
              className="chat-input"
            />
            <button type="submit" className="send-btn">Send</button>
          </form>
        </div>
      )}
    </div>
  );
};

export default ChatWidget;
