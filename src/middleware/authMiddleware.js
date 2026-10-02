// src/middleware/authMiddleware.js
const db = require('../models');
const jwt = require('jsonwebtoken');

const protect = async (req, res, next) => {
    let token;

    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
        try {
            token = req.headers.authorization.split(' ')[1];

            const decoded = jwt.verify(
                token,
                process.env.JWT_SECRET || 'your_super_secret_jwt_key_2026'
            );

            req.user = await db.User.findByPk(decoded.id, {
                attributes: [
                    'id', 'name', 'email', 'role', 'is_active',
                    'is_test_user', 'expires_at', 'max_login_days',
                    'branch_id',
                ]
            });

            if (!req.user) {
                return res.status(401).json({
                    success: false,
                    message: 'User not found'
                });
            }

            if (!req.user.is_active) {
                return res.status(401).json({
                    success: false,
                    message: 'Account is deactivated'
                });
            }

            // ─── TEST-USER EXPIRY CHECK ────────────────────────────────
            if (req.user.is_test_user && req.user.expires_at) {
                const expired = new Date(req.user.expires_at).getTime() < Date.now();
                if (expired) {
                    return res.status(403).json({
                        success: false,
                        code: 'ACCOUNT_EXPIRED',
                        message: 'Your test account has expired. Please contact the administrator.',
                        expires_at: req.user.expires_at,
                    });
                }
            }
            // ───────────────────────────────────────────────────────────

            next();
        } catch (error) {
            console.error('Token verification error:', error.message);
            return res.status(401).json({
                success: false,
                message: 'Not authorized, token failed'
            });
        }
    }

    if (!token) {
        return res.status(401).json({
            success: false,
            message: 'Not authorized, no token'
        });
    }
};

const adminOnly = (req, res, next) => {
    if (req.user.role !== 'super_admin' && req.user.role !== 'admin') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Admin only.'
        });
    }
    next();
};

const superAdminOnly = (req, res, next) => {
    if (req.user.role !== 'super_admin') {
        return res.status(403).json({
            success: false,
            message: 'Access denied. Super admin only.'
        });
    }
    next();
};

const adminOrSuperAdmin = (req, res, next) => {
    if (req.user && (req.user.role === 'admin' || req.user.role === 'super_admin')) {
        return next();
    }
    return res.status(403).json({
        success: false,
        message: 'Admin access required'
    });
};

module.exports = { protect, adminOnly, superAdminOnly, adminOrSuperAdmin };