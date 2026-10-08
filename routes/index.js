const express = require('express');
const { renderHome, renderPrivacy } = require('../controllers/homeController');

const router = express.Router();

router.get('/', renderHome);
router.get('/privacy', renderPrivacy);

module.exports = router;
