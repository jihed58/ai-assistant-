const express = require('express');
const router = express.Router();
const { handleQuery } = require('../controllers/queryController');

// POST /api/query — Natural language to MongoDB query
router.post('/', handleQuery);

module.exports = router;
