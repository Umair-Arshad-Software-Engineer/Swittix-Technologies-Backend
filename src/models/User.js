// src/models/User.js
const bcrypt = require('bcryptjs');

module.exports = (sequelize, DataTypes) => {
    const User = sequelize.define('User', {
        id: {
            type: DataTypes.INTEGER,
            primaryKey: true,
            autoIncrement: true,
        },
        name: {
            type: DataTypes.STRING(100),
            allowNull: false,
            validate: {
                notEmpty: { msg: 'Name is required' },
                len: { args: [2, 100], msg: 'Name must be between 2 and 100 characters' }
            }
        },
        email: {
            type: DataTypes.STRING(100),
            allowNull: false,
            unique: true,
            validate: {
                isEmail: { msg: 'Please provide a valid email' },
                notEmpty: { msg: 'Email is required' }
            }
        },
        password: {
            type: DataTypes.STRING(255),
            allowNull: false,
            validate: { notEmpty: { msg: 'Password is required' } }
        },
        role: {
            type: DataTypes.ENUM('super_admin', 'admin', 'user'),
            defaultValue: 'user',
            validate: { isIn: [['super_admin', 'admin', 'user']] }
        },
        is_active: {
            type: DataTypes.BOOLEAN,
            defaultValue: true
        },
        branch_id: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'branches', key: 'id' }
        },

        // ─── NEW: Test-user / expiration fields ───────────────────────
        is_test_user: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
            allowNull: false,
        },
        // Null = never expires (normal users). Date = hard expiry.
        expires_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
        // Optional: max number of days the account is valid for.
        // Denormalised so we can show "X days remaining" without expiry math drift.
        max_login_days: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        // Who created this test user (super admin id)
        created_by: {
            type: DataTypes.INTEGER,
            allowNull: true,
            references: { model: 'users', key: 'id' }
        },
        // Track last login for audit
        last_login_at: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    }, {
        tableName: 'users',
        timestamps: true,
        underscored: false,
        createdAt: 'createdAt',
        updatedAt: 'updatedAt',
        hooks: {
            beforeCreate: async (user) => {
                if (user.password) {
                    user.password = await bcrypt.hash(user.password, 10);
                }
            },
            beforeUpdate: async (user) => {
                if (user.changed('password')) {
                    user.password = await bcrypt.hash(user.password, 10);
                }
            }
        }
    });

    User.associate = (models) => {
        User.belongsTo(models.Branch, {
            foreignKey: 'branch_id',
            as: 'branch'
        });
        User.hasMany(models.Branch, {
            foreignKey: 'created_by',
            as: 'createdBranches'
        });
    };

    User.prototype.verifyPassword = async function (password) {
        return await bcrypt.compare(password, this.password);
    };

    /** True if the account is expired (test user past expires_at). */
    User.prototype.isExpired = function () {
        if (!this.expires_at) return false;
        return new Date(this.expires_at).getTime() < Date.now();
    };

    /** Days remaining until expiry. null if no expiry set. */
    User.prototype.daysRemaining = function () {
        if (!this.expires_at) return null;
        const ms = new Date(this.expires_at).getTime() - Date.now();
        return Math.ceil(ms / (1000 * 60 * 60 * 24));
    };

    User.findByEmail = async function (email) {
        return await this.findOne({ where: { email } });
    };

    return User;
};