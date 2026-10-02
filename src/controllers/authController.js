// src/controllers/authController.js
const db = require('../models');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const generateToken = (userId, email, role) => {
    return jwt.sign(
        { id: userId, email, role },
        process.env.JWT_SECRET || 'your_super_secret_jwt_key_2026',
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
    );
};

const BRANCH_INCLUDE = {
    model: db.Branch,
    as: 'branch',
    attributes: ['id', 'name', 'address', 'phone']
};

// ─── Serializer: include test-user metadata ──────────────────────────────
const serializeUser = (user) => {
    const daysRemaining = (() => {
        if (!user.expires_at) return null;
        const ms = new Date(user.expires_at).getTime() - Date.now();
        return Math.ceil(ms / (1000 * 60 * 60 * 24));
    })();

    const isExpired = (() => {
        if (!user.expires_at) return false;
        return new Date(user.expires_at).getTime() < Date.now();
    })();

    return {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        created_at: user.createdAt,
        // test-user fields
        is_test_user: !!user.is_test_user,
        expires_at: user.expires_at,
        max_login_days: user.max_login_days ?? null,
        days_remaining: daysRemaining,
        is_expired: isExpired,
        last_login_at: user.last_login_at ?? null,
        branch: user.branch ? {
            id: user.branch.id,
            name: user.branch.name,
            address: user.branch.address,
            phone: user.branch.phone
        } : null
    };
};

// ─── LOGIN ───────────────────────────────────────────────────────────────
const login = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide email and password'
            });
        }

        const user = await db.User.findOne({
            where: { email },
            include: [BRANCH_INCLUDE]
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        if (!user.is_active) {
            return res.status(401).json({
                success: false,
                message: 'Account is deactivated. Contact admin.'
            });
        }

        // ─── TEST-USER EXPIRY BLOCK ──────────────────────────────────
        if (user.is_test_user && user.expires_at) {
            const expired = new Date(user.expires_at).getTime() < Date.now();
            if (expired) {
                return res.status(403).json({
                    success: false,
                    code: 'ACCOUNT_EXPIRED',
                    message: 'Your test account has expired. Please contact the administrator.',
                    expires_at: user.expires_at,
                });
            }
        }
        // ─────────────────────────────────────────────────────────────

        const isPasswordValid = await user.verifyPassword(password);
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        // Record last login
        await user.update({ last_login_at: new Date() });

        const token = generateToken(user.id, user.email, user.role);

        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: serializeUser(user)
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during login'
        });
    }
};

// ─── REGISTER (unchanged but uses new serializer) ────────────────────────
const register = async (req, res) => {
    try {
        const { name, email, password, role, branch_id } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }

        const existingUser = await db.User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User already exists with this email'
            });
        }

        const user = await db.User.create({
            name, email, password,
            role: role || 'user',
            branch_id: null,
            is_test_user: false,
        });

        const userWithBranch = await db.User.findByPk(user.id, {
            include: [BRANCH_INCLUDE]
        });

        const token = generateToken(user.id, user.email, user.role);

        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            token,
            user: serializeUser(userWithBranch)
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during registration'
        });
    }
};

// ─── GET CURRENT USER ────────────────────────────────────────────────────
const getCurrentUser = async (req, res) => {
    try {
        const user = await db.User.findByPk(req.user.id, {
            attributes: [
                'id', 'name', 'email', 'role', 'is_active', 'createdAt',
                'branch_id', 'is_test_user', 'expires_at',
                'max_login_days', 'last_login_at'
            ],
            include: [BRANCH_INCLUDE]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({ success: true, user: serializeUser(user) });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── GET ALL USERS ───────────────────────────────────────────────────────
const getAllUsers = async (req, res) => {
    try {
        const users = await db.User.findAll({
            attributes: [
                'id', 'name', 'email', 'role', 'is_active', 'createdAt',
                'branch_id', 'is_test_user', 'expires_at',
                'max_login_days', 'last_login_at'
            ],
            include: [BRANCH_INCLUDE],
            order: [['id', 'DESC']]
        });

        res.json({
            success: true,
            users: users.map(serializeUser)
        });
    } catch (error) {
        console.error('Get users error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── CREATE USER (normal) ────────────────────────────────────────────────
const createUser = async (req, res) => {
    try {
        const { name, email, password, role, branch_id } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide all required fields'
            });
        }

        const existingUser = await db.User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User already exists with this email'
            });
        }

        const user = await db.User.create({
            name, email, password,
            role: role || 'user',
            branch_id: branch_id || null,
            is_test_user: false,
            created_by: req.user.id,
        });

        const userWithBranch = await db.User.findByPk(user.id, {
            include: [BRANCH_INCLUDE]
        });

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            user: serializeUser(userWithBranch)
        });
    } catch (error) {
        console.error('Create user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during user creation'
        });
    }
};

