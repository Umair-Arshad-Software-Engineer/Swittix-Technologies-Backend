const express = require('express');
const router = express.Router();
const {
    getAllProducts,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct
} = require('../controllers/productController');
const { protect, superAdminOnly } = require('../middleware/authMiddleware');

router.get('/', protect, getAllProducts);
router.get('/:id', protect, getProduct);
router.post('/', protect, superAdminOnly, createProduct);
router.put('/:id', protect, superAdminOnly, updateProduct);
router.delete('/:id', protect, superAdminOnly, deleteProduct);

module.exports = router;