// routes/categoryRoutes.js
const express = require('express');
const router = express.Router();
const {
    getAllCategories,
    createCategory,
    updateCategory,
    deleteCategory,
} = require('../controllers/categoryController');
const { protect, superAdminOnly } = require('../middleware/authMiddleware');

router.get('/', protect, getAllCategories);
router.post('/', protect, superAdminOnly, createCategory);
router.put('/:id', protect, superAdminOnly, updateCategory);
router.delete('/:id', protect, superAdminOnly, deleteCategory);

module.exports = router;