// ─── CREATE TEST USER (super admin only) ─────────────────────────────────
const createTestUser = async (req, res) => {
    try {
        const {
            name, email, password, branch_id,
            duration_days,            // preferred: number of days
            expires_at,               // alternative: explicit ISO date
            role = 'user',
        } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide name, email and password'
            });
        }

        // Must provide EITHER duration_days OR expires_at
        let expiryDate = null;
        let maxDays = null;

        if (duration_days != null) {
            const days = parseInt(duration_days, 10);
            if (isNaN(days) || days < 1 || days > 3650) {
                return res.status(400).json({
                    success: false,
                    message: 'duration_days must be between 1 and 3650'
                });
            }
            expiryDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
            maxDays = days;
        } else if (expires_at) {
            const parsed = new Date(expires_at);
            if (isNaN(parsed.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'expires_at must be a valid date'
                });
            }
            if (parsed.getTime() <= Date.now()) {
                return res.status(400).json({
                    success: false,
                    message: 'expires_at must be in the future'
                });
            }
            expiryDate = parsed;
            maxDays = Math.ceil(
                (parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
            );
        } else {
            return res.status(400).json({
                success: false,
                message: 'Provide either duration_days or expires_at'
            });
        }

        const existingUser = await db.User.findOne({ where: { email } });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'User already exists with this email'
            });
        }

        const user = await db.User.create({
            name,
            email,
            password,
            role: 'user', // test users can never be admin/super_admin
            branch_id: branch_id || null,
            is_active: true,
            is_test_user: true,
            expires_at: expiryDate,
            max_login_days: maxDays,
            created_by: req.user.id,
        });

        const userWithBranch = await db.User.findByPk(user.id, {
            include: [BRANCH_INCLUDE]
        });

        res.status(201).json({
            success: true,
            message: `Test user created. Expires on ${expiryDate.toISOString().split('T')[0]} (${maxDays} day(s)).`,
            user: serializeUser(userWithBranch)
        });
    } catch (error) {
        console.error('Create test user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during test user creation'
        });
    }
};

// ─── UPDATE USER ─────────────────────────────────────────────────────────
const updateUser = async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name, email, role, is_active, branch_id,
            duration_days, expires_at,   // allow extending test users
        } = req.body;

        const user = await db.User.findByPk(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Prevent demoting/altering other super admins unless self
        if (user.role === 'super_admin' && user.id !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Cannot modify another super admin'
            });
        }

        const updates = {
            name: name ?? user.name,
            email: email ?? user.email,
            role: role ?? user.role,
            is_active: is_active !== undefined ? is_active : user.is_active,
            branch_id: branch_id !== undefined ? branch_id : user.branch_id,
        };

        // Extend or set expiry on test users
        if (user.is_test_user) {
            if (duration_days != null) {
                const days = parseInt(duration_days, 10);
                if (isNaN(days) || days < 1 || days > 3650) {
                    return res.status(400).json({
                        success: false,
                        message: 'duration_days must be between 1 and 3650'
                    });
                }
                updates.expires_at = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
                updates.max_login_days = days;
                updates.is_active = true; // re-activate on extension
            } else if (expires_at) {
                const parsed = new Date(expires_at);
                if (isNaN(parsed.getTime())) {
                    return res.status(400).json({
                        success: false,
                        message: 'expires_at must be a valid date'
                    });
                }
                updates.expires_at = parsed;
                updates.max_login_days = Math.ceil(
                    (parsed.getTime() - Date.now()) / (1000 * 60 * 60 * 24)
                );
            }
        }

        await user.update(updates);

        res.json({
            success: true,
            message: 'User updated successfully',
            user: serializeUser(user)
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during user update'
        });
    }
};

// ─── GET USER WITH BRANCH ────────────────────────────────────────────────
const getUserWithBranches = async (req, res) => {
    try {
        const { id } = req.params;

        const user = await db.User.findByPk(id, {
            include: [BRANCH_INCLUDE]
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({ success: true, user: serializeUser(user) });
    } catch (error) {
        console.error('Get user with branch error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
};

// ─── DELETE USER ─────────────────────────────────────────────────────────
const deleteUser = async (req, res) => {
    try {
        const { id } = req.params;

        if (parseInt(id) === req.user.id) {
            return res.status(400).json({
                success: false,
                message: 'You cannot delete your own account'
            });
        }

        const user = await db.User.findByPk(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        if (user.role === 'super_admin') {
            return res.status(403).json({
                success: false,
                message: 'Cannot delete a super admin'
            });
        }

        await user.destroy();

        res.json({
            success: true,
            message: 'User deleted successfully'
        });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during user deletion'
        });
    }
};

// ─── CHANGE PASSWORD ─────────────────────────────────────────────────────
const changeUserPassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { newPassword } = req.body;

        if (!newPassword || newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 6 characters'
            });
        }

        const user = await db.User.findByPk(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        user.password = newPassword;
        await user.save();

        res.json({
            success: true,
            message: 'Password updated successfully'
        });
    } catch (error) {
        console.error('Change password error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while changing password'
        });
    }
};

// ─── SUPER ADMIN SEED ────────────────────────────────────────────────────
const createSuperAdmin = async () => {
    try {
        const superAdminEmail = 'swittix@gmail.com';
        const existingAdmin = await db.User.findOne({
            where: { email: superAdminEmail }
        });

        if (!existingAdmin) {
            console.log('👑 Creating Super Admin...');
            await db.User.create({
                name: 'Super Admin',
                email: superAdminEmail,
                password: '498800',
                role: 'super_admin',
                is_active: true,
                branch_id: null,
                is_test_user: false,
                expires_at: null,
            });
            console.log('✅ Super Admin created successfully');
        } else {
            console.log('✅ Super Admin already exists');
        }
    } catch (error) {
        console.error('❌ Error creating super admin:', error);
        throw error;
    }
};

module.exports = {
    register,
    login,
    getCurrentUser,
    getAllUsers,
    createUser,
    createTestUser,          // ← NEW
    updateUser,
    getUserWithBranches,
    deleteUser,
    createSuperAdmin,
    changeUserPassword,
};