const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  chatId: { type: mongoose.Schema.Types.ObjectId, ref: 'Chat', required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // Optional for anonymous users
  sender: { type: String, enum: ['user', 'admin'], required: true },
  // Store the username at the time the message is created to make admin views
  // and logs easier to read without requiring a populate on `userId`.
  username: { type: String },
  content: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Message', messageSchema);
