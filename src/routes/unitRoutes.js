// routes/unitRoutes.js
const express = require('express');
const router = express.Router();
const {
    getAllUnits,
    createUnit,
    updateUnit,
    deleteUnit,
} = require('../controllers/unitController');
const { protect, superAdminOnly } = require('../middleware/authMiddleware');

router.get('/', protect, getAllUnits);
router.post('/', protect, superAdminOnly, createUnit);
router.put('/:id', protect, superAdminOnly, updateUnit);
router.delete('/:id', protect, superAdminOnly, deleteUnit);

module.exports = router;