const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB (erp-notif) then start the server
connectDB().then(() => {
  const queryRoutes = require('./src/routes/queryRoutes');
  const authRoutes = require('./src/routes/authRoutes');

  app.use('/api/query', queryRoutes);
  app.use('/api/auth', authRoutes);

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  const PORT = process.env.PORT || 5001;
  app.listen(PORT, () => console.log(`🤖 AI DB Agent listening on port ${PORT}`));
}).catch(err => {
  console.error('Failed to start server:', err.message);
  process.exit(1);
});
