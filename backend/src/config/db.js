const mongoose = require('mongoose');
require('dotenv').config();

const connectDB = async () => {
  try {
    // 1. Connexion principale pour les comptes (base de données vide)
    await mongoose.connect(process.env.AGENT_DB_URI || 'mongodb://127.0.0.1:27017/ai-agent-db');
    console.log('✅ Connected to AI Agent DB (Accounts & Sessions)');

    // 2. Connexion secondaire pour lire les données de l'ERP
    const erpConnection = mongoose.createConnection(process.env.ERP_DB_URI || 'mongodb://127.0.0.1:27017/erp-notif');
    
    erpConnection.on('connected', () => {
      console.log('✅ Connected to ERP DB (erp-notif for data queries)');
      // Rendre la db ERP globale pour y accéder facilement depuis les contrôleurs
      global.erpDb = erpConnection.db; 
    });

  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  }
};

module.exports = connectDB;
