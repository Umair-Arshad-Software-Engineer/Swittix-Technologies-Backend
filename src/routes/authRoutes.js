const express = require('express');
const router = express.Router();
const {
    register,
    login,
    getCurrentUser,
    getAllUsers,
    createUser,
    createTestUser,
    updateUser,
    getUserWithBranches,
    deleteUser,
    changeUserPassword
} = require('../controllers/authController');
const { protect, adminOnly, superAdminOnly } = require('../middleware/authMiddleware');

// Public routes
router.post('/register', register);
router.post('/login', login);

// Verify token
router.get('/verify-token', protect, (req, res) => {
    res.json({ success: true, message: 'Token is valid', user: req.user });
});

// Protected routes
router.get('/me', protect, getCurrentUser);
router.get('/users', protect, adminOnly, getAllUsers);
router.get('/users/:id', protect, adminOnly, getUserWithBranches);

// Super admin only routes
router.post('/users', protect, superAdminOnly, createUser);
router.post('/users/test', protect, superAdminOnly, createTestUser);  // ← NEW
router.put('/users/:id', protect, superAdminOnly, updateUser);
router.delete('/users/:id', protect, superAdminOnly, deleteUser);
router.put('/users/:id/password', protect, superAdminOnly, changeUserPassword);

module.exports = router;