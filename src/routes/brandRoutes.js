// routes/brandRoutes.js
const express = require('express');
const router = express.Router();
const {
    getAllBrands,
    createBrand,
    updateBrand,
    deleteBrand,
} = require('../controllers/brandController');
const { protect, superAdminOnly } = require('../middleware/authMiddleware');

router.get('/', protect, getAllBrands);
router.post('/', protect, superAdminOnly, createBrand);
router.put('/:id', protect, superAdminOnly, updateBrand);
router.delete('/:id', protect, superAdminOnly, deleteBrand);

module.exports = router;